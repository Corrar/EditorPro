import { describe, it, expect, vi, beforeAll } from 'vitest';

let calls = 0;
vi.mock('../fx/warm', () => ({
  // 'pending' duas vezes, depois pronto (como a KHR_parallel_shader_compile)
  warmupTransition: () => (++calls < 3 ? 'pending' : 'ready'),
  warmupEffect: () => 'ready',
  warmupCustom: () => 'failed',
}));

import { prewarmTransition, isTransitionWarm, prewarmEffect, prewarmCustom } from './prewarm';

describe('pré-aquecimento em etapas (API warmup* da FX)', () => {
  beforeAll(() => { (globalThis as { document?: unknown }).document ??= {}; });
  it('repete na fatia ociosa enquanto der pending, sem travar; uma fila por chave', async () => {
    expect(prewarmTransition('cube-left' as never)).toBe(false);
    expect(prewarmTransition('cube-left' as never)).toBe(false); // em andamento: não dispara de novo
    expect(calls).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(3);
    expect(isTransitionWarm('cube-left' as never)).toBe(true);
    expect(prewarmTransition('cube-left' as never)).toBe(true);
  });
  it("efeito 'ready' fica pronto na hora; 'failed' não trava a fila", () => {
    expect(prewarmEffect('vhs' as never)).toBe(true);
    expect(prewarmCustom('void main(){}', 'effect')).toBe(true);
  });
});
