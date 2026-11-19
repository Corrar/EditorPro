import { describe, it, expect } from 'vitest';
import { charOffsets, graphemes } from './textUnits';
import { chunkCaptions, fitWordsToSegment } from './captions';
import type { CaptionSegment } from '../types';

describe('emoji por grafema (r2 biblioteca #3)', () => {
  it('❤️, 👍🏽, 👨‍👩‍👧 e 🇧🇷 contam como 1 letra cada', () => {
    expect(graphemes('❤️')).toHaveLength(1);
    expect(graphemes('👍🏽')).toHaveLength(1);
    expect(graphemes('👨‍👩‍👧')).toHaveLength(1);
    expect(graphemes('🇧🇷')).toHaveLength(1);
    expect(graphemes('Amei ❤️')).toEqual(['A', 'm', 'e', 'i', ' ', '❤️']);
    expect(graphemes('ação')).toEqual(['a', 'ç', 'ã', 'o']);
    expect(graphemes('')).toEqual([]);
  });
  it('charOffsets usa grafemas (antes: [0, 4, 6] e 8 letras)', () => {
    expect(charOffsets(['Amei', '❤️', '🇧🇷'])).toEqual([0, 4, 5]);
    expect(['Amei', '❤️', '🇧🇷'].reduce((a, w) => a + graphemes(w).length, 0)).toBe(6);
  });
});

describe('legenda encurtada com palavras do Whisper (r2 biblioteca #2)', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => ({ id: 'w' + i, text, start: i * 0.5, end: i * 0.5 + 0.5 }));
  const seg = (start: number, end: number): CaptionSegment => ({ id: 's', start, end, text: 'a b c d e f', words } as CaptionSegment);
  it('fim puxado para 1,5 s: nada aparece depois de 1,5 s (antes ia até 3 s)', () => {
    const ch = chunkCaptions([seg(0, 1.5)], 3);
    expect(ch[ch.length - 1].end).toBeCloseTo(1.5);
    for (const c of ch) for (const w of c.words) expect(w.end).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(ch.map((c) => c.words.map((w) => w.text).join(' '))).toEqual(['a b c', 'd e f']); // texto inteiro continua
  });
  it('início puxado para 2 s: nada aparece antes de 2 s (antes "a b c" aparecia em 0)', () => {
    const ch = chunkCaptions([seg(2, 3)], 3);
    expect(ch[0].start).toBeGreaterThanOrEqual(2);
    expect(ch[ch.length - 1].end).toBe(3);
  });
  it('sem mudança de limites, os tempos das palavras ficam iguais', () => {
    expect(fitWordsToSegment(words, { start: 0, end: 3 })).toBe(words);
    const ch = chunkCaptions([seg(0, 3)], 3);
    expect(ch.map((c) => [c.start, c.end])).toEqual([[0, 1.5], [1.5, 3]]);
  });
});
