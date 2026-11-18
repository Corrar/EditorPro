/* =====================================================================
   Timeline — regras de edição puras (limites de corte, encaixe sem
   sobreposição, alvos de dividir/excluir/duplicar, posicionamento de mídia
   solta, régua). Tudo testável sem DOM. Gera EditOp[] para o store.
   ===================================================================== */
import type { Clip, Id, MediaAsset, MediaKind, Project, Seconds, Track, TrackKind } from '../types';
import { clipEnd, findClip, trackKindFor, type EditOp } from '../ops';
import { uid } from '../util';

export const MIN_CLIP: Seconds = 0.1;
const EPS = 1e-6;

/* ---------- compatibilidade ---------- */

export function kindForMedia(kind: MediaKind): TrackKind {
  return kind === 'audio' ? 'audio' : 'video';
}

export function canHost(track: Track, clip: Clip): boolean {
  return track.kind === trackKindFor(clip);
}

function speedOf(c: Clip): number {
  return (c.type === 'video' || c.type === 'audio') && c.speed > 0 ? c.speed : 1;
}

/* ---------- espaços livres ---------- */

type Span = { start: Seconds; end: Seconds };

function spansOf(track: Track, exclude: Set<Id>): Span[] {
  return track.clips
    .filter((c) => !exclude.has(c.id))
    .map((c) => ({ start: c.start, end: clipEnd(c) }))
    .sort((a, b) => a.start - b.start);
}

export function overlaps(track: Track, start: Seconds, duration: Seconds, exclude: Iterable<Id> = []): boolean {
  const ex = new Set(exclude);
  const end = start + duration;
  return spansOf(track, ex).some((s) => s.start < end - EPS && s.end > start + EPS);
}

/**
 * início livre mais próximo de `desired` onde cabe um clipe de `duration`
 * sem sobrepor os demais da trilha (ignorando `exclude`). Nunca negativo.
 */
export function nearestFreeStart(track: Track, duration: Seconds, desired: Seconds, exclude: Iterable<Id> = []): Seconds {
  const spans = spansOf(track, new Set(exclude));
  const want = Math.max(0, desired);
  // lacunas: [0, s0], [e0, s1], ..., [eN, +inf]
  const gaps: Span[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start - cursor > EPS) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  gaps.push({ start: cursor, end: Infinity });
  let best = want;
  let bestDist = Infinity;
  for (const g of gaps) {
    if (g.end - g.start < duration - EPS) continue;
    const pos = Math.min(Math.max(want, g.start), g.end - duration);
    const d = Math.abs(pos - want);
    if (d < bestDist - EPS) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

/* ---------- limites de corte (trim) ---------- */

export interface TrimBounds {
  minStart: Seconds;
  maxStart: Seconds;
  minEnd: Seconds;
  maxEnd: Seconds;
}

/**
 * limites para puxar as bordas: respeita a mídia (in >= 0 e
 * in + duração*speed <= asset.duration), o zero, os vizinhos da trilha e
 * a duração mínima.
 */
export function trimBounds(clip: Clip, track: Track | undefined, asset: MediaAsset | undefined, minDur: Seconds = MIN_CLIP): TrimBounds {
  const end = clipEnd(clip);
  let minStart = 0;
  let maxEnd = Infinity;
  if ((clip.type === 'video' || clip.type === 'audio')) {
    const sp = speedOf(clip);
    minStart = Math.max(0, clip.start - clip.in / sp);
    if (asset && asset.duration > 0) maxEnd = clip.start + (asset.duration - clip.in) / sp;
  }
  if (track) {
    for (const c of track.clips) {
      if (c.id === clip.id) continue;
      const ce = clipEnd(c);
      if (ce <= clip.start + EPS) minStart = Math.max(minStart, ce);
      if (c.start >= end - EPS) maxEnd = Math.min(maxEnd, c.start);
    }
  }
  return {
    minStart: Math.min(minStart, clip.start),
    maxStart: Math.max(clip.start, end - minDur),
    minEnd: Math.min(end, clip.start + minDur),
    maxEnd: Math.max(maxEnd, end),
  };
}

/* ---------- alvos de comandos ---------- */

function editable(track: Track, clip: Clip): boolean {
  return !track.locked && !clip.locked;
}

/** ops de dividir no tempo t: selecionados que cruzam t; sem seleção, tudo sob t em trilhas visíveis/destravadas */
export function splitOps(p: Project, selection: Id[], t: Seconds): EditOp[] {
  const sel = new Set(selection);
  const hit = (c: Clip) => t > c.start + EPS && t < clipEnd(c) - EPS;
  const ops: EditOp[] = [];
  const pick = (useSel: boolean) => {
    for (const track of p.tracks) {
      if (!useSel && track.hidden) continue;
      for (const c of track.clips)
        if ((!useSel || sel.has(c.id)) && editable(track, c) && hit(c))
          ops.push({ op: 'split_clip', clipId: c.id, at: t, newId: uid('clip') });
    }
  };
  if (sel.size) pick(true);
  if (!ops.length && !sel.size) pick(false);
  return ops;
}

/** ops de excluir; com ripple processa da direita p/ esquerda em cada trilha */
export function deleteOps(p: Project, ids: Id[], ripple = false): EditOp[] {
  const found = ids
    .map((id) => findClip(p, id))
    .filter((f): f is NonNullable<typeof f> => !!f && editable(f.track, f.clip));
  found.sort((a, b) => b.clip.start - a.clip.start);
  return found.map((f) => ({ op: 'remove_clip', clipId: f.clip.id, ...(ripple ? { ripple: true } : {}) }));
}

/** duplica logo após o original (no espaço livre mais próximo da mesma trilha) */
export function duplicateOps(p: Project, ids: Id[]): { ops: EditOp[]; newIds: Id[] } {
  const ops: EditOp[] = [];
  const newIds: Id[] = [];
  for (const id of ids) {
    const f = findClip(p, id);
    if (!f || f.track.locked) continue;
    const copy = { ...structuredCloneSafe(f.clip), id: uid('clip') } as Clip;
    const start = nearestFreeStart(f.track, copy.duration, clipEnd(f.clip));
    copy.start = start;
    ops.push({ op: 'add_clip', trackId: f.track.id, clip: copy });
    newIds.push(copy.id);
  }
  return { ops, newIds };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ---------- soltar mídia / mover entre trilhas ---------- */

export interface Placement {
  trackId: Id;
  start: Seconds;
  /** true se a trilha não existe ainda (add_clip cria) */
  newTrack: boolean;
}

/**
 * onde colocar um clipe de `kind` com `duration` perto de `t`:
 * 1) a trilha preferida, se compatível/destravada e livre em t;
 * 2) outra trilha compatível livre em t;
 * 3) trilha nova.
 */
export function placeClip(p: Project, kind: TrackKind, duration: Seconds, t: Seconds, preferredTrackId?: Id): Placement {
  const start = Math.max(0, t);
  const ok = (tr: Track) => tr.kind === kind && !tr.locked;
  const pref = p.tracks.find((tr) => tr.id === preferredTrackId);
  if (pref && ok(pref) && !overlaps(pref, start, duration)) return { trackId: pref.id, start, newTrack: false };
  for (const tr of p.tracks) if (ok(tr) && !overlaps(tr, start, duration)) return { trackId: tr.id, start, newTrack: false };
  return { trackId: uid(`track_${kind}`), start, newTrack: true };
}

/* ---------- régua ---------- */

const STEPS = [1 / 30, 1 / 15, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** passo principal/secundário da régua para que rótulos fiquem a >= minPx */
export function rulerSteps(zoom: number, fps = 30, minPx = 72): { major: Seconds; minor: Seconds } {
  const frame = 1 / fps;
  let major = STEPS[STEPS.length - 1];
  for (const s of STEPS) {
    const step = s < 0.1 ? Math.max(s, frame) : s;
    if (step * zoom >= minPx) {
      major = step;
      break;
    }
  }
  const divisions = major >= 60 ? 6 : major === 15 ? 3 : major === 2 || major === 0.2 ? 4 : major < 0.1 ? 1 : 5;
  let minor = major / divisions;
  if (minor * zoom < 6) minor = major;
  return { major, minor };
}

/** rótulo de um tick conforme o passo (frames quando o passo é sub-segundo) */
export function formatTick(t: Seconds, step: Seconds, fps = 30): string {
  const m = Math.floor(t / 60 + EPS);
  const s = t - m * 60;
  const ss = Math.floor(s + EPS);
  const base = `${m}:${String(ss).padStart(2, '0')}`;
  if (step >= 1 - EPS) return base;
  const f = Math.round((s - ss) * fps);
  if (f === 0 || f >= fps) return base;
  return `${base}:${String(f).padStart(2, '0')}f`;
}

/** zoom (px/s) para caber `duration` em `width` px */
export function fitZoom(duration: Seconds, width: number, min = 8, max = 400): number {
  const d = Math.max(duration, 1);
  return Math.max(min, Math.min(max, (width * 0.94) / d));
}

/** arredonda para o quadro mais próximo */
export function toFrame(t: Seconds, fps = 30): Seconds {
  return Math.round(t * fps) / fps;
}

/* ---------- miniaturas ---------- */

/** índice da miniatura para o instante `srcT` da mídia */
export function thumbIndexAt(srcT: Seconds, assetDuration: Seconds, count: number): number {
  if (count <= 0) return -1;
  if (!(assetDuration > 0)) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((srcT / assetDuration) * count)));
}

/** fatia de picos da waveform correspondente ao trecho [in, in+len] da mídia */
export function waveformSlice(peaks: number[], assetDuration: Seconds, srcIn: Seconds, srcLen: Seconds, buckets: number): number[] {
  if (!peaks.length || buckets <= 0 || !(assetDuration > 0)) return [];
  const perSec = peaks.length / assetDuration;
  const out: number[] = new Array(buckets).fill(0);
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor((srcIn + (srcLen * i) / buckets) * perSec);
    const b = Math.max(a + 1, Math.floor((srcIn + (srcLen * (i + 1)) / buckets) * perSec));
    let m = 0;
    for (let j = Math.max(0, a); j < Math.min(peaks.length, b); j++) m = Math.max(m, peaks[j]);
    out[i] = m;
  }
  return out;
}
