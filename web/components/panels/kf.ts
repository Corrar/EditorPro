/* keyframes por propriedade (puro, testado) — o engine interpola cada propriedade
   só entre os keyframes que a definem (lib/engine/easing.interpolateTransform) */
import type { Keyframe, Transform } from '@/lib/types';

export type KfProp = keyof Transform;
/** tolerância para "keyframe neste quadro" (≈ 1 quadro a 30 fps) */
export const KF_EPS = 1 / 60;

export function kfIndexAt(kfs: Keyframe[] | undefined, t: number, eps = KF_EPS): number {
  return (kfs ?? []).findIndex((k) => Math.abs(k.t - t) <= eps);
}

/** a propriedade é animada (tem algum keyframe)? */
export function propAnimated(kfs: Keyframe[] | undefined, prop: KfProp): boolean {
  return (kfs ?? []).some((k) => typeof k.transform[prop] === 'number');
}

/** existe keyframe desta propriedade no tempo t? */
export function propKfAt(kfs: Keyframe[] | undefined, prop: KfProp, t: number, eps = KF_EPS): boolean {
  return (kfs ?? []).some((k) => Math.abs(k.t - t) <= eps && typeof k.transform[prop] === 'number');
}

/** grava (cria ou atualiza) o valor da propriedade num keyframe em t; ordenado por t */
export function setPropKf(kfs: Keyframe[] | undefined, prop: KfProp, t: number, value: number, eps = KF_EPS): Keyframe[] {
  const list = (kfs ?? []).map((k) => ({ ...k, transform: { ...k.transform } }));
  const i = kfIndexAt(list, t, eps);
  if (i >= 0) list[i].transform[prop] = value;
  else list.push({ t: Math.max(0, round3(t)), transform: { [prop]: value }, easing: 'easeInOut' });
  return list.sort((a, b) => a.t - b.t);
}

/** apaga a propriedade do keyframe em t (e o keyframe, se ficar vazio) */
export function removePropKf(kfs: Keyframe[] | undefined, prop: KfProp, t: number, eps = KF_EPS): Keyframe[] {
  return (kfs ?? [])
    .map((k) => {
      if (Math.abs(k.t - t) > eps || typeof k.transform[prop] !== 'number') return k;
      const tf = { ...k.transform };
      delete tf[prop];
      return { ...k, transform: tf };
    })
    .filter((k) => Object.keys(k.transform).length > 0);
}

/** remove todos os keyframes de uma propriedade (reset da propriedade animada) */
export function clearPropKfs(kfs: Keyframe[] | undefined, prop: KfProp): Keyframe[] {
  return (kfs ?? [])
    .map((k) => { const tf = { ...k.transform }; delete tf[prop]; return { ...k, transform: tf }; })
    .filter((k) => Object.keys(k.transform).length > 0);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** texto digitado → valor do slider, respeitando a unidade mostrada (%, °, ×, s) e os limites */
export function typedToValue(text: string, shown: string, min: number, max: number): number | null {
  const n = parseFloat(text.replace(',', '.').replace(/[^\d.+-]/g, ''));
  if (!Number.isFinite(n)) return null;
  const v = shown.trim().endsWith('%') ? n / 100 : n;
  return Math.max(min, Math.min(max, v));
}

/** valor do slider → texto editável na mesma unidade mostrada */
export function valueToTyped(value: number, shown: string): string {
  const v = shown.trim().endsWith('%') ? value * 100 : value;
  return String(Math.round(v * 100) / 100);
}
