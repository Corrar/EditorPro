import { describe, expect, it } from 'vitest';
import { unitKindOf, staggerStarts, unitFx, charOffsets, unitDuration } from './textUnits';

describe('animação por palavra/letra', () => {
  it('classifica as animações', () => {
    expect(unitKindOf('word-pop')).toBe('word');
    expect(unitKindOf('char-wave')).toBe('char');
    expect(unitKindOf('fade')).toBeNull();
    expect(unitKindOf(undefined)).toBeNull();
  });
  it('cascata cabe na janela e respeita o passo máximo', () => {
    const s = staggerStarts(5, 'word', 2);
    expect(s).toEqual([0, 0.09, 0.18, 0.27, 0.36].map((x) => expect.closeTo(x, 5)) as never);
    const many = staggerStarts(40, 'char', 1);
    expect(many[39] + unitDuration('char')).toBeLessThanOrEqual(1 + 1e-9);
    expect(staggerStarts(0, 'word', 1)).toEqual([]);
  });
  it('palavra entra na sua vez (cascata) e termina em repouso', () => {
    const t = { duration: 3 };
    expect(unitFx('word-fade', 'word', 2, 4, 0, t).opacity).toBe(0); // ainda não chegou a vez
    expect(unitFx('word-fade', 'word', 0, 4, 0.16, t).opacity).toBeGreaterThan(0.5);
    expect(unitFx('word-fade', 'word', 3, 4, 2, t).opacity).toBeCloseTo(1);
    expect(unitFx('word-slide', 'word', 0, 4, 0, t).dy).toBeGreaterThan(0);
  });
  it('legenda: cada palavra entra no instante em que é falada', () => {
    const timing = { duration: 2, starts: [0, 0.5, 1.2] };
    expect(unitFx('word-pop', 'word', 1, 3, 0.4, timing).opacity).toBe(0);
    expect(unitFx('word-pop', 'word', 1, 3, 0.9, timing).scale).toBeCloseTo(1, 1);
  });
  it('saída em cascata inversa no fim', () => {
    const t = { duration: 3 };
    expect(unitFx('word-fade', 'word', 0, 3, 1, t, 'out').opacity).toBe(1);
    expect(unitFx('word-fade', 'word', 0, 3, 3, t, 'out').opacity).toBeCloseTo(0);
    // a última palavra sai primeiro
    const mid = 3 - 0.3;
    expect(unitFx('word-fade', 'word', 2, 3, mid, t, 'out').opacity).toBeLessThan(unitFx('word-fade', 'word', 0, 3, mid, t, 'out').opacity);
  });
  it('digitando: letra aparece de uma vez; destaque segue a palavra da vez', () => {
    const t = { duration: 2, starts: [0, 0.4, 0.8] };
    expect(unitFx('char-typewriter', 'char', 1, 3, 0.39, t).opacity).toBe(0);
    expect(unitFx('char-typewriter', 'char', 1, 3, 0.41, t).opacity).toBe(1);
    expect(unitFx('word-highlight', 'word', 1, 3, 0.5, t).highlight).toBe(1);
    expect(unitFx('word-highlight', 'word', 0, 3, 0.5, t).highlight).toBe(0);
  });
  it('loop de onda por letra é defasado', () => {
    const a = unitFx('char-wave', 'char', 0, 5, 0.3, { duration: 5 }, 'loop').dy;
    const b = unitFx('char-wave', 'char', 3, 5, 0.3, { duration: 5 }, 'loop').dy;
    expect(a).not.toBeCloseTo(b);
    expect(charOffsets(['oi', 'você'])).toEqual([0, 2]);
  });
});
