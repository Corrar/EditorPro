/* =====================================================================
   Timeline — regras de edição puras (limites de corte, encaixe sem
   sobreposição, alvos de dividir/excluir/duplicar, posicionamento de mídia
   solta, régua). Tudo testável sem DOM. Gera EditOp[] para o store.
   ===================================================================== */
import type { Clip, Id, MediaAsset, MediaKind, Project, Seconds, Track, TrackKind } from '../types';
import { applyOp as applyOpFn, clipEnd, findClip, trackKindFor, type EditOp } from '../ops';
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

/** duplica logo após o original (no espaço livre mais próximo da mesma trilha) — op duplicate_clip */
export function duplicateOps(p: Project, ids: Id[]): { ops: EditOp[]; newIds: Id[] } {
  const ops: EditOp[] = [];
  const newIds: Id[] = [];
  let proj = p; // aplica em sequência p/ cópias não colidirem entre si
  for (const id of ids) {
    const f = findClip(proj, id);
    if (!f || f.track.locked) continue;
    const newId = uid('clip');
    const start = nearestFreeStart(f.track, f.clip.duration, clipEnd(f.clip));
    const op: EditOp = { op: 'duplicate_clip', clipId: id, newId, start };
    ops.push(op);
    newIds.push(newId);
    proj = applyLocal(proj, op);
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
  return `${f}f`;
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

/* =====================================================================
   Edição avançada (paridade CapCut): trilha principal magnética,
   inserir/sobrescrever, colar, separar áudio, velocidade, congelar quadro.
   Todas devolvem EditOp[] p/ UM dispatch (1 desfazer).
   ===================================================================== */

/** trilha principal = primeira trilha de vídeo (camada de fundo) */
export function mainTrackId(p: Project): Id | undefined {
  return p.tracks.find((t) => t.kind === 'video')?.id;
}

/** fecha buracos: encosta os clipes da trilha a partir do zero, na ordem (ou na ordem dada) */
export function packOps(track: Track, order?: Id[]): EditOp[] {
  if (track.locked) return [];
  const byId = new Map(track.clips.map((c) => [c.id, c] as const));
  const seq = (order ?? [...track.clips].sort((a, b) => a.start - b.start).map((c) => c.id))
    .map((id) => byId.get(id))
    .filter((c): c is Clip => !!c);
  const ops: EditOp[] = [];
  let t = 0;
  for (const c of seq) {
    if (Math.abs(c.start - t) > EPS) ops.push({ op: 'move_clip', clipId: c.id, start: t });
    t += c.duration;
  }
  return ops;
}

/** ordem da trilha magnética depois de soltar `clipId` com início em `desired` (pelo centro) */
export function magneticOrder(track: Track, clipId: Id, desired: Seconds, duration: Seconds): Id[] {
  const rest = [...track.clips].filter((c) => c.id !== clipId).sort((a, b) => a.start - b.start);
  const center = desired + duration / 2;
  let i = rest.findIndex((c) => c.start + c.duration / 2 > center);
  if (i < 0) i = rest.length;
  const ids = rest.map((c) => c.id);
  ids.splice(i, 0, clipId);
  return ids;
}

/** onde fica a borda de inserção na trilha magnética (p/ desenhar a guia) */
export function magneticInsertTime(track: Track, order: Id[], clipId: Id): Seconds {
  let t = 0;
  for (const id of order) {
    if (id === clipId) return t;
    t += track.clips.find((c) => c.id === id)?.duration ?? 0;
  }
  return t;
}

/** INSERIR: abre espaço de `duration` em `at` (divide quem cruza `at` e empurra o resto) */
export function insertOps(track: Track, at: Seconds, duration: Seconds, exclude: Iterable<Id> = []): EditOp[] {
  if (track.locked || duration <= EPS) return [];
  const ex = new Set(exclude);
  const ops: EditOp[] = [];
  for (const c of track.clips) {
    if (ex.has(c.id)) continue;
    if (c.start >= at - EPS) ops.push({ op: 'move_clip', clipId: c.id, start: c.start + duration });
    else if (clipEnd(c) > at + EPS) {
      const rid = uid('clip');
      ops.push({ op: 'split_clip', clipId: c.id, at, newId: rid });
      ops.push({ op: 'move_clip', clipId: rid, start: at + duration });
    }
  }
  return ops;
}

/** SOBRESCREVER: limpa [start,end) da trilha (apara, divide ou remove o que estiver lá) */
export function overwriteOps(track: Track, start: Seconds, end: Seconds, exclude: Iterable<Id> = []): EditOp[] {
  if (track.locked || end - start <= EPS) return [];
  const ex = new Set(exclude);
  const ops: EditOp[] = [];
  for (const c of track.clips) {
    if (ex.has(c.id)) continue;
    const ce = clipEnd(c);
    if (ce <= start + EPS || c.start >= end - EPS) continue;
    const coversStart = c.start < start - EPS;
    const coversEnd = ce > end + EPS;
    if (coversStart && coversEnd) {
      const mid = uid('clip');
      const right = uid('clip');
      ops.push({ op: 'split_clip', clipId: c.id, at: start, newId: mid });
      ops.push({ op: 'split_clip', clipId: mid, at: end, newId: right });
      ops.push({ op: 'remove_clip', clipId: mid });
    } else if (coversStart) ops.push({ op: 'trim_clip', clipId: c.id, end: start });
    else if (coversEnd) ops.push({ op: 'trim_clip', clipId: c.id, start: end });
    else ops.push({ op: 'remove_clip', clipId: c.id });
  }
  return ops;
}

/* ---------- área de transferência (copiar/colar) ---------- */

export interface ClipboardItem {
  clip: Clip;
  trackId: Id;
  kind: TrackKind;
}

export function copyItems(p: Project, ids: Id[]): ClipboardItem[] {
  return ids
    .map((id) => findClip(p, id))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => ({ clip: structuredCloneSafe(f.clip), trackId: f.track.id, kind: f.track.kind }))
    .sort((a, b) => a.clip.start - b.clip.start);
}

/** cola no tempo `t` mantendo os deslocamentos relativos; usa a trilha de origem se livre, senão outra/nova */
export function pasteOps(p: Project, items: ClipboardItem[], t: Seconds): { ops: EditOp[]; newIds: Id[] } {
  if (!items.length) return { ops: [], newIds: [] };
  const base = Math.min(...items.map((i) => i.clip.start));
  let proj = p;
  const ops: EditOp[] = [];
  const newIds: Id[] = [];
  const created = new Map<Id, Id>(); // trilha de origem -> trilha nova (cola em grupo na mesma trilha nova)
  for (const it of items) {
    const start = Math.max(0, t + (it.clip.start - base));
    const clip = { ...structuredCloneSafe(it.clip), id: uid('clip'), start } as Clip;
    const pref = created.get(it.trackId) ?? it.trackId;
    const pl = placeClip(proj, it.kind, clip.duration, start, pref);
    if (pl.newTrack) created.set(it.trackId, pl.trackId);
    const op: EditOp = { op: 'add_clip', trackId: pl.trackId, clip };
    ops.push(op);
    newIds.push(clip.id);
    proj = applyLocal(proj, op);
  }
  return { ops, newIds };
}

/* ---------- ações de clipe ---------- */

/** separa o áudio: AudioClip do mesmo asset alinhado + vídeo mudo (um dispatch) */
export function detachAudioOps(p: Project, clipId: Id): EditOp[] {
  const f = findClip(p, clipId);
  if (!f || f.clip.type !== 'video' || f.track.locked) return [];
  const v = f.clip;
  const audio: Clip = {
    id: uid('clip'),
    type: 'audio',
    assetId: v.assetId,
    start: v.start,
    duration: v.duration,
    in: v.in,
    speed: v.speed,
    volume: v.volume,
    ...(v.fadeIn ? { fadeIn: v.fadeIn } : {}),
    ...(v.fadeOut ? { fadeOut: v.fadeOut } : {}),
    ...(v.reverse ? { reverse: true } : {}),
    label: v.label,
  };
  const pl = placeClip(p, 'audio', v.duration, v.start);
  return [
    { op: 'add_clip', trackId: pl.trackId, clip: audio, explain: 'Separando o áudio do vídeo' },
    { op: 'update_clip', clipId: v.id, patch: { muted: true } },
  ];
}

/** muda a velocidade mantendo o trecho da mídia (duração = duração*velAntiga/velNova), limitado à mídia */
export function speedOps(p: Project, clipId: Id, speed: number, assetDuration?: Seconds): EditOp[] {
  const f = findClip(p, clipId);
  if (!f || f.track.locked || (f.clip.type !== 'video' && f.clip.type !== 'audio') || speed <= 0) return [];
  const c = f.clip;
  const old = c.speed > 0 ? c.speed : 1;
  let src = c.duration * old; // trecho da mídia usado
  if (assetDuration && assetDuration > 0) src = Math.min(src, Math.max(0, assetDuration - c.in));
  const duration = Math.max(MIN_CLIP, src / speed);
  return [{ op: 'update_clip', clipId, patch: { speed, duration, speedCurve: undefined, speedPreset: undefined } }];
}

/** congelar quadro: divide no tempo `t` e insere um ImageClip (quadro congelado) de `hold` s, empurrando o resto */
export function freezeFrameOps(p: Project, clipId: Id, t: Seconds, imageAsset: { id: Id }, hold: Seconds = 2): { ops: EditOp[]; imageId?: Id } {
  const f = findClip(p, clipId);
  if (!f || f.clip.type !== 'video' || f.track.locked) return { ops: [] };
  if (t <= f.clip.start + EPS || t >= clipEnd(f.clip) - EPS) return { ops: [] };
  const image: Clip = {
    id: uid('clip'),
    type: 'image',
    assetId: imageAsset.id,
    start: t,
    duration: hold,
    transform: { ...f.clip.transform },
    filters: [...f.clip.filters],
    label: 'Quadro congelado',
  };
  return {
    ops: [...insertOps(f.track, t, hold), { op: 'add_clip', trackId: f.track.id, clip: image, explain: 'Congelando o quadro' }],
    imageId: image.id,
  };
}

/** aplica uma op localmente (p/ compor ops dependentes) — import tardio evita ciclo */
function applyLocal(p: Project, op: EditOp): Project {
  try {
    return applyOpFn(p, op);
  } catch {
    return p;
  }
}

/* ---------- batidas e marcadores (snapping e régua) ---------- */

/** batidas (asset.beats, em segundos da mídia) mapeadas para a timeline, só dentro dos clipes */
export function beatTimes(p: Project, assets: Record<Id, MediaAsset>): Seconds[] {
  const out: Seconds[] = [];
  for (const tr of p.tracks) {
    if (tr.hidden && tr.kind !== 'audio') continue;
    for (const c of tr.clips) {
      if (c.type !== 'audio' && c.type !== 'video') continue;
      const beats = assets[c.assetId]?.beats;
      if (!beats?.length) continue;
      const sp = c.speed > 0 ? c.speed : 1;
      const from = c.in;
      const to = c.in + c.duration * sp;
      for (const b of beats) if (b >= from - EPS && b <= to + EPS) out.push(c.start + (b - from) / sp);
    }
  }
  return out.sort((a, b) => a - b);
}

/** pontos extras de snapping: marcadores (início/fim) + batidas */
export function markerSnapPoints(p: Project, assets: Record<Id, MediaAsset>, exclude: Iterable<Id> = []): Seconds[] {
  const ex = new Set(exclude);
  const pts: Seconds[] = [];
  for (const m of p.markers ?? []) {
    if (ex.has(m.id)) continue;
    pts.push(m.t);
    if (m.end != null) pts.push(m.end);
  }
  return pts.concat(beatTimes(p, assets));
}
