import { describe, expect, it } from 'vitest';
import { normalizeCatalog } from './catalogPure';

describe('normalizeCatalog', () => {
  it('lista de objetos com id/kind e rótulos variados', () => {
    expect(normalizeCatalog([{ id: 'glitch', label: 'Glitch', category: 'Retrô' }, { kind: 'fade', name: 'Fade' }, { id: 'x' }, { label: 'sem id' }])).toEqual([
      { id: 'glitch', label: 'Glitch', category: 'Retrô' }, { id: 'fade', label: 'Fade' }, { id: 'x', label: 'x' },
    ]);
  });
  it('mapa id → rótulo ou objeto, sem duplicar', () => {
    expect(normalizeCatalog({ a: 'A', b: { title: 'B', group: 'G' } })).toEqual([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', category: 'G' }]);
    expect(normalizeCatalog([{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }])).toEqual([{ id: 'a', label: 'A' }]);
  });
  it('vazio ou inválido vira null (usa as listas atuais)', () => {
    expect(normalizeCatalog(undefined)).toBeNull();
    expect(normalizeCatalog([])).toBeNull();
    expect(normalizeCatalog(42)).toBeNull();
  });
});
