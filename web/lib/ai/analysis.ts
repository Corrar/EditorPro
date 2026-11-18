/* =====================================================================
   Análise local no NAVEGADOR:
   - decodifica o áudio (decodeAudioData) -> mono (RMS p/ silêncios; 16 kHz p/ Whisper)
   - vídeo-exemplo: quadros (p/ o Claude) + cortes de cena -> métricas de ritmo
   A lógica numérica fica em demo.ts (pura, testada).
   ===================================================================== */
import type { AspectRatio, Id, MediaAsset, StyleProfile } from '../types';
import { cutsFromDiffs, detectSilences, styleFromCuts, type Range } from './demo';
import { detectBeats } from './features';
import { deviceProfile, sampleVideo, type Frame } from './frames';

const MAX_DECODE_BYTES = 400 * 1024 * 1024;
const silenceCache = new Map<string, Range[]>();

type OfflineCtor = typeof OfflineAudioContext;
function offlineCtor(): OfflineCtor {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const C = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!C) throw new Error('Este navegador não decodifica áudio (OfflineAudioContext ausente).');
  return C;
}

/** decodifica o áudio de uma mídia (vídeo ou áudio) */
export async function decodeAudio(url: string): Promise<AudioBuffer> {
  const buf = await (await fetch(url)).arrayBuffer();
  if (buf.byteLength > MAX_DECODE_BYTES) throw new Error('arquivo grande demais para analisar no navegador');
  const C = offlineCtor();
  const ctx = new C(1, 1, 44100);
  return new Promise<AudioBuffer>((resolve, reject) => {
    // forma com callbacks: compatível com Safari antigo e moderno
    const p = ctx.decodeAudioData(buf, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then?.(resolve, reject);
  });
}

/** mono reamostrado por média em blocos (suficiente p/ RMS) */
export function toMonoDecimated(audio: AudioBuffer, targetRate = 8000): { samples: Float32Array; sampleRate: number } {
  const step = Math.max(1, Math.floor(audio.sampleRate / targetRate));
  const n = Math.floor(audio.length / step);
  const out = new Float32Array(n);
  const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const base = i * step;
    for (const ch of chans) for (let k = 0; k < step; k++) sum += ch[base + k] ?? 0;
    out[i] = sum / (step * chans.length);
  }
  return { samples: out, sampleRate: audio.sampleRate / step };
}

/** mono 16 kHz (entrada do Whisper), via OfflineAudioContext (filtro anti-aliasing do navegador) */
export async function toMono16k(audio: AudioBuffer): Promise<Float32Array> {
  const C = offlineCtor();
  const len = Math.max(1, Math.ceil(audio.duration * 16000));
  const ctx = new C(1, len, 16000);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  src.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/** silêncios (tempos da mídia) de um asset, com cache por id+url */
export async function silencesOf(asset: MediaAsset): Promise<Range[]> {
  if (!asset.url || asset.kind === 'image') return [];
  const key = `${asset.id}|${asset.url}`;
  const hit = silenceCache.get(key);
  if (hit) return hit;
  try {
    const { samples, sampleRate } = toMonoDecimated(await decodeAudio(asset.url));
    const r = detectSilences(samples, sampleRate);
    silenceCache.set(key, r);
    return r;
  } catch (e) {
    console.warn('[ai] não deu para analisar o áudio de', asset.name, e);
    silenceCache.set(key, []);
    return [];
  }
}

export async function silencesFor(assets: MediaAsset[]): Promise<Record<Id, Range[]>> {
  const out: Record<Id, Range[]> = {};
  for (const a of assets) out[a.id] = await silencesOf(a);
  return out;
}

export interface ReferenceSample {
  frames: Frame[];
  metrics: { duration: number; cuts: number[]; avgShotLength: number; pacing: StyleProfile['pacing']; aspect?: AspectRatio; width: number; height: number };
  /** perfil heurístico (modo demo / fallback se a IA falhar) */
  localStyle: StyleProfile;
}

/** amostra o vídeo-exemplo: quadros p/ o Claude + métricas de corte medidas localmente */
export async function sampleReference(asset: MediaAsset, onProgress?: (f: number) => void, withFrames = true): Promise<ReferenceSample | undefined> {
  if (!asset.url || asset.kind !== 'video') return undefined;
  try {
    const dev = deviceProfile();
    const s = await sampleVideo(asset.url, {
      maxDuration: dev.weak ? 60 : 120,
      maxFrames: withFrames ? undefined : 1,
      onProgress,
    });
    if (!s.duration) return undefined;
    const cuts = cutsFromDiffs(s.diffs, s.diffTimes);
    const localStyle = styleFromCuts(cuts, s.duration, { width: s.width || asset.width, height: s.height || asset.height });
    return {
      frames: withFrames ? s.frames : [],
      metrics: { duration: s.duration, cuts, avgShotLength: localStyle.avgShotLength, pacing: localStyle.pacing, aspect: localStyle.aspect, width: s.width, height: s.height },
      localStyle,
    };
  } catch (e) {
    console.warn('[ai] amostragem do exemplo falhou', e);
    return undefined;
  }
}

/** compatível com a versão anterior: só o perfil heurístico */
export async function analyzeReferenceLocal(asset: MediaAsset, onProgress?: (f: number) => void): Promise<StyleProfile | undefined> {
  return (await sampleReference(asset, onProgress, false))?.localStyle;
}

/** batidas de uma música (segundos da mídia); usa asset.beats se o shell/engine já detectou */
export async function beatsOf(asset: MediaAsset): Promise<number[]> {
  if (asset.beats?.length) return asset.beats;
  if (!asset.url || asset.kind === 'image') return [];
  try {
    const { samples, sampleRate } = toMonoDecimated(await decodeAudio(asset.url), 11025);
    return detectBeats(samples, sampleRate);
  } catch (e) {
    console.warn('[ai] não deu para achar as batidas de', asset.name, e);
    return [];
  }
}
