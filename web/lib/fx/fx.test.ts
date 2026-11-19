import { describe, expect, it } from 'vitest';
import {
  EFFECT_CATALOG, TRANSITION_CATALOG, BLEND_CATALOG, MASK_CATALOG, CLIP_ANIMATION_CATALOG,
  FX_EFFECT_LABELS, effectEntry, effectsNativeMode, easeTransitionProgress, isGLEffect, effectFragment,
  fxTransitionFragment, FX_SHADER_TRANSITION_KINDS, PAINT_2D_EFFECTS, isGeometryEffect, addFxGeometry, applyIntroFx, applyLoopFx, blendOp,
} from './index';
import { EFFECT_LABELS, effectGeometry, hasSurfaceEffects } from '../engine/effects';
import { TRANSITION_LABELS, ALL_TRANSITIONS, transitionVisual } from '../engine/transitions';
import { isShaderTransition, SHADER_TRANSITIONS } from '../engine/shaderTransitions';
import { MASK_LABELS, maskAt } from '../engine/masks';
import { CLIP_ANIMATION_LABELS, clipAnimFx, NO_ANIM } from '../engine/animations';
import type { Mask } from '../types';

describe('catálogo fx', () => {
  it('metas de quantidade', () => {
    expect(EFFECT_CATALOG.length).toBeGreaterThanOrEqual(60);
    expect(TRANSITION_CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(BLEND_CATALOG.length).toBe(17);
    expect(MASK_CATALOG.length).toBe(11);
    expect(CLIP_ANIMATION_CATALOG.length).toBeGreaterThanOrEqual(30);
  });
  it('kinds únicos e rótulos não vazios', () => {
    for (const list of [EFFECT_CATALOG, TRANSITION_CATALOG, BLEND_CATALOG, MASK_CATALOG, CLIP_ANIMATION_CATALOG] as unknown as { kind: string; label: string }[][]) {
      expect(new Set(list.map((e) => e.kind)).size).toBe(list.length);
      for (const e of list) expect(e.label.length).toBeGreaterThan(1);
    }
  });
  it('exports antigos continuam compatíveis', () => {
    expect(EFFECT_LABELS.shake).toBe('Tremor');
    expect(TRANSITION_LABELS['sdf-iris']).toBe('Íris');
    expect(ALL_TRANSITIONS).toContain('cube-left');
    expect(MASK_LABELS.radial).toBe('Gradiente radial');
    expect(CLIP_ANIMATION_LABELS.pulse).toBe('Pulsar');
    expect(Object.keys(FX_EFFECT_LABELS).length).toBe(EFFECT_CATALOG.length);
  });
});

describe('implementação', () => {
  it('todo efeito do catálogo tem implementação', () => {
    const legacy = new Set(['glitch', 'rgb-split', 'vhs', 'film-grain', 'light-leak', 'pixelate', 'mirror', 'kaleidoscope', 'blur-motion',
      'flash-strobe', 'old-film', 'vignette-pulse', 'sparkle', 'neon-edge', 'black-bars']);
    for (const e of EFFECT_CATALOG) {
      const ok = legacy.has(e.kind) || isGLEffect(e.kind) || PAINT_2D_EFFECTS.has(e.kind) || isGeometryEffect(e.kind);
      expect(ok, e.kind).toBe(true);
      if (isGLEffect(e.kind)) expect(effectFragment(e.kind)).toContain('void main');
    }
  });
  it('toda transição shader do catálogo tem fragmento; css tem visual', () => {
    for (const t of TRANSITION_CATALOG) {
      if (t.render === 'shader') {
        expect(isShaderTransition(t.kind), t.kind).toBe(true);
      } else expect(isShaderTransition(t.kind), t.kind).toBe(false);
    }
    for (const k of FX_SHADER_TRANSITION_KINDS) expect(fxTransitionFragment(k)).toContain('gl_FragColor');
    expect(SHADER_TRANSITIONS.length).toBeGreaterThanOrEqual(60);
  });
  it('push/cover/slide-blur', () => {
    expect(transitionVisual('push-left', 0.5, 'out').dx).toBeCloseTo(-0.5);
    expect(transitionVisual('push-left', 0.5, 'in').dx).toBeCloseTo(0.5);
    expect(transitionVisual('cover-up', 1, 'in').dy).toBeCloseTo(0);
    expect(transitionVisual('cover-up', 0.5, 'out').dy).toBe(0);
    expect(transitionVisual('slide-blur-left', 0.5, 'in').blur).toBeCloseTo(1);
    expect(transitionVisual('push-left', Number.NaN, 'in').dx).toBe(1);
  });
  it('geometria nova e NaN', () => {
    const g = effectGeometry([{ kind: 'handheld', intensity: 1 }], 1.3);
    expect(g.scale).toBeGreaterThan(1);
    const n = { dx: 0, dy: 0, scale: 1, rotation: 0 };
    addFxGeometry(n, { kind: 'beat-pulse', intensity: 1 }, Number.NaN);
    expect(Number.isFinite(n.scale)).toBe(true);
    expect(hasSurfaceEffects([{ kind: 'zoom-punch', intensity: 1 }])).toBe(false);
    expect(hasSurfaceEffects([{ kind: 'snow', intensity: 1 }])).toBe(true);
  });
  it('blend e modo nativo', () => {
    expect(blendOp('soft-light')).toBe('soft-light');
    expect(blendOp('add')).toBe('lighter');
    expect(blendOp(undefined)).toBe('source-over');
    expect(effectsNativeMode([{ kind: 'snow', intensity: 1 }])).toBe('overlay');
    expect(effectsNativeMode([{ kind: 'zoom-punch', intensity: 1 }])).toBe('css');
    expect(effectsNativeMode([{ kind: 'snow', intensity: 1 }, { kind: 'crt', intensity: 1 }])).toBe('canvas');
    expect(effectEntry('neon-glow')?.params.some((p) => p.key === 'color')).toBe(true);
  });
  it('easing de transição', () => {
    expect(easeTransitionProgress(undefined, 0.3)).toBeCloseTo(0.3);
    expect(easeTransitionProgress('easeIn', 0.5)).toBeCloseTo(0.125);
    expect(easeTransitionProgress('easeOut', Number.NaN)).toBe(0);
  });
});

describe('máscaras e animações', () => {
  const m: Mask = { shape: 'radial', x: 0.5, y: 0.5, w: 0.4, h: 0.4, rotation: 0, feather: 0.5,
    keyframes: [{ t: 0, x: 0.2 }, { t: 2, x: 0.8 }] };
  it('maskAt interpola e segura nas pontas', () => {
    expect(maskAt(m, 1).x).toBeCloseTo(0.5);
    expect(maskAt(m, -1).x).toBeCloseTo(0.2);
    expect(maskAt(m, 9).x).toBeCloseTo(0.8);
    expect(maskAt(m).x).toBe(0.5);
    expect(maskAt(m, 1).w).toBe(0.4);
  });
  it('todas as animações novas respondem e terminam em repouso', () => {
    for (const a of CLIP_ANIMATION_CATALOG) {
      const fx = { ...NO_ANIM };
      applyIntroFx(fx, a.kind, 1, 1);
      if (!['fade', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'spin', 'bounce', 'pop', 'shake', 'swing', 'blur', 'flip'].includes(a.kind)) {
        expect(fx.opacity, a.kind).toBeCloseTo(1);
        expect(fx.scale, a.kind).toBeCloseTo(1, 2);
        expect(fx.dx, a.kind).toBeCloseTo(0, 3);
        expect(applyLoopFx({ ...NO_ANIM }, a.kind, 0.3) || a.slots.every((s) => s !== 'loop'), a.kind).toBe(true);
      }
    }
  });
  it('clipe de duração 0 não gera NaN', () => {
    const fx = clipAnimFx({ animationIn: { kind: 'elastic', duration: 0.5 }, animationOut: { kind: 'drop', duration: 0.5 } }, 0, 0);
    for (const v of Object.values(fx)) expect(Number.isFinite(v)).toBe(true);
  });
});
