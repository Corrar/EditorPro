/* plano de áudio: ganho de cada clipe no tempo t (puro). Usado pelo preview e pelo export. */
import type { Clip, MediaAsset, Project, Seconds, Track } from '../types';
import { animateClip } from './animate';

export type AudibleClip = Extract<Clip, { type: 'video' } | { type: 'audio' }>;

export const DUCK_GAIN = 0.25;

export function isAudible(c: Clip): c is AudibleClip {
  return c.type === 'video' || c.type === 'audio';
}

/** existe fala em t? Usa legendas (melhor sinal) ou, sem elas, clipes de vídeo com som ativo */
export function voiceAt(p: Project, t: Seconds): boolean {
  const segs = p.captions.segments;
  if (segs.length) return segs.some((s) => t >= s.start && t < s.end);
  for (const tr of p.tracks) {
    if (tr.kind !== 'video' || tr.muted || tr.hidden) continue;
    for (const c of tr.clips) {
      if (c.type === 'video' && !c.muted && c.volume > 0 && t >= c.start && t < c.start + c.duration) return true;
    }
  }
  return false;
}

/** ganho linear (0..2) do clipe em t; 0 fora do clipe, mudo ou trilha muda */
export function clipGainAt(p: Project, track: Track, c: Clip, t: Seconds): number {
  if (!isAudible(c)) return 0;
  if (track.muted || (c.type === 'video' && (c.muted || track.hidden))) return 0;
  const local = t - c.start;
  if (local < 0 || local >= c.duration) return 0;
  // automação de volume (keyframes universais: props.volume/fadeIn/fadeOut)
  c = animateClip(c, local);
  let g = Math.max(0, c.volume ?? 1);
  if (c.fadeIn && c.fadeIn > 0) g *= Math.min(1, local / c.fadeIn);
  if (c.fadeOut && c.fadeOut > 0) g *= Math.min(1, Math.max(0, (c.duration - local) / c.fadeOut));
  if (c.type === 'audio' && c.duckUnderVoice && voiceAt(p, t)) g *= DUCK_GAIN;
  return g;
}

/** clipes com som de um projeto (para mixagem offline) */
export function audibleClips(p: Project, assets: Record<string, MediaAsset>): { clip: AudibleClip; track: Track; asset: MediaAsset }[] {
  const out: { clip: AudibleClip; track: Track; asset: MediaAsset }[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const c of track.clips) {
      if (!isAudible(c)) continue;
      if (c.type === 'video' && (c.muted || track.hidden)) continue;
      const asset = assets[c.assetId];
      if (!asset || asset.kind === 'image') continue;
      out.push({ clip: c, track, asset });
    }
  }
  return out;
}

/** pontos (tempo de timeline, ganho) para automação de volume do clipe, a cada `step` s */
export function gainEnvelope(p: Project, track: Track, c: AudibleClip, step = 1 / 50): { t: Seconds; g: number }[] {
  const pts: { t: Seconds; g: number }[] = [];
  const end = c.start + c.duration;
  for (let t = c.start; t < end; t += step) pts.push({ t, g: clipGainAt(p, track, c, t) });
  pts.push({ t: end, g: 0 });
  return pts;
}
