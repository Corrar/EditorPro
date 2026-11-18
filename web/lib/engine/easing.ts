/* easing + interpolação de keyframes (puro) */
import type { Easing, Keyframe, Transform } from '../types';
import { DEFAULT_TRANSFORM } from '../types';

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function ease(kind: Easing | undefined, t: number): number {
  const x = clamp01(t);
  switch (kind) {
    case 'easeIn': return x * x * x;
    case 'easeOut': return 1 - Math.pow(1 - x, 3);
    case 'easeInOut': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    default: return x;
  }
}

export const easeOutBack = (t: number, s = 1.70158) => {
  const x = clamp01(t) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};

export const easeOutBounce = (t: number) => {
  let x = clamp01(t);
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

const KEYS: (keyof Transform)[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

/**
 * Transform efetivo no tempo `local` (relativo ao início do clipe).
 * Cada propriedade é interpolada só entre keyframes que a definem; fora do
 * intervalo segura o valor do keyframe mais próximo. Sem keyframes p/ a
 * propriedade, usa o transform base do clipe. O easing de um keyframe vale
 * para o trecho que TERMINA nele.
 */
export function interpolateTransform(base: Transform | undefined, keyframes: Keyframe[] | undefined, local: number): Transform {
  const b = { ...DEFAULT_TRANSFORM, ...(base ?? {}) };
  if (!keyframes || keyframes.length === 0) return b;
  const sorted = [...keyframes].sort((a, c) => a.t - c.t);
  const out = { ...b };
  for (const key of KEYS) {
    const ks = sorted.filter((k) => typeof k.transform[key] === 'number');
    if (!ks.length) continue;
    if (local <= ks[0].t) { out[key] = ks[0].transform[key]!; continue; }
    const last = ks[ks.length - 1];
    if (local >= last.t) { out[key] = last.transform[key]!; continue; }
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], c = ks[i + 1];
      if (local >= a.t && local <= c.t) {
        const span = c.t - a.t;
        const p = span <= 0 ? 1 : ease(c.easing, (local - a.t) / span);
        out[key] = lerp(a.transform[key]!, c.transform[key]!, p);
        break;
      }
    }
  }
  return out;
}
