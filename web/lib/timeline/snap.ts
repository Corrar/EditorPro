/* =====================================================================
   Timeline — snapping (ímã). Lógica pura, sem React.
   Pontos de encaixe: início/fim de clipes, playhead, legendas e o zero.
   ===================================================================== */
import type { Id, Project, Seconds } from '../types';
import { clipEnd } from '../ops';

export interface SnapOptions {
  /** clipes (ou segmentos de legenda) ignorados — normalmente os que estão sendo arrastados */
  exclude?: Iterable<Id>;
  playhead?: Seconds;
  /** inclui bordas dos segmentos de legenda (padrão: true) */
  captions?: boolean;
  /** pontos extras (marcadores etc.) */
  extra?: Seconds[];
}

/** todos os pontos de encaixe do projeto, ordenados e sem repetição */
export function collectSnapPoints(p: Project, opts: SnapOptions = {}): Seconds[] {
  const ex = new Set(opts.exclude ?? []);
  const pts: Seconds[] = [0];
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (ex.has(c.id)) continue;
      pts.push(c.start, clipEnd(c));
    }
  if (opts.captions !== false)
    for (const s of p.captions.segments) {
      if (ex.has(s.id)) continue;
      pts.push(s.start, s.end);
    }
  if (opts.playhead != null) pts.push(opts.playhead);
  if (opts.extra) pts.push(...opts.extra);
  pts.sort((a, b) => a - b);
  const out: Seconds[] = [];
  for (const t of pts) if (!out.length || Math.abs(t - out[out.length - 1]) > 1e-6) out.push(t);
  return out;
}

/** ponto mais próximo de `t` (busca binária) */
export function nearestPoint(t: Seconds, points: Seconds[]): Seconds | undefined {
  if (!points.length) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = lo > 0 ? points[lo - 1] : undefined;
  return b != null && Math.abs(b - t) <= Math.abs(a - t) ? b : a;
}

export interface SnapResult {
  t: Seconds;
  /** ponto onde encaixou (p/ desenhar a linha-guia) */
  point?: Seconds;
}

/** encaixa um instante se houver ponto dentro do limiar (em segundos) */
export function snapTime(t: Seconds, points: Seconds[], threshold: Seconds): SnapResult {
  const n = nearestPoint(t, points);
  if (n != null && Math.abs(n - t) <= threshold) return { t: n, point: n };
  return { t };
}

export interface SpanSnapResult {
  start: Seconds;
  edge?: 'start' | 'end';
  point?: Seconds;
}

/** encaixa um intervalo [start, start+duration] pela borda mais próxima de algum ponto */
export function snapSpan(start: Seconds, duration: Seconds, points: Seconds[], threshold: Seconds): SpanSnapResult {
  const a = snapTime(start, points, threshold);
  const b = snapTime(start + duration, points, threshold);
  const da = a.point != null ? Math.abs(a.point - start) : Infinity;
  const db = b.point != null ? Math.abs(b.point - (start + duration)) : Infinity;
  if (da === Infinity && db === Infinity) return { start };
  if (da <= db) return { start: a.t, edge: 'start', point: a.point };
  return { start: b.t - duration, edge: 'end', point: b.point };
}

/** limiar de encaixe em segundos para um raio em pixels no zoom atual */
export function snapThreshold(zoom: number, px = 8): Seconds {
  return px / Math.max(zoom, 1e-6);
}
