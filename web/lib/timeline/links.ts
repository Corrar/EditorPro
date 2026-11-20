/* Vínculo áudio↔vídeo (linkId) e grupos (groupId): regras que mantêm pares e modelos coerentes
 * depois de cortar, reempacotar (trilha magnética), duplicar e colar. Funções puras. */
import type { Clip, Id, Project, Seconds } from '../types';
import { applyOps, clipEnd, findClip, type EditOp } from '../ops';
import { uid } from '../util';

const EPS = 1e-4;

/** vínculo da metade direita de um corte: derivado do vínculo antigo + instante (determinístico) —
 *  parceiros cortados no mesmo instante continuam vinculados entre si, cada pedaço só ao seu par */
export function splitLinkId(linkId: Id, at: Seconds): Id {
  return `${linkId}~${Math.round(at * 1000).toString(36)}`;
}

/** ops extras (update_clip linkId) p/ as metades direitas dos split_clip de clipes vinculados */
export function relinkSplitOps(p: Project, ops: EditOp[]): EditOp[] {
  if (!ops.some((o) => o.op === 'split_clip')) return [];
  const extra: EditOp[] = [];
  let proj = p;
  for (const op of ops) {
    if (op.op === 'split_clip' && op.newId) {
      const c = findClip(proj, op.clipId)?.clip;
      if (c?.linkId) extra.push({ op: 'update_clip', clipId: op.newId, patch: { linkId: splitLinkId(c.linkId, op.at) } });
    }
    try { proj = applyOps(proj, [op]).project; } catch { return extra; }
  }
  return extra;
}

/**
 * Trilha magnética: depois de `userOps`, o reempacotamento (`packOps`) desloca clipes da trilha
 * principal. Os parceiros vinculados em outras trilhas recebem o mesmo deslocamento (medido contra
 * o estado DEPOIS das ops do usuário), para o áudio não sair de sincronia.
 */
export function syncLinkedAfterPack(p: Project, userOps: EditOp[], pack: EditOp[], mainId: Id | undefined): EditOp[] {
  if (!mainId || !pack.length) return [];
  let next: Project;
  let packed: Project;
  try {
    next = applyOps(p, userOps).project;
    packed = applyOps(next, pack).project;
  } catch {
    return [];
  }
  const main = next.tracks.find((t) => t.id === mainId);
  const mainPacked = packed.tracks.find((t) => t.id === mainId);
  if (!main || !mainPacked) return [];
  const shift = new Map<Id, Seconds>(); // linkId -> Δ
  for (const c of main.clips) {
    if (!c.linkId) continue;
    const after = mainPacked.clips.find((x) => x.id === c.id);
    if (!after) continue;
    const d = after.start - c.start;
    if (Math.abs(d) > EPS && !shift.has(c.linkId)) shift.set(c.linkId, d);
  }
  if (!shift.size) return [];
  const out: EditOp[] = [];
  const moving = new Set<Id>();
  for (const tr of packed.tracks) {
    if (tr.id === mainId || tr.locked) continue;
    for (const c of tr.clips) if (c.linkId && shift.has(c.linkId)) moving.add(c.id);
  }
  for (const tr of packed.tracks) {
    if (tr.id === mainId || tr.locked) continue;
    for (const c of tr.clips) {
      if (!c.linkId || !shift.has(c.linkId)) continue;
      const want = c.start + shift.get(c.linkId)!;
      // J-cut (áudio começa antes do vídeo) indo para antes de 0: corta a cabeça que sobra em vez de
      // só travar em 0 — travar deslocava o áudio inteiro e o deixava fora de sincronia
      const head = want < -EPS && -want < c.duration - EPS ? -want : 0;
      const start = Math.max(0, want);
      // se o destino bater num clipe que não anda junto, abre espaço empurrando o resto (inserir)
      const end = start + c.duration - head;
      const hit = tr.clips.filter((o) => !moving.has(o.id) && o.start < end - EPS && clipEnd(o) > start + EPS);
      if (hit.length) {
        const push = end - Math.min(...hit.map((o) => o.start));
        for (const o of tr.clips)
          if (!moving.has(o.id) && o.start >= Math.min(...hit.map((h) => h.start)) - EPS) out.push({ op: 'move_clip', clipId: o.id, start: o.start + push });
      }
      if (head) out.push({ op: 'trim_clip', clipId: c.id, start: c.start + head });
      out.push({ op: 'move_clip', clipId: c.id, start });
    }
  }
  return out;
}

/** mapa de remapeamento por lote: id que aparece 2+ vezes ganha um novo; 1 vez = some (undefined) */
export function batchRemap(values: (Id | undefined)[], prefix: string): Map<Id, Id | undefined> {
  const count = new Map<Id, number>();
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  const m = new Map<Id, Id | undefined>();
  for (const [v, n] of count) m.set(v, n >= 2 ? uid(prefix) : undefined);
  return m;
}

/** aplica o remapeamento de vínculo/grupo num clone (colar) */
export function remapClone(clip: Clip, links: Map<Id, Id | undefined>, groups: Map<Id, Id | undefined>): Clip {
  const out = { ...clip } as Clip;
  if (clip.linkId) {
    const l = links.get(clip.linkId);
    if (l) out.linkId = l;
    else delete out.linkId;
  }
  if (clip.groupId) {
    const g = groups.get(clip.groupId);
    if (g) out.groupId = g;
    else delete out.groupId;
  }
  return out;
}
