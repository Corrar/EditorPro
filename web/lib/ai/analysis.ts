/* =====================================================================
   Análise local no NAVEGADOR (modo demo e apoio):
   - decodifica o áudio da mídia (decodeAudioData) -> amostras mono
   - amostra quadros do vídeo-exemplo -> diferenças -> cortes -> StyleProfile
   A lógica numérica fica em demo.ts (pura, testada).
   ===================================================================== */
import type { Id, MediaAsset, StyleProfile } from '../types';
import { cutsFromDiffs, detectSilences, styleFromCuts, type Range } from './demo';

const MAX_DECODE_BYTES = 400 * 1024 * 1024;
const silenceCache = new Map<string, Range[]>();

/** áudio mono reamostrado (média por bloco) — suficiente para RMS */
export async function decodeMono(url: string, targetRate = 8000): Promise<{ samples: Float32Array; sampleRate: number; duration: number }> {
  const buf = await (await fetch(url)).arrayBuffer();
  if (buf.byteLength > MAX_DECODE_BYTES) throw new Error('arquivo grande demais para analisar no navegador');
  const Ctx = (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
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
  return { samples: out, sampleRate: audio.sampleRate / step, duration: audio.duration };
}

/** silêncios (tempos da mídia) de um asset, com cache por id+url */
export async function silencesOf(asset: MediaAsset): Promise<Range[]> {
  if (!asset.url || asset.kind === 'image') return [];
  const key = `${asset.id}|${asset.url}`;
  const hit = silenceCache.get(key);
  if (hit) return hit;
  try {
    const { samples, sampleRate } = await decodeMono(asset.url);
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

function waitEvent(el: HTMLMediaElement, ev: string, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { el.removeEventListener(ev, h); reject(new Error(`timeout ${ev}`)); }, ms);
    const h = () => { clearTimeout(t); el.removeEventListener(ev, h); resolve(); };
    el.addEventListener(ev, h);
  });
}

/** amostra quadros do vídeo-exemplo e infere ritmo de cortes (sem IA) */
export async function analyzeReferenceLocal(asset: MediaAsset, onProgress?: (f: number) => void): Promise<StyleProfile | undefined> {
  if (!asset.url || asset.kind !== 'video') return undefined;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = asset.url;
  try {
    await waitEvent(video, 'loadeddata', 8000);
    const duration = Math.min(video.duration || asset.duration || 0, 90);
    if (!duration) return undefined;
    const W = 48, H = 27;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    const step = Math.max(0.2, duration / 240);
    const times: number[] = [];
    const diffs: number[] = [];
    let prev: Uint8ClampedArray | null = null;
    for (let t = 0; t < duration; t += step) {
      video.currentTime = t;
      try { await waitEvent(video, 'seeked', 3000); } catch { continue; }
      ctx.drawImage(video, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;
      const lum = new Uint8ClampedArray(W * H);
      for (let i = 0; i < W * H; i++) lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
      if (prev) {
        let d = 0;
        for (let i = 0; i < lum.length; i++) d += Math.abs(lum[i] - prev[i]);
        diffs.push(d / (lum.length * 255));
        times.push(t);
      }
      prev = lum;
      onProgress?.(t / duration);
    }
    const cuts = cutsFromDiffs(diffs, times);
    return styleFromCuts(cuts, duration, { width: video.videoWidth || asset.width, height: video.videoHeight || asset.height });
  } catch (e) {
    console.warn('[ai] análise local do exemplo falhou', e);
    return undefined;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
