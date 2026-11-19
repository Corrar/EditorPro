/* política p/ o preview híbrido (components/preview/hybrid.ts, do engine) e easing de transição */
import type { Easing, VisualEffect, VisualEffectKind } from '../types';
import { ease } from '../engine/easing';
import { effectEntry, type FxNative } from './catalog';

/** 'css' = dá p/ manter o <video> nativo com CSS; 'overlay' = nativo + desenhar só por cima; 'canvas' = compor no canvas */
export function effectNativeMode(kind: VisualEffectKind): FxNative {
  return effectEntry(kind)?.native ?? 'canvas';
}

/** pior caso de uma lista de efeitos (ignora intensidade 0) */
export function effectsNativeMode(effects: VisualEffect[] | undefined): FxNative {
  let mode: FxNative = 'css';
  for (const e of effects ?? []) {
    if (!(e.intensity > 0)) continue;
    const m = effectNativeMode(e.kind);
    if (m === 'canvas') return 'canvas';
    if (m === 'overlay') mode = 'overlay';
  }
  return mode;
}

/** progresso da transição com o easing opcional de Transition.easing (ausente = linear, curva própria da transição) */
export function easeTransitionProgress(easing: Easing | undefined, p: number): number {
  const x = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  return easing ? ease(easing, x) : x;
}
