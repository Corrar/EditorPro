import { describe, expect, it } from 'vitest';
import { clearPropKfs, propAnimated, propKfAt, removePropKf, setPropKf, typedToValue, valueToTyped } from './kf';

describe('keyframes por propriedade', () => {
  it('cria, atualiza e ordena', () => {
    let k = setPropKf([], 'scale', 1, 1.5);
    k = setPropKf(k, 'scale', 0, 1);
    k = setPropKf(k, 'opacity', 1.005, 0.5); // mesmo quadro do t=1
    expect(k.map((x) => x.t)).toEqual([0, 1]);
    expect(k[1].transform).toEqual({ scale: 1.5, opacity: 0.5 });
    expect(propAnimated(k, 'scale')).toBe(true);
    expect(propAnimated(k, 'x')).toBe(false);
    expect(propKfAt(k, 'opacity', 1)).toBe(true);
    expect(propKfAt(k, 'opacity', 0)).toBe(false);
  });
  it('remove a propriedade e o keyframe vazio', () => {
    const k = setPropKf(setPropKf([], 'x', 0, 0.2), 'y', 0, 0.1);
    const r = removePropKf(k, 'x', 0);
    expect(r).toHaveLength(1);
    expect(r[0].transform).toEqual({ y: 0.1 });
    expect(removePropKf(r, 'y', 0)).toEqual([]);
    expect(clearPropKfs(setPropKf(k, 'x', 2, 0), 'x')).toEqual([{ t: 0, transform: { y: 0.1 }, easing: 'easeInOut' }]);
  });
});

describe('valor digitado', () => {
  it('respeita a unidade mostrada e os limites', () => {
    expect(typedToValue('50', '100%', 0, 1)).toBe(0.5);
    expect(typedToValue('250 %', '100%', 0, 2)).toBe(2);
    expect(typedToValue('-45', '0°', -180, 180)).toBe(-45);
    expect(typedToValue('1,5', '1.00×', 0.1, 10)).toBe(1.5);
    expect(typedToValue('abc', '1', 0, 1)).toBeNull();
    expect(valueToTyped(0.256, '26%')).toBe('25.6');
    expect(valueToTyped(12, '12°')).toBe('12');
  });
});
