/* Trims profissionais (estilo DaVinci): ripple, roll, slip e slide + vínculo áudio/vídeo.
 * Funções puras: recebem o projeto e devolvem EditOp[] (um array = um desfazer). */
import type { Clip, Id, MediaAsset, Project, Seconds, Track } from '../types';
import { clipEnd, findClip, type EditOp } from '../ops';
import { MIN_CLIP } from './edit';

const EPS = 1e-4;

export type TrimTool = 'ripple' | 'roll' | 'slip' | 'slide';
export interface Range { min: Seconds; max: Seconds }

const sp = (c: Clip) => (c.type === 'video' || c.type === 'audio' ? (c.speed > 0 ? c.speed : 1) : 1);
const hasMedia = (c: Clip): c is Extract<Clip, { type: 'video' | 'audio' }> => c.type === 'video' || c.type === 'audio';

/** limite de onde a ponta pode ir só pela mídia (sem olhar vizinhos) */
function mediaRange(c: Clip, asset: MediaAsset | undefined): { minStart: Seconds; maxEnd: Seconds } {
  if (!hasMedia(c)) return { minStart: 0, maxEnd: Infinity };
  const s = sp(c);
  const minStart = Math.max(0, c.start - c.in / s);
  const maxEnd = asset && asset.duration > 0 ? c.start + (asset.duration - c.in) / s : Infinity;
  return { minStart, maxEnd };
}

const clamp = (v: number, r: Range) => Math.max(r.min, Math.min(r.max, v));

/* ---------------- ripple ---------------- */

/** faixa de tempo para a ponta num ripple trim (o clipe fica parado; o resto da trilha anda) */
export function rippleRange(c: Clip, edge: 'start' | 'end', asset: MediaAsset | undefined, minDur = MIN_CLIP): Range {
  const end = clipEnd(c);
  if (edge === 'end') return { min: c.start + minDur, max: Math.max(end, mediaRange(c, asset).maxEnd) };
  // início: a mídia anterior que dá para revelar = in/speed (até t >= 0 virtual)
  const back = hasMedia(c) ? c.in / sp(c) : Infinity;
  return { min: c.start - back, max: end - minDur };
}

/** ripple trim: apara a ponta e empurra/puxa os clipes seguintes da mesma trilha.
 *  `t` = onde a ponta ficaria (tempo de timeline, já limitado pela faixa). */
export function rippleTrimOps(p: Project, clipId: Id, edge: 'start' | 'end', t: Seconds): EditOp[] {
  const f = findClip(p, clipId);
  if (!f) return [];
  const c = f.clip;
  const end = clipEnd(c);
  const delta = edge === 'end' ? t - end : c.start - t; // >0 = trecho cresce
  if (Math.abs(delta) < EPS) return [];
  const ops: EditOp[] = [];
  if (edge === 'end') ops.push({ op: 'trim_clip', clipId, end: t });
  else {
    // muda o ponto de entrada mantendo o clipe no lugar: apara/estica o início e devolve à posição
    ops.push({ op: 'trim_clip', clipId, start: c.start - delta });
    ops.push({ op: 'move_clip', clipId, start: c.start });
  }
  for (const o of f.track.clips) {
    if (o.id === clipId || o.start < end - EPS) continue;
    ops.push({ op: 'move_clip', clipId: o.id, start: Math.max(0, o.start + delta) });
  }
  return ops;
}

/* ---------------- roll ---------------- */

/** os dois clipes que dividem o corte na ponta pedida (encostados) */
export function rollPair(track: Track, c: Clip, edge: 'start' | 'end'): { left: Clip; right: Clip } | null {
  if (edge === 'end') {
    const end = clipEnd(c);
    const right = track.clips.find((o) => o.id !== c.id && Math.abs(o.start - end) < 1e-3);
    return right ? { left: c, right } : null;
  }
  const left = track.clips.find((o) => o.id !== c.id && Math.abs(clipEnd(o) - c.start) < 1e-3);
  return left ? { left, right: c } : null;
}

export function rollRange(left: Clip, right: Clip, assets: Record<Id, MediaAsset>, minDur = MIN_CLIP): Range {
  const la = hasMedia(left) ? assets[left.assetId] : undefined;
  const ra = hasMedia(right) ? assets[right.assetId] : undefined;
  return {
    min: Math.max(left.start + minDur, mediaRange(right, ra).minStart),
    max: Math.min(clipEnd(right) - minDur, mediaRange(left, la).maxEnd),
  };
}

/** roll: move o ponto de corte entre dois clipes encostados (duração total não muda) */
export function rollOps(left: Clip, right: Clip, t: Seconds): EditOp[] {
  const cut = right.start;
  if (Math.abs(t - cut) < EPS) return [];
  // primeiro encolhe quem perde espaço (nunca há sobreposição no meio do caminho)
  const shrink: EditOp = t > cut ? { op: 'trim_clip', clipId: right.id, start: t } : { op: 'trim_clip', clipId: left.id, end: t };
  const grow: EditOp = t > cut ? { op: 'trim_clip', clipId: left.id, end: t } : { op: 'trim_clip', clipId: right.id, start: t };
  return [shrink, grow];
}

/* ---------------- slip ---------------- */

/** faixa do ponto de entrada (`in`) num slip: o clipe fica no lugar, o trecho da mídia anda */
export function slipRange(c: Clip, asset: MediaAsset | undefined): Range | null {
  if (!hasMedia(c)) return null;
  const used = c.duration * sp(c);
  const max = asset && asset.duration > 0 ? Math.max(0, asset.duration - used) : Infinity;
  return { min: 0, max: Math.max(max, c.in) };
}

export function slipOps(c: Clip, newIn: Seconds, asset: MediaAsset | undefined): EditOp[] {
  const r = slipRange(c, asset);
  if (!r || !hasMedia(c)) return [];
  const v = clamp(newIn, r);
  if (Math.abs(v - c.in) < EPS) return [];
  return [{ op: 'update_clip', clipId: c.id, patch: { in: v } }];
}

/* ---------------- slide ---------------- */

interface SlideCtx { prev?: Clip; next?: Clip; prevAdj: boolean; nextAdj: boolean }

function slideCtx(track: Track, c: Clip): SlideCtx {
  const end = clipEnd(c);
  const before = track.clips.filter((o) => o.id !== c.id && clipEnd(o) <= c.start + 1e-3);
  const after = track.clips.filter((o) => o.id !== c.id && o.start >= end - 1e-3);
  const prev = before.sort((a, b) => clipEnd(b) - clipEnd(a))[0];
  const next = after.sort((a, b) => a.start - b.start)[0];
  return {
    prev, next,
    prevAdj: !!prev && Math.abs(clipEnd(prev) - c.start) < 1e-3,
    nextAdj: !!next && Math.abs(next.start - end) < 1e-3,
  };
}

/** faixa do novo início num slide (vizinhos encostados esticam/encolhem; sem vizinho, o espaço vazio limita) */
export function slideRange(track: Track, c: Clip, assets: Record<Id, MediaAsset>, minDur = MIN_CLIP): Range {
  const { prev, next, prevAdj, nextAdj } = slideCtx(track, c);
  const d = c.duration;
  let min = 0;
  let max = Infinity;
  if (prev) {
    if (prevAdj) {
      min = Math.max(min, prev.start + minDur);
      const pa = hasMedia(prev) ? assets[prev.assetId] : undefined;
      max = Math.min(max, mediaRange(prev, pa).maxEnd);
    } else min = Math.max(min, clipEnd(prev));
  }
  if (next) {
    if (nextAdj) {
      max = Math.min(max, clipEnd(next) - minDur - d);
      const na = hasMedia(next) ? assets[next.assetId] : undefined;
      min = Math.max(min, mediaRange(next, na).minStart - d);
    } else max = Math.min(max, next.start - d);
  }
  return { min: Math.min(min, c.start), max: Math.max(max, c.start) };
}

export function slideOps(track: Track, c: Clip, newStart: Seconds): EditOp[] {
  const delta = newStart - c.start;
  if (Math.abs(delta) < EPS) return [];
  const { prev, next, prevAdj, nextAdj } = slideCtx(track, c);
  const ops: EditOp[] = [];
  const newEnd = newStart + c.duration;
  // encolhe primeiro o vizinho que perde espaço
  if (delta > 0 && next && nextAdj) ops.push({ op: 'trim_clip', clipId: next.id, start: newEnd });
  if (delta < 0 && prev && prevAdj) ops.push({ op: 'trim_clip', clipId: prev.id, end: newStart });
  ops.push({ op: 'move_clip', clipId: c.id, start: newStart });
  if (delta > 0 && prev && prevAdj) ops.push({ op: 'trim_clip', clipId: prev.id, end: newStart });
  if (delta < 0 && next && nextAdj) ops.push({ op: 'trim_clip', clipId: next.id, start: newEnd });
  return ops;
}

/* ---------------- cortar em todas as trilhas ---------------- */

/** divide no tempo `t` todo clipe (de trilha não travada) que cruza o cursor, ignorando a seleção */
export function splitAllOps(p: Project, t: Seconds, newId: () => Id): EditOp[] {
  const ops: EditOp[] = [];
  for (const tr of p.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips)
      if (!c.locked && t > c.start + EPS && t < clipEnd(c) - EPS) ops.push({ op: 'split_clip', clipId: c.id, at: t, newId: newId() });
  }
  return ops;
}

/* ---------------- vínculo áudio/vídeo ---------------- */

/** expande ids com os clipes vinculados (mesmo `linkId`) */
export function expandLinks(p: Project, ids: Id[]): Id[] {
  const links = new Set<string>();
  for (const id of ids) {
    const l = findClip(p, id)?.clip.linkId;
    if (l) links.add(l);
  }
  if (!links.size) return ids;
  const out = new Set(ids);
  for (const tr of p.tracks) for (const c of tr.clips) if (c.linkId && links.has(c.linkId)) out.add(c.id);
  return [...out];
}

/** clipes vinculados a `id` cuja ponta coincide (aparam junto); Alt/J-L cut ignora isso */
export function linkedEdgePartners(p: Project, id: Id, edge: 'start' | 'end'): Clip[] {
  const f = findClip(p, id);
  const l = f?.clip.linkId;
  if (!f || !l) return [];
  const at = edge === 'start' ? f.clip.start : clipEnd(f.clip);
  const out: Clip[] = [];
  for (const tr of p.tracks) {
    if (tr.locked) continue;
    for (const c of tr.clips)
      if (c.id !== id && c.linkId === l && Math.abs((edge === 'start' ? c.start : clipEnd(c)) - at) < 1e-3) out.push(c);
  }
  return out;
}

export function linkOps(p: Project, ids: Id[], linkId: Id): EditOp[] {
  return ids.filter((id) => !!findClip(p, id)).map((id) => ({ op: 'update_clip', clipId: id, patch: { linkId } }) as EditOp);
}

export function unlinkOps(p: Project, ids: Id[]): EditOp[] {
  return expandLinks(p, ids)
    .filter((id) => !!findClip(p, id)?.clip.linkId)
    .map((id) => ({ op: 'update_clip', clipId: id, patch: { linkId: undefined } }) as EditOp);
}

/* ---------------- sessão de arraste (usada pela UI) ---------------- */

export interface ClipOverride { start: Seconds; duration: Seconds; in?: Seconds }
/** quadro mostrado no monitor de trim: clipe + tempo na mídia */
export interface MonitorFrame { clipId: Id; srcT: Seconds; label: string }

export interface ProSession {
  tool: TrimTool;
  clipId: Id;
  edge?: 'start' | 'end';
  /** faixa válida do deslocamento (s de timeline) */
  range: Range;
  /** tempos que podem encaixar no ímã (posições em delta = 0); vazio = sem ímã */
  snapRefs: Seconds[];
  build: (delta: Seconds) => EditOp[];
  /** ids que a prévia precisa redesenhar */
  touched: Id[];
}

const inter = (a: Range, b: Range): Range => ({ min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) });

/** monta uma sessão de trim profissional; `alt` = só este clipe (ignora vínculo: J/L-cut) */
export function proSession(
  p: Project, assets: Record<Id, MediaAsset>, tool: TrimTool, clipId: Id, edge: 'start' | 'end' | undefined, alt: boolean, minDur = MIN_CLIP,
): ProSession | null {
  const f = findClip(p, clipId);
  if (!f || f.track.locked || f.clip.locked) return null;
  const assetOf = (c: Clip) => (hasMedia(c) ? assets[c.assetId] : undefined);
  const trackOf = (c: Clip) => findClip(p, c.id)!.track;
  const full: Range = { min: -Infinity, max: Infinity };

  if (tool === 'ripple' || tool === 'roll') {
    const e = edge ?? 'end';
    const parts = [f.clip, ...(alt ? [] : linkedEdgePartners(p, clipId, e))];
    if (tool === 'ripple') {
      let range = full;
      for (const c of parts) {
        const b = e === 'end' ? clipEnd(c) : c.start;
        const r = rippleRange(c, e, assetOf(c), minDur);
        range = inter(range, { min: r.min - b, max: r.max - b });
      }
      const touched = new Set<Id>();
      for (const c of parts) {
        touched.add(c.id);
        for (const o of trackOf(c).clips) if (o.start >= clipEnd(c) - EPS) touched.add(o.id);
      }
      return {
        tool, clipId, edge: e, range,
        snapRefs: e === 'end' ? [clipEnd(f.clip)] : [],
        touched: [...touched],
        build: (d) => parts.flatMap((c) => rippleTrimOps(p, c.id, e, (e === 'end' ? clipEnd(c) : c.start) + d)),
      };
    }
    const pairs = parts.map((c) => rollPair(trackOf(c), c, e)).filter((x): x is { left: Clip; right: Clip } => !!x);
    if (!pairs.length || !rollPair(f.track, f.clip, e)) return null;
    let range = full;
    for (const pr of pairs) {
      const r = rollRange(pr.left, pr.right, assets, minDur);
      range = inter(range, { min: r.min - pr.right.start, max: r.max - pr.right.start });
    }
    const main = pairs[0];
    return {
      tool, clipId, edge: e, range,
      snapRefs: [main.right.start],
      touched: pairs.flatMap((pr) => [pr.left.id, pr.right.id]),
      build: (d) => pairs.flatMap((pr) => rollOps(pr.left, pr.right, pr.right.start + d)),
    };
  }

  const linked = alt ? [clipId] : expandLinks(p, [clipId]);
  const parts = linked.map((id) => findClip(p, id)).filter((x): x is NonNullable<typeof x> => !!x && !x.track.locked && !x.clip.locked).map((x) => x.clip);

  if (tool === 'slip') {
    const media = parts.filter(hasMedia);
    if (!hasMedia(f.clip)) return null;
    let range = full;
    for (const c of media) {
      const r = slipRange(c, assetOf(c))!;
      const s = sp(c);
      // in' = in - d*s  (arrastar p/ a direita "puxa" a mídia junto com o dedo)
      range = inter(range, { min: (c.in - r.max) / s, max: (c.in - r.min) / s });
    }
    return {
      tool, clipId, range, snapRefs: [], touched: media.map((c) => c.id),
      build: (d) => media.flatMap((c) => slipOps(c, c.in - d * sp(c), assetOf(c))),
    };
  }

  // slide
  let range = full;
  for (const c of parts) {
    const r = slideRange(trackOf(c), c, assets, minDur);
    range = inter(range, { min: r.min - c.start, max: r.max - c.start });
  }
  const touched = new Set<Id>();
  for (const c of parts) {
    touched.add(c.id);
    const ctx = slideCtx(trackOf(c), c);
    if (ctx.prevAdj && ctx.prev) touched.add(ctx.prev.id);
    if (ctx.nextAdj && ctx.next) touched.add(ctx.next.id);
  }
  return {
    tool, clipId, range,
    snapRefs: [f.clip.start, clipEnd(f.clip)],
    touched: [...touched],
    build: (d) => parts.flatMap((c) => slideOps(trackOf(c), c, c.start + d)),
  };
}

/** valores (start/duração/in) dos clipes tocados depois das ops, p/ desenhar a prévia */
export function overridesAfter(after: Project, touched: Id[]): Record<Id, ClipOverride> {
  const out: Record<Id, ClipOverride> = {};
  for (const id of touched) {
    const c = findClip(after, id)?.clip;
    if (!c) continue;
    out[id] = { start: c.start, duration: c.duration, ...(hasMedia(c) ? { in: c.in } : {}) };
  }
  return out;
}

/** quadros do monitor de trim (estilo 2-up do DaVinci): lado A = saída, lado B = entrada */
export function monitorFrames(after: Project, s: ProSession): [MonitorFrame | null, MonitorFrame | null] {
  const f = findClip(after, s.clipId);
  if (!f) return [null, null];
  const c = f.clip;
  const outOf = (x: Clip): MonitorFrame | null => (hasMedia(x) ? { clipId: x.id, srcT: x.in + x.duration * sp(x) - 1 / 30, label: 'Saída' } : null);
  const inOf = (x: Clip): MonitorFrame | null => (hasMedia(x) ? { clipId: x.id, srcT: x.in, label: 'Entrada' } : null);
  const ctx = slideCtx(f.track, c);
  if (s.tool === 'slip') return [inOf(c), outOf(c)];
  if (s.tool === 'slide') return [ctx.prev ? outOf(ctx.prev) : null, ctx.next ? inOf(ctx.next) : null];
  if (s.edge === 'end') return [outOf(c), ctx.next ? inOf(ctx.next) : null];
  return [ctx.prev ? outOf(ctx.prev) : null, inOf(c)];
}
