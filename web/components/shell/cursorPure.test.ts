import { describe, expect, it } from 'vitest';
import { bubbleOffset } from './cursorPure';

describe('bubbleOffset (balão do cursor da IA)', () => {
  it('prefere à direita do cursor', () => expect(bubbleOffset(100, 400, 200)).toBe(16));
  it('perto da borda direita, puxa para dentro', () => expect(100 + bubbleOffset(300, 400, 200) + 200).toBeLessThanOrEqual(392));
  it('perto da borda esquerda, nunca sai (B2)', () => expect(10 + bubbleOffset(10, 400, 200)).toBeGreaterThanOrEqual(8));
  it('cursor quase na borda esquerda com balão largo', () => {
    const x = 2, dx = bubbleOffset(x, 360, 240);
    expect(x + dx).toBeGreaterThanOrEqual(8);
    expect(x + dx + 240).toBeLessThanOrEqual(352);
  });
});
