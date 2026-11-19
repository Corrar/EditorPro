import { describe, it, expect, vi } from 'vitest';

const sizes: number[] = [];
vi.mock('./shapes', async (orig) => {
  const m = await orig<typeof import('./shapes')>();
  return { ...m, shapeCanvas: (c: Parameters<typeof m.shapeCanvas>[0], size: number) => { sizes.push(size); return { width: 10, height: 10 } as unknown as ReturnType<typeof m.shapeCanvas>; } };
});

import { drawLayer } from './draw';
import { clipShapeAspect } from './shapes';

describe('forma rasterizada pela altura desenhada (r2 fx #5)', () => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 1080, height: 1920 } : () => ({})) }) as unknown as CanvasRenderingContext2D;
  const shape = (w: number, h: number, scale = 1) => ({ id: 'sh' + w + h + scale, type: 'shape', shape: 'rect', start: 0, duration: 5, width: w, height: h, fill: '#fff',
    transform: { x: 0, y: 0, scale, rotation: 0, opacity: 1 } });
  const sizeFor = (clip: ReturnType<typeof shape>) => {
    sizes.length = 0;
    try { drawLayer(ctx, { clip, track: { id: 'ov', kind: 'overlay', clips: [] } } as never, 1, undefined, 1080, 1920); } catch { /* resto do desenho não importa */ }
    return sizes[0];
  };
  it('shapeCanvas recebe 1,1× a altura que a forma ocupa (antes: short×escala×1,2, ignorando o aspecto)', () => {
    for (const [w, h, sc] of [[4, 1, 1], [1, 3, 1], [1, 1, 0.5]] as const) {
      const clip = shape(w, h, sc);
      const asp = clipShapeAspect(clip as never);
      const drawnH = (asp >= 1 ? (1080 * 0.95) / asp : 1080 * 0.95) * sc;
      expect(sizeFor(clip)).toBeCloseTo(drawnH * 1.1, 3);
    }
  });
});
