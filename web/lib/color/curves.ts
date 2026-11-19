/* =====================================================================
   Curvas: spline cúbica monotônica (Fritsch–Carlson). Entre dois pontos
   a curva nunca passa do valor deles (sem overshoot) e, se os pontos são
   crescentes, a curva também é. Gera tabelas de 256 entradas p/ CPU/GPU.
   ===================================================================== */
import type { ColorGrade, CurvePoint } from '../types';
import { cleanCurve, clamp } from './grade';

export const CURVE_SIZE = 256;

/** função contínua y(x) da spline (x,y em 0..1) */
export function monotoneSpline(points: CurvePoint[]): (x: number) => number {
  const pts = cleanCurve(points) ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const n = pts.length;
  if (n === 1) return () => pts[0].y;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const d: number[] = []; // inclinações dos segmentos
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  // Fritsch–Carlson: limita as tangentes p/ garantir monotonicidade por segmento
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (!(x > xs[0])) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    i = lo;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    return clamp(y, 0, 1);
  };
}

/** tabela de 256 valores (x = i/255) */
export function curveTable(points?: CurvePoint[]): Float32Array {
  const t = new Float32Array(CURVE_SIZE);
  if (!points || !cleanCurve(points)) { for (let i = 0; i < CURVE_SIZE; i++) t[i] = i / (CURVE_SIZE - 1); return t; }
  const f = monotoneSpline(points);
  for (let i = 0; i < CURVE_SIZE; i++) t[i] = f(i / (CURVE_SIZE - 1));
  return t;
}

/** amostra a tabela com interpolação linear (igual ao filtro LINEAR da GPU) */
export function sampleTable(t: Float32Array, x: number): number {
  const f = clamp(x, 0, 1) * (t.length - 1);
  const i = Math.floor(f);
  if (i >= t.length - 1) return t[t.length - 1];
  const a = f - i;
  return t[i] + (t[i + 1] - t[i]) * a;
}

export interface CurveTables { master: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array }

export function gradeCurveTables(g: ColorGrade): CurveTables {
  const c = g.curves ?? {};
  return { master: curveTable(c.master), r: curveTable(c.r), g: curveTable(c.g), b: curveTable(c.b) };
}

/** textura 256×1 RGBA8: R/G/B = curva do canal, A = mestre */
export function curvesTextureData(t: CurveTables): Uint8Array {
  const out = new Uint8Array(CURVE_SIZE * 4);
  for (let i = 0; i < CURVE_SIZE; i++) {
    out[i * 4] = Math.round(t.r[i] * 255);
    out[i * 4 + 1] = Math.round(t.g[i] * 255);
    out[i * 4 + 2] = Math.round(t.b[i] * 255);
    out[i * 4 + 3] = Math.round(t.master[i] * 255);
  }
  return out;
}
