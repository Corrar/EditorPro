import { describe, it, expect } from 'vitest';
import { animateClip } from './animate';
import type { VideoClip } from '../types';

const video = (extra: Partial<VideoClip> = {}): VideoClip => ({
  id: 'v', type: 'video', assetId: 'a', start: 0, duration: 5, in: 0, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra,
});

describe('r3: uParams do shader da IA animáveis (effects.N.params.I)', () => {
  it('interpola um índice de params (array numérico) sem mutar o original', () => {
    const v = video({
      effects: [{ kind: 'custom', intensity: 1, code: 'vec4 effect(vec2 uv){return tex(uv);}', params: [120, 1] }],
      keyframes: [{ t: 0, transform: {}, props: { 'effects.0.params.1': 0 } }, { t: 2, transform: {}, props: { 'effects.0.params.1': 2 } }],
    });
    // (antes: params é array → o caminho era ignorado e o shader recebia sempre o valor fixo)
    expect(animateClip(v, 1).effects![0].params).toEqual([120, 1]);
    expect(animateClip(v, 0.5).effects![0].params).toEqual([120, 0.5]);
    expect(animateClip(v, 2).effects![0].params).toEqual([120, 2]);
    expect(v.effects![0].params).toEqual([120, 1]);
  });
  it('transitionIn.params.N (transição da IA) também anima', () => {
    const v = video({
      transitionIn: { kind: 'custom', duration: 1, code: 'vec4 transition(vec2 uv){return getToColor(uv);}', params: [1] },
      keyframes: [{ t: 0, transform: {}, props: { 'transitionIn.params.0': 0 } }, { t: 1, transform: {}, props: { 'transitionIn.params.0': 1 } }],
    });
    expect(animateClip(v, 0.25).transitionIn!.params).toEqual([0.25]);
  });
  it('cria params (com zeros) quando o efeito ainda não tem, até o índice 7', () => {
    const v = video({
      effects: [{ kind: 'custom', intensity: 1, code: 'x' }],
      keyframes: [{ t: 0, transform: {}, props: { 'effects.0.params.2': 4 } }],
    });
    expect(animateClip(v, 0).effects![0].params).toEqual([0, 0, 4]);
    const bad = video({ effects: [{ kind: 'custom', intensity: 1, code: 'x' }], keyframes: [{ t: 0, transform: {}, props: { 'effects.0.params.9': 4 } }] });
    expect(animateClip(bad, 0).effects![0].params).toBeUndefined();
  });
});
