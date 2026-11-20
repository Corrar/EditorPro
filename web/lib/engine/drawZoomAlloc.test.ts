import { describe, it, expect, vi } from 'vitest';

/* r3: zoom animado (keyframes de escala) + correção de cor / realces no canvas do preview — o tamanho
   do canvas auxiliar acompanhava a escala contínua: um canvas NOVO (e um redimensionamento do canvas
   GL) a cada quadro. Agora o fator é quantizado em degraus: poucos tamanhos durante o zoom inteiro. */

const asked: Record<number, Set<string>> = {};
vi.mock('./surface', async (orig) => {
  const m = await orig<typeof import('./surface')>();
  const stubCtx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 4, height: 4 } : () => ({})), set: () => true });
  return {
    ...m,
    scratch: (_o: object, w: number, h: number, slot: number) => {
      (asked[slot] ??= new Set()).add(`${Math.round(w)}x${Math.round(h)}`);
      return { c: { width: Math.round(w), height: Math.round(h) }, ctx: stubCtx };
    },
  };
});
const glSizes = new Set<string>();
vi.mock('./gl', () => ({ processPixels: (_s: unknown, _sw: number, _sh: number, w: number, h: number) => { glSizes.add(`${Math.round(w)}x${Math.round(h)}`); return null; } }));
vi.mock('../color', () => ({ gradeLayer: () => null }));

import { drawLayer, stepScale } from './draw';

describe('stepScale', () => {
  it('nunca reduz abaixo do pedido (nitidez), degraus ≤ 9,1%, teto 1', () => {
    for (let k = 0.02; k < 1.2; k += 0.003) {
      const s = stepScale(k);
      expect(s).toBeGreaterThanOrEqual(Math.min(1, k) - 1e-9);
      expect(s).toBeLessThanOrEqual(Math.min(1, k * 1.091));
    }
    expect(stepScale(1)).toBe(1);
    expect(stepScale(0.5)).toBeCloseTo(0.5, 9);
    expect(stepScale(NaN)).toBeGreaterThan(0);
  });
});

describe('r3: zoom animado não aloca canvas por quadro', () => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 720, height: 1280 } : () => ({})), set: () => true }) as unknown as CanvasRenderingContext2D;
  const el = { width: 1080, height: 1920 } as unknown as HTMLCanvasElement; // mediaSize: width/height
  const clip = (extra: object) => ({
    id: 'z', type: 'video', assetId: 'a', start: 0, duration: 4, in: 0, speed: 1, volume: 1, filters: [],
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 4, transform: { scale: 1.35 } }], ...extra,
  });
  const run = (c: object) => {
    for (let i = 0; i < 120; i++) {
      try { drawLayer(ctx, { clip: c } as never, (i / 120) * 4, el, 720, 1280); } catch { /* resto do desenho não importa */ }
    }
  };
  it('correção de cor: poucos tamanhos do canvas reduzido durante um zoom de 4 s', () => {
    run(clip({ colorGrade: { saturation: 0.3, lift: { r: 0.05, g: 0, b: 0, y: 0 } } }));
    expect(asked[3]?.size ?? 0).toBeGreaterThan(0);
    expect(asked[3]!.size).toBeLessThanOrEqual(6); // antes: ~100 tamanhos (1 canvas novo por quadro)
  });
  it('realces/sombras (GL): poucos tamanhos de saída', () => {
    glSizes.clear();
    run(clip({ id: 'z2', filters: [{ kind: 'shadows', value: 0.4 }], keyframes: [{ t: 0, transform: { scale: 0.3 } }, { t: 4, transform: { scale: 0.5 } }] }));
    expect(glSizes.size).toBeGreaterThan(0);
    expect(glSizes.size).toBeLessThanOrEqual(8);
    expect(asked[2]?.size ?? 0).toBeLessThanOrEqual(8);
  });
});
