/* =====================================================================
   Pipeline de cor — referência em CPU (testes, fallback, bake de looks).
   O shader (shader.ts) implementa EXATAMENTE a mesma sequência, com os
   mesmos parâmetros resolvidos por resolveGrade():

   1. sRGB → linear; exposição (±2 stops) e balanço de branco (temp/tint,
      preservando luminância); linear → sRGB
   2. offset · gain · lift · gamma por canal (rodas, estilo DaVinci, no
      espaço codificado como o Resolve faz nas primárias)
   3. contraste com pivô
   4. realces / sombras (máscaras suaves de luminância)
   5. saturação + vibrance (Rec.709)
   6. HSL secundário (8 faixas, partição suave do matiz, ignora tons neutros)
   7. clamp 0..1 → curvas (mestre, depois R/G/B)
   8. LUT 3D trilinear com intensidade
   9. mistura com o original (mix)
   ===================================================================== */
import type { ColorGrade } from '../types';
import { HSL_BANDS, HSL_CENTERS, DEFAULT_PIVOT, WHEEL_KEYS, hasCurves, isNeutralHsl, normalizeGrade, num } from './grade';
import { gradeCurveTables, sampleTable, type CurveTables } from './curves';
import { sampleLut, type Lut3D } from './cube';

export const LUMA = [0.2126, 0.7152, 0.0722] as const;

export interface ResolvedGrade {
  expMul: number;
  wb: [number, number, number];
  offset: [number, number, number];
  gain: [number, number, number];
  lift: [number, number, number];
  gammaExp: [number, number, number];
  contrast: number;
  pivot: number;
  highlights: number;
  shadows: number;
  saturation: number;
  vibrance: number;
  /** 8 × (dh, ds, dl) */
  hsl: Float32Array;
  useHsl: boolean;
  curves: CurveTables | null;
  lut: Lut3D | null;
  lutIntensity: number;
  mix: number;
}

/** devolve a LUT (embutida/importada) pelo id, se carregada */
export type LutResolver = (id: string) => Lut3D | null | undefined;

const w3 = (g: ColorGrade, k: (typeof WHEEL_KEYS)[number]): [number, number, number] => {
  const w = g[k];
  if (!w) return [0, 0, 0];
  const y = num(w.y);
  return [num(w.r) + y, num(w.g) + y, num(w.b) + y];
};

export function resolveGrade(grade: ColorGrade | undefined, luts?: LutResolver): ResolvedGrade {
  const g = normalizeGrade(grade) ?? {};
  const t = num(g.temperature), tint = num(g.tint);
  // balanço de branco em linear: quente = mais R/menos B; tint>0 = magenta (menos G)
  let wr = (1 + 0.22 * t) * (1 + 0.09 * tint), wg = 1 - 0.18 * tint, wb = (1 - 0.22 * t) * (1 + 0.09 * tint);
  const k = 1 / (LUMA[0] * wr + LUMA[1] * wg + LUMA[2] * wb);
  wr *= k; wg *= k; wb *= k;
  const off = w3(g, 'offset'), gain = w3(g, 'gain'), lift = w3(g, 'lift'), gam = w3(g, 'gamma');
  const hsl = new Float32Array(24);
  if (g.hsl) HSL_BANDS.forEach((b, i) => { const a = g.hsl![b]; if (a) { hsl[i * 3] = num(a.hue); hsl[i * 3 + 1] = num(a.sat); hsl[i * 3 + 2] = num(a.lum); } });
  const c = num(g.contrast);
  const lut = g.lut ? luts?.(g.lut.id) ?? null : null;
  return {
    expMul: Math.pow(2, num(g.exposure) * 2),
    wb: [wr, wg, wb],
    offset: [off[0] * 0.35, off[1] * 0.35, off[2] * 0.35],
    gain: [Math.max(0, 1 + gain[0]), Math.max(0, 1 + gain[1]), Math.max(0, 1 + gain[2])],
    lift: [lift[0] * 0.5, lift[1] * 0.5, lift[2] * 0.5],
    gammaExp: [Math.pow(2, -gam[0] * 1.2), Math.pow(2, -gam[1] * 1.2), Math.pow(2, -gam[2] * 1.2)],
    contrast: c >= 0 ? 1 + c : 1 + c * 0.9,
    pivot: num(g.pivot, DEFAULT_PIVOT),
    highlights: num(g.highlights),
    shadows: num(g.shadows),
    saturation: Math.max(0, 1 + num(g.saturation)),
    vibrance: num(g.vibrance),
    hsl,
    useHsl: !isNeutralHsl(g.hsl),
    curves: hasCurves(g) ? gradeCurveTables(g) : null,
    lut,
    lutIntensity: lut ? num(g.lut?.intensity, 1) : 0,
    mix: num(g.mix, 1),
  };
}

/* ---------- funções básicas (espelhadas no GLSL) ---------- */

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** pesos das 8 faixas para o matiz h (0..1): partição da unidade com transição suave */
export function bandWeights(h: number, out: Float32Array | number[]): void {
  for (let i = 0; i < 8; i++) {
    const c = HSL_CENTERS[i];
    const prev = HSL_CENTERS[(i + 7) % 8], next = HSL_CENTERS[(i + 1) % 8];
    let d = h - c;
    d -= Math.floor(d + 0.5); // -0,5..0,5
    let w: number;
    if (d < 0) {
      const span = ((c - prev) % 1 + 1) % 1;
      const t = 1 + d / span;
      w = t <= 0 ? 0 : t * t * (3 - 2 * t);
    } else {
      const span = ((next - c) % 1 + 1) % 1;
      const t = 1 - d / span;
      w = t <= 0 ? 0 : t * t * (3 - 2 * t);
    }
    out[i] = w;
  }
}

export function rgbToHsv(r: number, g: number, b: number, out: number[] | Float32Array) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    if (h < 0) h += 1;
  }
  out[0] = h; out[1] = mx > 1e-6 ? d / mx : 0; out[2] = mx;
}

export function hsvToRgb(h: number, s: number, v: number, out: number[] | Float32Array) {
  // mesma fórmula do GLSL (sem ramificações)
  const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  out[0] = f(5); out[1] = f(3); out[2] = f(1);
}

const bw = new Float32Array(8);
const hsv = new Float32Array(3);

/** aplica a grade resolvida a UM pixel (rgb 0..1 codificado), escrevendo em out */
export function gradePixel(R: ResolvedGrade, r0: number, g0: number, b0: number, out: Float32Array | number[]): void {
  // 1. exposição + balanço de branco em linear
  let r = linearToSrgb(Math.max(0, srgbToLinear(r0) * R.expMul * R.wb[0]));
  let g = linearToSrgb(Math.max(0, srgbToLinear(g0) * R.expMul * R.wb[1]));
  let b = linearToSrgb(Math.max(0, srgbToLinear(b0) * R.expMul * R.wb[2]));
  // 2. rodas
  r = (r + R.offset[0]) * R.gain[0]; g = (g + R.offset[1]) * R.gain[1]; b = (b + R.offset[2]) * R.gain[2];
  r = r + R.lift[0] * (1 - r); g = g + R.lift[1] * (1 - g); b = b + R.lift[2] * (1 - b);
  r = Math.pow(Math.max(r, 0), R.gammaExp[0]); g = Math.pow(Math.max(g, 0), R.gammaExp[1]); b = Math.pow(Math.max(b, 0), R.gammaExp[2]);
  // 3. contraste com pivô
  r = (r - R.pivot) * R.contrast + R.pivot; g = (g - R.pivot) * R.contrast + R.pivot; b = (b - R.pivot) * R.contrast + R.pivot;
  // 4. realces/sombras
  let l = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const hs = R.shadows * (1 - smoothstep(0, 0.5, l)) * 0.3 + R.highlights * smoothstep(0.5, 1, l) * 0.3;
  r += hs; g += hs; b += hs;
  // 5. saturação + vibrance
  l = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const cs = Math.max(r, g, b) - Math.min(r, g, b);
  const sf = R.saturation * (1 + R.vibrance * (1 - smoothstep(0, 0.6, cs)));
  r = l + (r - l) * sf; g = l + (g - l) * sf; b = l + (b - l) * sf;
  // 6. HSL secundário
  if (R.useHsl) {
    rgbToHsv(clamp01(r), clamp01(g), clamp01(b), hsv);
    bandWeights(hsv[0], bw);
    let dh = 0, ds = 0, dl = 0;
    for (let i = 0; i < 8; i++) { dh += bw[i] * R.hsl[i * 3]; ds += bw[i] * R.hsl[i * 3 + 1]; dl += bw[i] * R.hsl[i * 3 + 2]; }
    const m = smoothstep(0.03, 0.25, hsv[1]) * smoothstep(0.0, 0.08, hsv[2]);
    let h = hsv[0] + dh * m / 12;
    h -= Math.floor(h);
    hsvToRgb(h, clamp01(hsv[1] * (1 + ds * m)), hsv[2] * (1 + dl * m * 0.5), hsv);
    r = hsv[0]; g = hsv[1]; b = hsv[2];
  }
  // 7. curvas
  r = clamp01(r); g = clamp01(g); b = clamp01(b);
  if (R.curves) {
    const C = R.curves;
    r = sampleTable(C.r, sampleTable(C.master, r));
    g = sampleTable(C.g, sampleTable(C.master, g));
    b = sampleTable(C.b, sampleTable(C.master, b));
  }
  // 8. LUT
  if (R.lut && R.lutIntensity > 0) {
    sampleLut(R.lut, r, g, b, hsv);
    const k = R.lutIntensity;
    r += (clamp01(hsv[0]) - r) * k; g += (clamp01(hsv[1]) - g) * k; b += (clamp01(hsv[2]) - b) * k;
  }
  // 9. mix
  out[0] = r0 + (r - r0) * R.mix; out[1] = g0 + (g - g0) * R.mix; out[2] = b0 + (b - b0) * R.mix;
}

/** aplica a grade a um ImageData (no lugar). Retorna o próprio ImageData. */
export function applyGradeImageData(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, grade: ColorGrade | undefined, luts?: LutResolver): typeof img {
  const R = resolveGrade(grade, luts);
  const d = img.data;
  const o = new Float32Array(3);
  // tabela 8-bit → float evita pow repetido no decode
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    gradePixel(R, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, o);
    d[i] = Math.round(clamp01(o[0]) * 255); d[i + 1] = Math.round(clamp01(o[1]) * 255); d[i + 2] = Math.round(clamp01(o[2]) * 255);
  }
  return img;
}
