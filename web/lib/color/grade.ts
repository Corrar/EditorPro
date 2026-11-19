/* =====================================================================
   Correção de cor — utilidades puras sobre ColorGrade (sessão "cor").
   Neutralidade, saneamento (NaN/limites), combinação de grades e a
   aproximação em CSS (miniaturas / preview nativo quando é exata).
   ===================================================================== */
import type { ColorGrade, ColorWheel, CurvePoint, HslAdjust, HslBand } from '../types';

export const HSL_BANDS: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
/** centro de cada faixa (matiz 0..1) — mesma ordem de HSL_BANDS */
export const HSL_CENTERS = [0, 30 / 360, 60 / 360, 120 / 360, 180 / 360, 240 / 360, 270 / 360, 300 / 360];
export const HSL_LABELS: Record<HslBand, string> = {
  red: 'Vermelho', orange: 'Laranja', yellow: 'Amarelo', green: 'Verde',
  aqua: 'Ciano', blue: 'Azul', purple: 'Roxo', magenta: 'Magenta',
};

export const WHEEL_KEYS = ['lift', 'gamma', 'gain', 'offset'] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];
export const WHEEL_LABELS: Record<WheelKey, string> = { lift: 'Sombras', gamma: 'Médios', gain: 'Altas luzes', offset: 'Geral' };

export const SCALAR_KEYS = ['exposure', 'contrast', 'pivot', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows'] as const;
export type ScalarKey = (typeof SCALAR_KEYS)[number];

export const DEFAULT_PIVOT = 0.435;
export const NEUTRAL_WHEEL: ColorWheel = { r: 0, g: 0, b: 0, y: 0 };

const EPS = 1e-4;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** número finito ou o padrão (protege contra NaN/Infinity vindos de JSON/IA) */
export const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function isNeutralWheel(w?: ColorWheel): boolean {
  return !w || (Math.abs(num(w.r)) < EPS && Math.abs(num(w.g)) < EPS && Math.abs(num(w.b)) < EPS && Math.abs(num(w.y)) < EPS);
}

export function isIdentityCurve(pts?: CurvePoint[]): boolean {
  if (!pts || pts.length === 0) return true;
  return pts.every((p) => Math.abs(num(p.x) - num(p.y)) < EPS);
}

export function isNeutralHsl(h?: Partial<Record<HslBand, HslAdjust>>): boolean {
  if (!h) return true;
  return HSL_BANDS.every((b) => { const a = h[b]; return !a || (Math.abs(num(a.hue)) < EPS && Math.abs(num(a.sat)) < EPS && Math.abs(num(a.lum)) < EPS); });
}

export function hasCurves(g: ColorGrade): boolean {
  const c = g.curves;
  return !!c && !(isIdentityCurve(c.master) && isIdentityCurve(c.r) && isIdentityCurve(c.g) && isIdentityCurve(c.b));
}

/** a grade não muda nada (nenhum processamento necessário) */
export function isNeutralGrade(g?: ColorGrade | null): boolean {
  if (!g) return true;
  if (num(g.mix, 1) <= EPS) return true;
  for (const k of WHEEL_KEYS) if (!isNeutralWheel(g[k])) return false;
  for (const k of SCALAR_KEYS) {
    if (k === 'pivot') continue; // pivô sozinho não muda nada
    if (Math.abs(num(g[k])) >= EPS) return false;
  }
  if (hasCurves(g)) return false;
  if (!isNeutralHsl(g.hsl)) return false;
  if (g.lut && g.lut.id && num(g.lut.intensity, 1) > EPS) return false;
  return true;
}

function cleanWheel(w?: ColorWheel): ColorWheel | undefined {
  if (isNeutralWheel(w)) return undefined;
  return { r: clamp(num(w!.r), -1, 1), g: clamp(num(w!.g), -1, 1), b: clamp(num(w!.b), -1, 1), y: clamp(num(w!.y), -1, 1) };
}

/** curva saneada: pontos finitos em 0..1, ordenados por x, sem x duplicado; inclui as pontas */
export function cleanCurve(pts?: CurvePoint[]): CurvePoint[] | undefined {
  if (!pts || !pts.length) return undefined;
  const ok = pts
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
    .sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of ok) {
    if (out.length && p.x - out[out.length - 1].x < 1e-3) out[out.length - 1] = p; else out.push(p);
  }
  if (!out.length) return undefined;
  if (out[0].x > 1e-3) out.unshift({ x: 0, y: out[0].x === 0 ? out[0].y : 0 });
  if (out[out.length - 1].x < 1 - 1e-3) out.push({ x: 1, y: 1 });
  return isIdentityCurve(out) ? undefined : out;
}

/** saneia a grade: limites, NaN, remove o que é neutro (resultado mínimo, bom para salvar) */
export function normalizeGrade(g?: ColorGrade | null): ColorGrade | undefined {
  if (!g) return undefined;
  const out: ColorGrade = {};
  for (const k of WHEEL_KEYS) { const w = cleanWheel(g[k]); if (w) out[k] = w; }
  for (const k of SCALAR_KEYS) {
    const v = num(g[k], k === 'pivot' ? DEFAULT_PIVOT : 0);
    if (k === 'pivot') { if (Math.abs(v - DEFAULT_PIVOT) > EPS) out.pivot = clamp(v, 0.05, 0.95); continue; }
    if (Math.abs(v) >= EPS) out[k] = clamp(v, -1, 1);
  }
  if (g.curves) {
    const c: NonNullable<ColorGrade['curves']> = {};
    for (const ch of ['master', 'r', 'g', 'b'] as const) { const cc = cleanCurve(g.curves[ch]); if (cc) c[ch] = cc; }
    if (Object.keys(c).length) out.curves = c;
  }
  if (g.hsl) {
    const h: Partial<Record<HslBand, HslAdjust>> = {};
    for (const b of HSL_BANDS) {
      const a = g.hsl[b];
      if (!a) continue;
      const v = { hue: clamp(num(a.hue), -1, 1), sat: clamp(num(a.sat), -1, 1), lum: clamp(num(a.lum), -1, 1) };
      if (Math.abs(v.hue) >= EPS || Math.abs(v.sat) >= EPS || Math.abs(v.lum) >= EPS) h[b] = v;
    }
    if (Object.keys(h).length) out.hsl = h;
  }
  if (g.lut && typeof g.lut.id === 'string' && g.lut.id) {
    const i = clamp(num(g.lut.intensity, 1), 0, 1);
    if (i > EPS) out.lut = { id: g.lut.id, intensity: i };
  }
  const mix = clamp(num(g.mix, 1), 0, 1);
  if (mix < 1 - EPS) out.mix = mix;
  return isNeutralGrade(out) ? undefined : out;
}

const addW = (a?: ColorWheel, b?: ColorWheel): ColorWheel | undefined => {
  if (isNeutralWheel(a)) return b && { ...b };
  if (isNeutralWheel(b)) return a && { ...a };
  return { r: num(a!.r) + num(b!.r), g: num(a!.g) + num(b!.g), b: num(a!.b) + num(b!.b), y: num(a!.y) + num(b!.y) };
};

/**
 * Combina duas grades (ex.: correção do usuário + look). Escalares e rodas SOMAM
 * (limitados), curvas/HSL/LUT de `top` substituem as de `base` quando presentes.
 */
export function combineGrades(base?: ColorGrade, top?: ColorGrade): ColorGrade | undefined {
  if (!base) return normalizeGrade(top);
  if (!top) return normalizeGrade(base);
  const out: ColorGrade = { ...base };
  for (const k of WHEEL_KEYS) out[k] = addW(base[k], top[k]);
  for (const k of SCALAR_KEYS) {
    if (k === 'pivot') { if (top.pivot !== undefined) out.pivot = top.pivot; continue; }
    const s = num(base[k]) + num(top[k]);
    out[k] = s;
  }
  if (top.curves) out.curves = { ...(base.curves ?? {}), ...top.curves };
  if (top.hsl) {
    const h: Partial<Record<HslBand, HslAdjust>> = { ...(base.hsl ?? {}) };
    for (const b of HSL_BANDS) {
      const t = top.hsl[b];
      if (!t) continue;
      const a = h[b];
      h[b] = a ? { hue: num(a.hue) + num(t.hue), sat: num(a.sat) + num(t.sat), lum: num(a.lum) + num(t.lum) } : { ...t };
    }
    out.hsl = h;
  }
  if (top.lut) out.lut = { ...top.lut };
  if (top.mix !== undefined) out.mix = num(base.mix, 1) * num(top.mix, 1);
  return normalizeGrade(out);
}

/** iguais depois de normalizar (p/ evitar dispatch redundante) */
export function gradesEqual(a?: ColorGrade, b?: ColorGrade): boolean {
  return JSON.stringify(normalizeGrade(a) ?? null) === JSON.stringify(normalizeGrade(b) ?? null);
}

/* ---------- aproximação CSS ---------- */

const f3 = (v: number) => Number(v.toFixed(3));

/**
 * Aproximação de ctx.filter/CSS da grade (miniaturas, fallback sem WebGL).
 * Não representa curvas/HSL/LUT fielmente — só o "espírito" geral.
 */
export function gradeToCssFilter(g?: ColorGrade | null): string {
  const n = normalizeGrade(g);
  if (!n) return 'none';
  const mix = num(n.mix, 1);
  const parts: string[] = [];
  const offY = num(n.offset?.y) * 0.35 + num(n.gain?.y) * 0.35 + num(n.lift?.y) * 0.2 + num(n.gamma?.y) * 0.25;
  // exposição é linear no motor; no CSS (valores codificados) ≈ k^(1/2,2)
  const bright = Math.pow(2, (num(n.exposure) * 2) / 2.2) * (1 + offY) * (1 + num(n.shadows) * 0.12 + num(n.highlights) * 0.12);
  if (Math.abs(bright - 1) > 1e-3) parts.push(`brightness(${f3(1 + (bright - 1) * mix)})`);
  const con = num(n.contrast) >= 0 ? 1 + num(n.contrast) : 1 + num(n.contrast) * 0.9;
  if (Math.abs(con - 1) > 1e-3) parts.push(`contrast(${f3(1 + (con - 1) * mix)})`);
  const sat = Math.max(0, 1 + num(n.saturation) + num(n.vibrance) * 0.5);
  if (Math.abs(sat - 1) > 1e-3) parts.push(`saturate(${f3(1 + (sat - 1) * mix)})`);
  const temp = num(n.temperature) + (num(n.gain?.r) - num(n.gain?.b)) * 0.3 + (num(n.offset?.r) - num(n.offset?.b)) * 0.4;
  if (temp > 0.01) parts.push(`sepia(${f3(Math.min(0.6, temp * 0.45) * mix)})`);
  else if (temp < -0.01) parts.push(`hue-rotate(${f3(temp * 18 * mix)}deg)`);
  if (n.lut) parts.push(`contrast(${f3(1 + 0.06 * n.lut.intensity * mix)})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * Equivalente CSS EXATO o suficiente para o preview nativo (só exposição,
 * contraste com pivô ~0,5 e saturação). Senão null (cair para o canvas).
 */
export function gradeCssEquivalent(g?: ColorGrade | null): string | null {
  const n = normalizeGrade(g);
  if (!n) return 'none';
  const allowed = new Set(['exposure', 'contrast', 'saturation', 'mix']);
  for (const k of Object.keys(n)) if (!allowed.has(k)) return null;
  // contraste no CSS pivota em 0,5 — aceitável só se não houver contraste ou com pivô padrão próximo
  return gradeToCssFilter(n);
}
