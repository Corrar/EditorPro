import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameSurface } from './decodePool';

// OffscreenCanvas falso: conta canvases vivos (com backing store > 0)
class FakeCanvas {
  static live = new Set<FakeCanvas>();
  constructor(public width: number, public height: number) { FakeCanvas.live.add(this); }
  getContext() { return { save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} }; }
}
const alive = () => [...FakeCanvas.live].filter((c) => c.width * c.height > 0).length;

describe('FrameSurface (rotação no export)', () => {
  afterEach(() => { vi.unstubAllGlobals(); FakeCanvas.live.clear(); });
  it('sem rotação devolve o próprio quadro (sem canvas)', () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    const s = new FrameSurface();
    const frame = { displayWidth: 1280, displayHeight: 720 } as unknown as VideoFrame;
    expect(s.source(frame, 0)).toBe(frame);
    expect(s.holding).toBe(false);
  });
  it('rotação cria canvas do tamanho de exibição e release() solta o backing store', () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    const s = new FrameSurface();
    const out = s.source({ displayWidth: 1280, displayHeight: 720 } as unknown as VideoFrame, 90) as unknown as FakeCanvas;
    expect([out.width, out.height]).toEqual([720, 1280]);
    expect(alive()).toBe(1);
    s.release();
    expect(alive()).toBe(0);
    expect(s.holding).toBe(false);
  });
});
