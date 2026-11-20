import { describe, it, expect, vi } from 'vitest';

/* r3: texto com estilo animado por keyframes (style.color / style.fontSize…) e sem animação de bloco
   caía no cache de bitmap do texto parado: a chave muda a cada quadro → um canvas do QUADRO INTEIRO
   novo por quadro (720×1280 ≈ 3,7 MB), 10 vivos no cache — no iOS estoura o teto de memória de canvas. */

let made = 0;
vi.mock('./surface', async (orig) => {
  const m = await orig<typeof import('./surface')>();
  const stub = () => new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 4, height: 4 } : k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop: () => {} })), set: () => true });
  return { ...m, makeCanvas: (w: number, h: number) => { made++; return { width: w, height: h, getContext: () => stub() }; } };
});
vi.mock('./fonts', async (orig) => {
  const m = await orig<typeof import('./fonts')>();
  return { ...m, requestFont: () => true, fontLoaded: () => true, fontEpoch: () => 1 };
});

import { drawTextClip } from './textDraw';
import type { TextClip } from '../types';

const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 720, height: 1280 } : k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop: () => {} })), set: () => true }) as unknown as CanvasRenderingContext2D;
const text = (keyframes?: TextClip['keyframes']): TextClip => ({
  id: 't' + Math.random(), type: 'text', text: 'Oi', start: 0, duration: 4, position: { x: 0.5, y: 0.5 }, animation: 'none',
  style: { fontFamily: 'Anton', fontSize: 80, fontWeight: 700, color: '#ffffff', strokeColor: '#000', strokeWidth: 4, background: '', shadow: false, uppercase: false, align: 'center' },
  keyframes,
} as TextClip);

describe('r3: texto com estilo animado não aloca um bitmap por quadro', () => {
  it('controle: texto parado usa 1 bitmap', () => {
    made = 0;
    const c = text();
    for (let i = 0; i < 30; i++) { try { drawTextClip(ctx, c, i / 10, 720, 1280); } catch { /* stub */ } }
    expect(made).toBe(1);
  });
  it('cor animada de 0 a 3 s: desenha direto (antes: 30 bitmaps do quadro inteiro)', () => {
    made = 0;
    const c = text([{ t: 0, transform: {}, props: { 'style.color': '#ffffff' } }, { t: 3, transform: {}, props: { 'style.color': '#ff0000' } }]);
    for (let i = 0; i < 30; i++) { try { drawTextClip(ctx, c, i / 10, 720, 1280); } catch { /* stub */ } }
    expect(made).toBeLessThanOrEqual(1);
  });
});
