/* regressões da revisão r2 (área cor) */
import { describe, expect, it } from 'vitest';
import { normalizeGrade, isNeutralGrade, gradeCssEquivalent } from './grade';
import { gradePixel, resolveGrade } from './pipeline';
import { wheelWithMaster, wheelWithPuck, wheelResetChroma, puckFromWheel } from './wheel';
import { bakeLut } from './cube';
import { registerLut, deleteImportedLut, lutVersion, getLut } from './luts';
import { resolvedFor } from './index';

const px = (g: Parameters<typeof resolveGrade>[0], v: number[]) => { const o = [0, 0, 0]; gradePixel(resolveGrade(g, getLut), v[0], v[1], v[2], o); return o; };

describe('r2#3 mix/intensidade 0 não apagam a grade', () => {
  it('mix 0 preserva os parâmetros (e continua sem processar)', () => {
    const n = normalizeGrade({ saturation: -0.5, contrast: 0.2, mix: 0 })!;
    expect(n).toEqual({ saturation: -0.5, contrast: 0.2, mix: 0 });
    expect(isNeutralGrade(n)).toBe(true);
    // voltar para 100% no mesmo gesto restaura tudo
    expect(normalizeGrade({ ...n, mix: 1 })).toEqual({ saturation: -0.5, contrast: 0.2 });
  });
  it('LUT com intensidade 0 fica guardada (slider do look não some)', () => {
    expect(normalizeGrade({ lut: { id: 'look:noir', intensity: 0 } })).toEqual({ lut: { id: 'look:noir', intensity: 0 } });
    expect(isNeutralGrade({ lut: { id: 'look:noir', intensity: 0 } })).toBe(true);
  });
  it('grade realmente vazia continua virando undefined', () => {
    expect(normalizeGrade({ mix: 0 })).toBeUndefined();
    expect(normalizeGrade({ saturation: 0 })).toBeUndefined();
  });
});

describe('r2#4 mestre/disco da roda preservam r/g/b', () => {
  const ai = { r: 0.1, g: 0.05, b: -0.05, y: 0 };
  it('mestre muda só y', () => {
    expect(wheelWithMaster(ai, 0.01)).toEqual({ r: 0.1, g: 0.05, b: -0.05, y: 0.01 });
    // e o cinza não escurece/muda de cor: só a luminância sobe um pouco
    const before = px({ gain: ai }, [0.8, 0.8, 0.8]), after = px({ gain: wheelWithMaster(ai, 0.01) }, [0.8, 0.8, 0.8]);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeGreaterThanOrEqual(before[i]);
  });
  it('disco parado no lugar não muda nada; mover aplica só a diferença de croma', () => {
    const p = puckFromWheel(ai);
    const same = wheelWithPuck(ai, p.x, p.y);
    expect(same.r).toBeCloseTo(0.1, 3); expect(same.g).toBeCloseTo(0.05, 3); expect(same.b).toBeCloseTo(-0.05, 3);
    const big = { r: 0, g: 0, b: 0.6, y: 0.2 };
    const pb = puckFromWheel(big);
    const moved = wheelWithPuck(big, pb.x, pb.y);
    expect(moved.b).toBeCloseTo(0.6, 3); // croma além do alcance do disco preservado
    expect(moved.y).toBe(0.2);
    const Y = (w: { r: number; g: number; b: number }) => 0.2126 * w.r + 0.7152 * w.g + 0.0722 * w.b;
    const m2 = wheelWithPuck(ai, p.x + 0.3, p.y - 0.2);
    expect(Y(m2)).toBeCloseTo(Y(ai), 3); // luminância embutida preservada
  });
  it('duplo toque zera só o croma', () => {
    const z = wheelResetChroma({ r: 0.3, g: 0.1, b: -0.2, y: 0.4 });
    expect(z.r).toBeCloseTo(z.g, 4); expect(z.g).toBeCloseTo(z.b, 4); expect(z.y).toBe(0.4);
  });
});

describe('r2#7 CSS nativo só quando bate com o WebGL', () => {
  it('contraste e exposição vão para o canvas', () => {
    expect(gradeCssEquivalent({ contrast: 0.3 })).toBeNull();
    expect(gradeCssEquivalent({ exposure: 0.5 })).toBeNull();
    expect(gradeCssEquivalent({ saturation: 0.2, contrast: 0.1 })).toBeNull();
  });
  it('saturação (com mix) em CSS bate com o motor', () => {
    const css = gradeCssEquivalent({ saturation: -0.4, mix: 0.5 })!;
    const s = Number(/saturate\(([\d.]+)\)/.exec(css)![1]);
    // matriz saturate do Filter Effects (luma Rec.709)
    const L = [0.2126, 0.7152, 0.0722], c = [0.8, 0.3, 0.1];
    const l = L[0] * c[0] + L[1] * c[1] + L[2] * c[2];
    const viaCss = c.map((v) => l + (v - l) * s);
    const viaGl = px({ saturation: -0.4, mix: 0.5 }, c);
    for (let i = 0; i < 3; i++) expect(Math.abs(viaCss[i] - viaGl[i]) * 255).toBeLessThan(1.2);
    expect(gradeCssEquivalent({})).toBe('none');
  });
});

describe('r2#8 LUT excluída sai do cache da grade resolvida', () => {
  it('resolvedFor reavalia quando o registro muda', async () => {
    const lut = bakeLut('cube:teste-r2', 'Teste', 3, (r, g, b, o) => { o[0] = 1 - r; o[1] = 1 - g; o[2] = 1 - b; });
    const v0 = lutVersion();
    registerLut(lut);
    expect(lutVersion()).toBeGreaterThan(v0);
    const g = { lut: { id: 'cube:teste-r2', intensity: 1 } };
    expect(resolvedFor(g).lut).toBe(lut);
    await deleteImportedLut('cube:teste-r2');
    expect(resolvedFor(g).lut).toBeNull(); // mesmo objeto de grade: não pode ficar com a LUT antiga
    expect(resolvedFor({ ...g }).lut).toBeNull(); // cache por valor também
  });
});
