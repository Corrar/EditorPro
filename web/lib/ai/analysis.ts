/* =====================================================================
   Análise local no NAVEGADOR:
   - decodifica o áudio (decodeAudioData) -> mono (RMS p/ silêncios; 16 kHz p/ Whisper)
   - vídeo-exemplo: quadros (p/ o Claude) + cortes de cena -> métricas de ritmo
   A lógica numérica fica em demo.ts (pura, testada).
   ===================================================================== */
import type { AspectRatio, Id, MediaAsset, ReferenceTemplate, StyleProfile } from '../types';
import { cutsFromDiffs, detectSilences, styleFromCuts, type Range, type SilenceOptions } from './demo';
import { detectBeats } from './features';
import { deviceProfile, fitBudget, sampleMotionFrames, sampleVideo, sampleVideoAt, type ColorStats, type Frame } from './frames';
import { cutsOnBeatsRatio, measureReference } from './motion';

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
export async function silencesOf(asset: MediaAsset, opts?: SilenceOptions): Promise<Range[]> {
  if (!asset.url || asset.kind === 'image') return [];
  const key = `${asset.id}|${asset.url}|${opts ? JSON.stringify(opts) : ''}`;
  const hit = silenceCache.get(key);
  if (hit) return hit;
  try {
    const { samples, sampleRate } = toMonoDecimated(await decodeAudio(asset.url));
    const r = detectSilences(samples, sampleRate, opts);
    silenceCache.set(key, r);
    return r;
  } catch (e) {
    console.warn('[ai] não deu para analisar o áudio de', asset.name, e);
    silenceCache.set(key, []);
    return [];
  }
}

export async function silencesFor(assets: MediaAsset[], opts?: SilenceOptions): Promise<Record<Id, Range[]>> {
  const out: Record<Id, Range[]> = {};
  for (const a of assets) out[a.id] = await silencesOf(a, opts);
  return out;
}

export interface ReferenceSample {
  frames: Frame[];
  metrics: { duration: number; cuts: number[]; avgShotLength: number; pacing: StyleProfile["pacing"]; aspect?: AspectRatio; width: number; height: number; color?: ColorStats; template?: ReferenceTemplate };
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
      onProgress: onProgress ? (f) => onProgress(f * 0.5) : undefined,
    });
    if (!s.duration) return undefined;
    // molde medido quadro a quadro (movimento, cortes exatos, legenda, transições); sem ele, só os cortes grossos
    const template = await measureTemplate(asset, s.color, onProgress).catch((e) => { console.warn('[ai] medição do movimento falhou', e); return undefined; });
    const cuts = template ? template.shots.slice(1).map((x) => x.start) : cutsFromDiffs(s.diffs, s.diffTimes);
    const localStyle = styleFromCuts(cuts, s.duration, { width: s.width || asset.width, height: s.height || asset.height }, s.color, template);
    // para o Claude: pares em volta dos cortes (que transição é), começo/fim de algumas tomadas (movimento)
    // e a faixa de legenda em resolução cheia
    let extra: Frame[] = [];
    if (withFrames && template) {
      extra = await sampleVideoAt(asset.url, referenceProbeTimes(template, s.duration)).catch(() => []);
    }
    return {
      frames: withFrames ? [...fitBudget(s.frames, 2_300_000), ...extra] : [],
      metrics: { duration: s.duration, cuts, avgShotLength: localStyle.avgShotLength, pacing: localStyle.pacing, aspect: localStyle.aspect, width: s.width, height: s.height, ...(s.color ? { color: s.color } : {}), ...(template ? { template } : {}) },
      localStyle,
    };
  } catch (e) {
    console.warn('[ai] amostragem do exemplo falhou', e);
    return undefined;
  }
}

/** instantes que o Claude precisa ver do modelo (puro) */
export function referenceProbeTimes(t: ReferenceTemplate, duration: number): { t: number; label: string; crop?: { y0: number; y1: number } }[] {
  const out: { t: number; label: string; crop?: { y0: number; y1: number } }[] = [];
  const cuts = t.shots.slice(1).map((x) => x.start);
  const pick = <T,>(l: T[], n: number) => (l.length <= n ? l : Array.from({ length: n }, (_, k) => l[Math.floor(((k + 0.5) * l.length) / n)]));
  for (const c of pick(cuts, 3)) {
    out.push({ t: Math.max(0, c - 0.15), label: `ANTES do corte em ${c.toFixed(2)} s` }, { t: Math.min(duration - 0.02, c + 0.15), label: `DEPOIS do corte em ${c.toFixed(2)} s` });
  }
  for (const s of pick(t.shots.filter((x) => x.end - x.start >= 0.6), 3)) {
    out.push({ t: s.start + 0.05, label: `COMEÇO da tomada ${s.start.toFixed(2)}–${s.end.toFixed(2)} s` }, { t: s.end - 0.08, label: `FIM da tomada ${s.start.toFixed(2)}–${s.end.toFixed(2)} s (compare o enquadramento)` });
  }
  if (t.captions) {
    const pad = 0.02;
    const band = { y0: Math.max(0, t.captions.region.y0 - pad), y1: Math.min(1, t.captions.region.y1 + pad) };
    for (const s of pick(t.shots, 2)) out.push({ t: (s.start + s.end) / 2, label: 'Recorte da FAIXA DE LEGENDA em resolução cheia', crop: band });
  }
  return out;
}

/** mede o modelo (motion.ts): quadros cinza ~10 fps tocando mudo + faixa de legenda + batidas (cortes na batida) */
export async function measureTemplate(asset: MediaAsset, color?: ColorStats, onProgress?: (f: number) => void): Promise<ReferenceTemplate | undefined> {
  if (!asset.url || asset.kind !== 'video') return undefined;
  const dev = deviceProfile();
  const mf = await sampleMotionFrames(asset.url, { onProgress: onProgress ? (f) => onProgress(0.5 + f * 0.45) : undefined });
  if (mf.gray.length < 4) return undefined;
  const m = measureReference(mf.gray, mf.times, mf.windows, { duration: mf.duration, weak: dev.weak, ...(color ? { color: { r: color.r, g: color.g, b: color.b, sat: color.sat, lum: color.lum, ...(color.lumSd !== undefined ? { lumSd: color.lumSd } : {}) } } : {}) });
  console.info(`[ai] modelo medido em ${m.ms} ms (${mf.gray.length} quadros, ${mf.method}): ${m.template.motion.mode} ×${m.template.motion.avgZoomPerShot}, ${m.cuts.length} cortes${m.template.captions ? ', legenda detectada' : ''}`);
  // batidas do áudio do modelo: os cortes caem nelas?
  if (m.cuts.length >= 3) {
    const beats = await beatsOf(asset).catch(() => []);
    if (beats.length) m.template.cutsOnBeats = cutsOnBeatsRatio(m.cuts, beats);
  }
  return m.template;
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

/** cor média de um vídeo (amostragem rápida, sem quadros p/ IA), com cache */
const colorCache = new Map<string, ColorStats | null>();
export async function colorStatsOf(asset: MediaAsset): Promise<ColorStats | undefined> {
  if (!asset.url || asset.kind !== 'video') return undefined;
  const key = `${asset.id}|${asset.url}`;
  if (colorCache.has(key)) return colorCache.get(key) ?? undefined;
  try {
    const s = await sampleVideo(asset.url, { maxDuration: 40, maxFrames: 1, diffStep: 0.5 });
    colorCache.set(key, s.color ?? null);
    return s.color;
  } catch (e) {
    console.warn('[ai] cor média falhou', asset.name, e);
    colorCache.set(key, null);
    return undefined;
  }
}
