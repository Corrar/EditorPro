'use client';
/* catálogos de efeitos/transições/mistura/máscaras/animações: vêm da sessão FX
   (lib/fx: EFFECT_CATALOG, TRANSITION_CATALOG, BLEND_CATALOG, MASK_CATALOG,
   CLIP_ANIMATION_CATALOG) quando ela publicar; até lá, as listas de presets.ts */
import { create } from 'zustand';
import type { BlendMode, ClipAnimation, MaskShape, TransitionKind, VisualEffectKind } from '@/lib/types';
import { normalizeCatalog, type CatItem } from './catalogPure';
import { loadFx } from './optional';
import { BLEND_MODES, CLIP_ANIMATIONS, MASK_SHAPES, TRANSITIONS, VISUAL_EFFECTS } from './presets';

export interface Catalogs {
  effects: { id: VisualEffectKind; label: string; css: string; category?: string }[];
  transitions: { kind: TransitionKind; label: string; category?: string }[];
  blends: { id: BlendMode; label: string }[];
  masks: { id: MaskShape; label: string }[];
  clipAnimations: { id: ClipAnimation; label: string; category?: string }[];
  /** veio da FX? (para diagnóstico) */
  fromFx: boolean;
}

export const useCatalogs = create<Catalogs>(() => ({
  effects: VISUAL_EFFECTS, transitions: TRANSITIONS, blends: BLEND_MODES, masks: MASK_SHAPES, clipAnimations: CLIP_ANIMATIONS, fromFx: false,
}));

const cssOf = (id: string) => VISUAL_EFFECTS.find((e) => e.id === id)?.css ?? 'none';

let started = false;
export function initCatalogs(): void {
  if (started) return;
  started = true;
  void loadFx().then((m) => {
    if (!m) return;
    const pick = (k: string): CatItem[] | null => normalizeCatalog(m[k]);
    const fx = pick('EFFECT_CATALOG');
    const tr = pick('TRANSITION_CATALOG');
    const bl = pick('BLEND_CATALOG');
    const mk = pick('MASK_CATALOG');
    const an = pick('CLIP_ANIMATION_CATALOG');
    useCatalogs.setState((s) => ({
      effects: fx ? fx.map((x) => ({ id: x.id as VisualEffectKind, label: x.label, css: cssOf(x.id), category: x.category })) : s.effects,
      transitions: tr ? tr.map((x) => ({ kind: x.id as TransitionKind, label: x.label, category: x.category })) : s.transitions,
      blends: bl ? bl.map((x) => ({ id: x.id as BlendMode, label: x.label })) : s.blends,
      masks: mk ? mk.map((x) => ({ id: x.id as MaskShape, label: x.label })) : s.masks,
      clipAnimations: an ? an.map((x) => ({ id: x.id as ClipAnimation, label: x.label, category: x.category })) : s.clipAnimations,
      fromFx: !!(fx || tr || bl || mk || an),
    }));
  });
}
