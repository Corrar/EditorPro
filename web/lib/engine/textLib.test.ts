import { describe, expect, it } from 'vitest';
import { balanceLines, layoutWords } from './text';
import { clampToSafeZone, isEmphasisWord, SAFE_ZONES } from './captions';

const measure = (s: string) => (s === ' ' ? 10 : s.length * 20);

describe('linhas equilibradas', () => {
  it('evita palavra órfã mantendo o número de linhas', () => {
    const words = 'isso vai mudar a sua vida toda'.split(' ');
    const greedy = layoutWords(words, measure, 400);
    const bal = balanceLines(words, measure, 400);
    expect(bal.length).toBe(greedy.length);
    const widths = (ls: typeof bal) => ls.map((l) => l.width);
    const spread = (ls: typeof bal) => Math.max(...widths(ls)) - Math.min(...widths(ls));
    expect(spread(bal)).toBeLessThanOrEqual(spread(greedy));
    expect(Math.min(...widths(bal))).toBeGreaterThan(Math.min(...widths(greedy)));
  });
  it('uma linha e quebras manuais continuam iguais', () => {
    expect(balanceLines(['oi'], measure, 400).length).toBe(1);
    const br = balanceLines(['a', 'b', 'c'], measure, 400, new Set([2]));
    expect(br.length).toBe(2);
    expect(br[1].words[0].text).toBe('c');
  });
});

describe('zona segura', () => {
  it('empurra a legenda para fora da base do TikTok no vertical', () => {
    const r = clampToSafeZone('tiktok', 0.5, 0.92, 0.84, 0.1, true);
    expect(r.y).toBeLessThanOrEqual(1 - SAFE_ZONES.tiktok.bottom - 0.05 + 1e-9);
    expect(r.maxW).toBeLessThan(0.84);
    expect(r.x + Math.min(0.84, r.maxW) / 2).toBeLessThanOrEqual(1 - SAFE_ZONES.tiktok.right + 1e-9);
  });
  it('sem zona ou no horizontal (exceto YouTube) não mexe', () => {
    expect(clampToSafeZone('none', 0.5, 0.95, 0.8, 0.1, true)).toEqual({ x: 0.5, y: 0.95, maxW: 1 });
    expect(clampToSafeZone('reels', 0.5, 0.95, 0.8, 0.1, false).y).toBe(0.95);
    expect(clampToSafeZone('youtube', 0.5, 0.97, 0.8, 0.1, false).y).toBeLessThan(0.97);
  });
});

describe('ênfase automática', () => {
  it('números, valores e palavras fortes', () => {
    for (const w of ['100', 'R$50', '30%', 'NUNCA', 'grátis!', 'segredo,']) expect(isEmphasisWord(w), w).toBe(true);
    for (const w of ['casa', 'de', 'o', 'falar']) expect(isEmphasisWord(w), w).toBe(false);
  });
});
