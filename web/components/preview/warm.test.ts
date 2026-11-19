import { describe, it, expect } from 'vitest';
import { shaderKindsIn } from './warm';
import { createProject } from '@/lib/defaults';
import type { VideoClip } from '@/lib/types';

const v = (id: string, start: number, tr?: string): VideoClip => ({ id, type: 'video', assetId: 'a', start, duration: 5, in: 0, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...(tr ? { transitionIn: { kind: tr as never, duration: 0.5 } } : {}) });

describe('pré-aquecimento de shaders', () => {
  it('lista só as transições em shader, em ordem, sem repetir, dentro da janela', () => {
    const p = createProject({ name: 't', aspect: '9:16' });
    p.tracks.find((t) => t.kind === 'video')!.clips = [v('a', 0), v('b', 5, 'whip-pan'), v('c', 10, 'fade'), v('d', 15, 'domain-warp'), v('e', 20, 'whip-pan')];
    expect(shaderKindsIn(p)).toEqual(['whip-pan', 'domain-warp']);
    expect(shaderKindsIn(p, 12, 16)).toEqual(['domain-warp']);
    expect(shaderKindsIn(p, 0, 1)).toEqual([]);
  });
});
