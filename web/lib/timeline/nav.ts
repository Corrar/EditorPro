/* Navegação estilo DaVinci: pontos de corte (↑/↓), shuttle J/K/L e empurrar clipes quadro a quadro. */
import type { Id, Project, Seconds } from '../types';
import { clipEnd, findClip, type EditOp } from '../ops';

const EPS = 1e-3;

/** todos os pontos de edição (inícios/fins de clipes de trilhas visíveis), ordenados e sem repetição */
export function editPoints(p: Project): Seconds[] {
  const pts: Seconds[] = [0];
  for (const tr of p.tracks) {
    if (tr.hidden) continue;
    for (const c of tr.clips) pts.push(c.start, clipEnd(c));
  }
  pts.sort((a, b) => a - b);
  return pts.filter((t, i) => i === 0 || t - pts[i - 1] > EPS);
}

/** próximo (dir=1) ou anterior (dir=-1) ponto de edição a partir de t */
export function editPointNear(p: Project, t: Seconds, dir: 1 | -1): Seconds | null {
  const pts = editPoints(p);
  if (dir > 0) return pts.find((x) => x > t + EPS) ?? null;
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i] < t - EPS) return pts[i];
  return null;
}

/** shuttle: L acelera p/ frente (1→2→4→8), J p/ trás (-1→-2→-4→-8), K para */
export function shuttleNext(cur: number, key: 'j' | 'k' | 'l'): number {
  if (key === 'k') return 0;
  if (key === 'l') return cur <= 0 ? 1 : Math.min(8, cur * 2);
  return cur >= 0 ? -1 : Math.max(-8, cur * 2);
}

/** empurra os clipes selecionados `frames` quadros (para no 0 e não atravessa clipes vizinhos) */
export function nudgeOps(p: Project, ids: Id[], frames: number): EditOp[] {
  const fps = p.fps || 30;
  let d = frames / fps;
  const found = ids.map((id) => findClip(p, id)).filter((f): f is NonNullable<typeof f> => !!f && !f.track.locked && !f.clip.locked);
  if (!found.length || !d) return [];
  const sel = new Set(found.map((f) => f.clip.id));
  for (const f of found) {
    if (f.clip.start + d < 0) d = -f.clip.start;
    for (const o of f.track.clips) {
      if (sel.has(o.id)) continue;
      if (d > 0 && o.start >= clipEnd(f.clip) - EPS) d = Math.min(d, o.start - clipEnd(f.clip));
      if (d < 0 && clipEnd(o) <= f.clip.start + EPS) d = Math.max(d, clipEnd(o) - f.clip.start);
    }
  }
  if (Math.abs(d) < 1e-6) return [];
  return found.map((f) => ({ op: 'move_clip', clipId: f.clip.id, start: Math.round((f.clip.start + d) * fps) / fps }) as EditOp);
}

/** trecho In/Out do clipe sob o playhead (X no DaVinci): prefere a seleção */
export function clipRangeAt(p: Project, t: Seconds, selection: Id[]): { start: Seconds; end: Seconds } | null {
  for (const id of selection) {
    const f = findClip(p, id);
    if (f) return { start: f.clip.start, end: clipEnd(f.clip) };
  }
  for (const tr of p.tracks) {
    if (tr.hidden) continue;
    for (const c of tr.clips) if (t >= c.start - EPS && t < clipEnd(c) - EPS) return { start: c.start, end: clipEnd(c) };
  }
  return null;
}
