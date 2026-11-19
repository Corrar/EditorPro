import { describe, it, expect } from 'vitest';
import { customShadersIn, projectWarmList } from './prewarm';
import { createProject } from '../defaults';
import type { VideoClip } from '../types';

const v = (id: string, start: number, extra: Partial<VideoClip> = {}): VideoClip => ({ id, type: 'video', assetId: 'a', start, duration: 5, in: 0, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra });

describe('pré-aquecimento', () => {
  const p = createProject({ name: 't', aspect: '9:16' });
  p.tracks.find((t) => t.kind === 'video')!.clips = [
    v('a', 0, { effects: [{ kind: 'custom', intensity: 1, code: 'vec4 effect(vec2 uv){return texture2D(uTex,uv);}' } as never] }),
    v('b', 5, { transitionIn: { kind: 'custom', duration: 0.5, code: 'vec4 transition(vec2 uv){return mix(getFromColor(uv),getToColor(uv),progress);}' } as never }),
    v('c', 10, { transitionIn: { kind: 'whip-pan', duration: 0.5 }, effects: [{ kind: 'vhs', intensity: 0.5 }] as never }),
  ];
  it('acha os shaders custom por janela de tempo', () => {
    expect(customShadersIn(p).map((x) => x.stage)).toEqual(['effect', 'transition']);
    expect(customShadersIn(p, 6, 7).map((x) => x.stage)).toEqual(['transition']);
    expect(customShadersIn(p, 11, 12)).toEqual([]);
  });
  it('lista do projeto: transições em shader e efeitos', () => {
    const w = projectWarmList(p);
    expect(w.transitions).toContain('whip-pan');
    expect(w.effects).toEqual(expect.arrayContaining(['vhs', 'custom']));
  });
});
