import { describe, expect, it } from 'vitest';
import { BLACK_MAX_LUMA, isBlackSample, lumaStats, shouldCheck } from './blackCheck';

const px = (...rgb: [number, number, number][]) => rgb.flatMap(([r, g, b]) => [r, g, b, 255]);

describe('detector de quadro preto', () => {
  it('luma Rec.601: branco 255, preto 0, laranja da marca ~125', () => {
    expect(lumaStats(px([255, 255, 255])).avg).toBeCloseTo(255, 0);
    expect(lumaStats(px([0, 0, 0])).max).toBe(0);
    expect(lumaStats(px([0xf2, 0x68, 0x1f])).avg).toBeGreaterThan(110);
    expect(lumaStats(px([0xf2, 0x68, 0x1f])).avg).toBeLessThan(140);
  });
  it('amostra toda preta (ou quase, ruído do encoder) conta como preta', () => {
    expect(isBlackSample(px([0, 0, 0], [3, 2, 4], [8, 8, 8]))).toBe(true);
    expect(isBlackSample(px([16, 16, 16]))).toBe(false); // preto "TV" (16) já fica acima do limite
  });
  it('um único pixel claro basta p/ não ser preto (texto/legenda sobre fundo preto)', () => {
    const data = px(...Array.from({ length: 255 }, () => [0, 0, 0] as [number, number, number]), [200, 200, 200]);
    expect(isBlackSample(data)).toBe(false);
  });
  it('vazio: preto (sem pixel acima do limite)', () => {
    expect(isBlackSample([])).toBe(true);
    expect(BLACK_MAX_LUMA).toBeGreaterThanOrEqual(8);
  });
  it('amostragem: 3 primeiros quadros do clipe e depois 1 a cada 90', () => {
    const hits = Array.from({ length: 400 }, (_, i) => i).filter((i) => shouldCheck(i));
    expect(hits).toEqual([0, 1, 2, 90, 180, 270, 360]);
    expect(shouldCheck(30, 30)).toBe(true);
  });
});
