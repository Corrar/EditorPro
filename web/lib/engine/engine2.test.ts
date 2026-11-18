import { describe, expect, it } from 'vitest';
import type { VideoClip } from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { curveIntegral, curveSpeedAt, mapSourceTime, sourceSpan, rateAt, SPEED_PRESETS, curveOf } from './speed';
import { clipAnimFx } from './animations';
import { transitionVisual, ALL_TRANSITIONS, TRANSITION_LABELS } from './transitions';
import { resolveFilters, needsPixelGrade } from './filters';
import { textAnimState } from './text';
import { effectGeometry, hasSurfaceEffects } from './effects';
import { chromaThresholds } from './gl';

const v = (extra: Partial<VideoClip> = {}): VideoClip => ({
  id: 'c', type: 'video', assetId: 'a', start: 10, duration: 4, in: 2, speed: 1, volume: 1,
  transform: { ...DEFAULT_TRANSFORM }, filters: [], ...extra,
});

describe('velocidade', () => {
  it('constante', () => {
    const c = v({ speed: 2 });
    expect(mapSourceTime(c, 11)).toBe(4);
    expect(sourceSpan(c)).toBe(8);
  });
  it('integral exata de curva linear', () => {
    const curve = [{ t: 0, speed: 1 }, { t: 1, speed: 3 }];
    expect(curveIntegral(curve, 1)).toBeCloseTo(2);
    expect(curveIntegral(curve, 0.5)).toBeCloseTo(0.5 * (1 + 2) / 2);
    expect(curveIntegral(curve, 1.5)).toBeCloseTo(2 + 0.5 * 3); // extrapola com a ponta
    expect(curveSpeedAt(curve, 0.25)).toBeCloseTo(1.5);
  });
  it('curva no clipe: tempo de fonte monotônico e rate instantânea', () => {
    const c = v({ speedCurve: [{ t: 0, speed: 1 }, { t: 0.5, speed: 2 }, { t: 1, speed: 1 }] });
    // ∫ = 0.5*(1+2)/2 + 0.5*(2+1)/2 = 1.5 (normalizado) → 6 s de fonte em 4 s
    expect(sourceSpan(c)).toBeCloseTo(6);
    expect(mapSourceTime(c, 12)).toBeCloseTo(2 + 4 * 0.75);
    expect(rateAt(c, 2)).toBeCloseTo(2);
    let prev = -1;
    for (let t = 10; t <= 14; t += 0.1) { const s = mapSourceTime(c, t); expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });
  it('preset vira curva; speedCurve tem prioridade', () => {
    expect(curveOf(v({ speedPreset: 'bullet' }))).toEqual(SPEED_PRESETS.bullet);
    expect(curveOf(v({ speedPreset: 'bullet', speedCurve: [{ t: 0, speed: 2 }, { t: 1, speed: 2 }] }))?.[0].speed).toBe(2);
    expect(curveOf({ ...v(), type: 'image' } as never)).toBeNull();
  });
  it('reverso: começa no fim do trecho e volta até o in', () => {
    const c = v({ reverse: true });
    expect(mapSourceTime(c, 10)).toBeCloseTo(6);
    expect(mapSourceTime(c, 12)).toBeCloseTo(4);
    expect(mapSourceTime(c, 14)).toBeCloseTo(2);
    expect(mapSourceTime(c, 20)).toBeCloseTo(2); // não passa do in
  });
});

describe('animações de clipe', () => {
  it('entrada parte do estado inicial e chega no repouso', () => {
    const c = { animationIn: { kind: 'slide-left' as const, duration: 0.5 } };
    expect(clipAnimFx(c, 0, 3).dx).toBeCloseTo(1);
    expect(clipAnimFx(c, 0.5, 3).dx).toBeCloseTo(0);
    expect(clipAnimFx({ animationIn: { kind: 'fade', duration: 1 } }, 0, 3).opacity).toBe(0);
  });
  it('saída espelhada no fim', () => {
    const c = { animationOut: { kind: 'slide-left' as const, duration: 0.5 } };
    expect(clipAnimFx(c, 1, 3).dx).toBe(0);
    expect(clipAnimFx(c, 3, 3).dx).toBeCloseTo(-1);
    expect(clipAnimFx({ animationOut: { kind: 'fade', duration: 1 } }, 3, 3).opacity).toBeCloseTo(0);
  });
  it('loop é periódico', () => {
    const c = { animationLoop: { kind: 'spin' as const, duration: 2 } };
    expect(clipAnimFx(c, 1, 10).rotation).toBeCloseTo(180);
    expect(clipAnimFx({ animationLoop: { kind: 'zoom-in', duration: 1 } }, 0, 10).scale).toBeCloseTo(1);
  });
});

describe('transições novas', () => {
  it('tem ≥ 24 transições e todas rotuladas', () => {
    expect(ALL_TRANSITIONS.length).toBeGreaterThanOrEqual(24);
    for (const k of ALL_TRANSITIONS) {
      expect(TRANSITION_LABELS[k]).toBeTruthy();
      for (const p of [0, 0.5, 1]) for (const r of ['in', 'out'] as const) {
        const tv = transitionVisual(k, p, r);
        expect(Number.isFinite(tv.opacity)).toBe(true);
      }
    }
  });
  it('wipe/círculo revelam o clipe que entra', () => {
    expect(transitionVisual('wipe-left', 0.5, 'in').reveal?.progress).toBeCloseTo(0.5);
    expect(transitionVisual('circle-open', 1, 'in').reveal).toMatchObject({ kind: 'circle', progress: 1 });
    expect(transitionVisual('wipe-left', 0.5, 'out').reveal).toBeUndefined();
  });
  it('dip pinta a cor no meio', () => {
    expect(transitionVisual('dip-white', 0.5, 'in').dip).toEqual({ color: '#ffffff', alpha: 1 });
    expect(transitionVisual('slide-down', 0, 'in').dy).toBeCloseTo(-1);
  });
});

describe('filtros novos', () => {
  it('exposição/tom no CSS; realces/sombras/nitidez pedem processamento por pixel', () => {
    const r = resolveFilters([{ kind: 'exposure', value: 0.5 }, { kind: 'hue', value: 0.5 }, { kind: 'fade', value: 0.4 }]);
    expect(r.css).toMatch(/brightness\(1\.68\d*\)/);
    expect(r.css).toContain('hue-rotate(90deg)');
    expect(r.fade).toBeCloseTo(0.4);
    expect(needsPixelGrade(r)).toBe(false);
    expect(needsPixelGrade(resolveFilters([{ kind: 'shadows', value: 0.3 }]))).toBe(true);
  });
  it('limiares do chroma crescem com a similaridade', () => {
    const a = chromaThresholds({ color: '#00ff00', similarity: 0.2, smoothness: 0.1 });
    const b = chromaThresholds({ color: '#00ff00', similarity: 0.8, smoothness: 0.1 });
    expect(b.th).toBeGreaterThan(a.th);
  });
});

describe('texto e efeitos', () => {
  it('saída e loop de texto', () => {
    expect(textAnimState('fade', 1.99, 2, 5, 'slide-left').dx).toBeLessThan(0);
    expect(textAnimState('none', 1, 4, 5, undefined, 'wave').wave).toBeGreaterThan(0);
    expect(textAnimState('spin', 0, 2, 5).rotation).toBeLessThan(0);
    expect(textAnimState('zoom', 0, 2, 5).scale).toBeGreaterThan(1.5);
  });
  it('geometria de tremor e pulso', () => {
    const g = effectGeometry([{ kind: 'zoom-pulse', intensity: 1 }], 0);
    expect(g.scale).toBeGreaterThan(1.1);
    expect(hasSurfaceEffects([{ kind: 'shake', intensity: 1 }])).toBe(false);
    expect(hasSurfaceEffects([{ kind: 'vhs', intensity: 0.5 }])).toBe(true);
  });
});

import { SHADER_TRANSITIONS, isShaderTransition } from './shaderTransitions';
describe('transições em shader (HyperFrames)', () => {
  it('14 shaders, todos reconhecidos e com fallback de dissolver', () => {
    expect(SHADER_TRANSITIONS).toHaveLength(14);
    expect(isShaderTransition('sdf-iris')).toBe(true);
    expect(isShaderTransition('glitch')).toBe(false);
    expect(transitionVisual('ridged-burn', 0.5, 'in').opacity).toBeCloseTo(0.5);
    expect(ALL_TRANSITIONS.length).toBeGreaterThanOrEqual(38);
  });
});
