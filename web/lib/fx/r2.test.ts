/* regressão da revisão r2 (docs/revisao/2026-11-19-r2/fx.md) */
import { describe, expect, it } from 'vitest';
import { EFFECT_CATALOG } from './catalog';
import { effectFragment, EFFECT_SHADER_KINDS } from './effectShaders';
import { fxTransitionFragment, FX_SHADER_TRANSITION_KINDS } from './transitionShaders';
import { SHADER_TRANSITIONS, shaderTransitionFragment } from '../engine/shaderTransitions';
import { quantizeShapeSize } from '../engine/shapes';
import { canvasFilterSupported } from './sprites';
import { effectsNativeMode } from './native';

describe('r2 fx', () => {
  it('#2 nativo "css" só p/ efeito de geometria (o híbrido só traduz geometria p/ o <video>)', () => {
    for (const e of EFFECT_CATALOG) if (e.native === 'css') expect(e.render, e.kind).toBe('geometry');
    for (const k of ['invert', 'blur-gauss', 'rainbow'] as const) expect(effectsNativeMode([{ kind: k, intensity: 1 }])).toBe('canvas');
  });
  it('#3 nenhum pow() com base que pode ser negativa (NaN na GPU)', () => {
    const srcs = [
      ...EFFECT_SHADER_KINDS.map((k) => [k, effectFragment(k)!] as const),
      ...FX_SHADER_TRANSITION_KINDS.map((k) => [k, fxTransitionFragment(k)!] as const),
    ];
    // bases permitidas: comprovadamente ≥ 0
    const safe = [/pow\(max\(/, /pow\(bell\(/, /pow\(1\.-r\/R,/, /pow\(p\*2\.,/, /pow\(\(1\.-p\)\*2\.,/, /pow\(lum\(/];
    for (const [k, src] of srcs) {
      const calls = src.match(/pow\([^;]*?,/g) ?? [];
      for (const c of calls) expect(safe.some((r) => r.test(c)), `${k}: ${c}`).toBe(true);
    }
    expect(fxTransitionFragment('luma-heart')).toContain('float b=x2+y*y-1.;float f=b*b*b');
  });
  it('#8 todas as transições em shader pedem highp quando existe', () => {
    for (const k of SHADER_TRANSITIONS) {
      if (k === 'custom') continue;
      const src = shaderTransitionFragment(k)!;
      expect(src, k).toContain('GL_FRAGMENT_PRECISION_HIGH');
      expect(src.startsWith('precision mediump'), k).toBe(false);
    }
  });
  it('#9 tamanho dos blocos/contornos proporcional à resolução (sem piso em 1)', () => {
    for (const k of EFFECT_SHADER_KINDS) expect(effectFragment(k)!, k).not.toMatch(/max\(1\.,u_res/);
    expect(fxTransitionFragment('mosaic')!).not.toMatch(/max\(1\.,u_res/);
  });
  it('#5 tamanho de forma quantizado em degraus de ~19%', () => {
    const sizes = new Set<number>();
    for (let s = 600; s <= 1200; s += 3) sizes.add(quantizeShapeSize(s));
    expect(sizes.size).toBeLessThanOrEqual(5); // escala 1→2 em 200 quadros: ≤ 5 canvases
    expect(quantizeShapeSize(700)).toBeGreaterThanOrEqual(700);
    expect(quantizeShapeSize(99999)).toBe(2048);
    expect(quantizeShapeSize(Number.NaN)).toBe(4);
  });
  it('#6 sem canvas (vitest) a detecção de ctx.filter dá falso, sem exceção', () => {
    expect(canvasFilterSupported()).toBe(false);
  });
});
