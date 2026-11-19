import { describe, expect, it } from 'vitest';
import type { ColorGrade } from '../types';
import {
  isNeutralGrade, normalizeGrade, combineGrades, gradeToCssFilter, gradeCssEquivalent, cleanCurve, gradesEqual,
} from './grade';
import { monotoneSpline, curveTable, sampleTable, curvesTextureData, gradeCurveTables } from './curves';
import { parseCube, writeCube, sampleLut, bakeLut, lutAtlasLayout, lutAtlasData, CubeParseError } from './cube';
import { resolveGrade, gradePixel, applyGradeImageData, bandWeights, rgbToHsv, hsvToRgb, srgbToLinear, linearToSrgb } from './pipeline';
import { BUILTIN_LOOKS, getLut, bakeLook, cubeId } from './luts';
import { wheelFromPuck, puckFromWheel } from './wheel';
import { computeScopes } from './scopes';

const px = (g: ColorGrade | undefined, r: number, gg: number, b: number) => {
  const o = [0, 0, 0];
  gradePixel(resolveGrade(g, getLut), r, gg, b, o);
  return o;
};

describe('isNeutralGrade / normalizeGrade', () => {
  it('vazio, undefined e zeros são neutros', () => {
    expect(isNeutralGrade(undefined)).toBe(true);
    expect(isNeutralGrade({})).toBe(true);
    expect(isNeutralGrade({ exposure: 0, lift: { r: 0, g: 0, b: 0, y: 0 }, pivot: 0.6, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe(true);
    expect(isNeutralGrade({ exposure: 0.3, mix: 0 })).toBe(true);
    expect(isNeutralGrade({ lut: { id: 'look:noir', intensity: 0 } })).toBe(true);
  });
  it('qualquer ajuste real não é neutro', () => {
    expect(isNeutralGrade({ exposure: 0.01 })).toBe(false);
    expect(isNeutralGrade({ gain: { r: 0, g: 0, b: 0, y: 0.2 } })).toBe(false);
    expect(isNeutralGrade({ hsl: { red: { hue: 0.2, sat: 0, lum: 0 } } })).toBe(false);
    expect(isNeutralGrade({ curves: { r: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] } })).toBe(false);
    expect(isNeutralGrade({ lut: { id: 'look:noir', intensity: 0.5 } })).toBe(false);
  });
  it('saneia NaN/limites e remove o neutro', () => {
    const n = normalizeGrade({ exposure: NaN, contrast: 5, saturation: 0, lift: { r: NaN, g: 0, b: 0, y: 0 }, mix: 2 } as ColorGrade);
    expect(n).toEqual({ contrast: 1 });
    expect(normalizeGrade({ exposure: Infinity } as ColorGrade)).toBeUndefined();
  });
  it('curva saneada: ordena, junta x duplicado e garante as pontas', () => {
    const c = cleanCurve([{ x: 0.7, y: 0.8 }, { x: 0.3, y: 0.2 }, { x: 0.3001, y: 0.25 }])!;
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[c.length - 1]).toEqual({ x: 1, y: 1 });
    expect(c.map((p) => p.x)).toEqual([0, 0.3001, 0.7, 1]);
  });
  it('gradesEqual ignora diferenças neutras', () => {
    expect(gradesEqual({ exposure: 0.2 }, { exposure: 0.2, saturation: 0 })).toBe(true);
    expect(gradesEqual({ exposure: 0.2 }, { exposure: 0.3 })).toBe(false);
  });
});

describe('combinação de presets', () => {
  it('soma escalares e rodas, top substitui LUT/curvas', () => {
    const base: ColorGrade = { exposure: 0.2, gain: { r: 0.1, g: 0, b: 0, y: 0 }, lut: { id: 'look:noir', intensity: 1 } };
    const top: ColorGrade = { exposure: 0.1, gain: { r: 0, g: 0, b: 0.1, y: 0.05 }, lut: { id: 'look:vintage', intensity: 0.5 } };
    const c = combineGrades(base, top)!;
    expect(c.exposure).toBeCloseTo(0.3);
    expect(c.gain).toEqual({ r: 0.1, g: 0, b: 0.1, y: 0.05 });
    expect(c.lut).toEqual({ id: 'look:vintage', intensity: 0.5 });
  });
  it('limita a soma e mantém o HSL de ambos', () => {
    const c = combineGrades({ saturation: 0.8, hsl: { red: { hue: 0.2, sat: 0, lum: 0 } } }, { saturation: 0.8, hsl: { blue: { hue: 0, sat: 0.3, lum: 0 } } })!;
    expect(c.saturation).toBe(1);
    expect(c.hsl?.red?.hue).toBeCloseTo(0.2);
    expect(c.hsl?.blue?.sat).toBeCloseTo(0.3);
  });
  it('com um lado vazio devolve o outro normalizado', () => {
    expect(combineGrades(undefined, { tint: 0.1 })).toEqual({ tint: 0.1 });
    expect(combineGrades({ tint: 0 }, undefined)).toBeUndefined();
  });
});

describe('CSS', () => {
  it('neutro = none; ajustes viram filtros', () => {
    expect(gradeToCssFilter({})).toBe('none');
    const css = gradeToCssFilter({ exposure: 0.5, contrast: 0.2, saturation: -0.5 });
    expect(css).toMatch(/brightness\(/);
    expect(css).toMatch(/contrast\(1\.2\)/);
    expect(css).toMatch(/saturate\(0\.5\)/);
  });
  it('equivalente exato só p/ exposição/contraste/saturação', () => {
    expect(gradeCssEquivalent({ saturation: 0.3 })).toMatch(/saturate/);
    expect(gradeCssEquivalent({ saturation: 0.3, temperature: 0.2 })).toBeNull();
    expect(gradeCssEquivalent({ curves: { master: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] } })).toBeNull();
  });
});

describe('curvas (spline monotônica)', () => {
  it('identidade', () => {
    const t = curveTable(undefined);
    for (let i = 0; i < 256; i += 17) expect(t[i]).toBeCloseTo(i / 255, 6);
  });
  it('passa pelos pontos', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.25, y: 0.1 }, { x: 0.6, y: 0.75 }, { x: 1, y: 1 }];
    const f = monotoneSpline(pts);
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 6);
  });
  it('pontos crescentes ⇒ curva monotônica crescente (mesmo com degrau abrupto)', () => {
    const f = monotoneSpline([{ x: 0, y: 0 }, { x: 0.4, y: 0.05 }, { x: 0.45, y: 0.9 }, { x: 0.5, y: 0.95 }, { x: 1, y: 1 }]);
    let prev = -1;
    for (let i = 0; i <= 1000; i++) { const y = f(i / 1000); expect(y).toBeGreaterThanOrEqual(prev - 1e-9); prev = y; }
  });
  it('sem overshoot: cada segmento fica entre os valores das pontas', () => {
    const pts = [{ x: 0, y: 0.2 }, { x: 0.3, y: 0.8 }, { x: 0.5, y: 0.3 }, { x: 0.8, y: 0.9 }, { x: 1, y: 0.5 }];
    const f = monotoneSpline(pts);
    for (let s = 0; s < pts.length - 1; s++) {
      const lo = Math.min(pts[s].y, pts[s + 1].y), hi = Math.max(pts[s].y, pts[s + 1].y);
      for (let k = 0; k <= 50; k++) {
        const x = pts[s].x + (pts[s + 1].x - pts[s].x) * (k / 50);
        const y = f(x);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
  it('sampleTable interpola e a textura tem 256×4 bytes', () => {
    const t = curveTable([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
    expect(sampleTable(t, 0.5)).toBeCloseTo(0.5, 2);
    const tex = curvesTextureData(gradeCurveTables({ curves: { r: [{ x: 0, y: 0.5 }, { x: 1, y: 1 }] } }));
    expect(tex.length).toBe(1024);
    expect(tex[0]).toBe(128); // R(0) = 0,5
    expect(tex[3]).toBe(0); // mestre(0) = 0
  });
});

const CUBE = `# comentário
TITLE "Teste"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0   # vermelho
0 1 0
1 1 0

0 0 1
1 0 1
0 1 1
1 1 1
`;

describe('parser .cube', () => {
  it('lê tamanho, título, domínio e ignora comentários', () => {
    const l = parseCube(CUBE, 'x');
    expect(l.size).toBe(2);
    expect(l.name).toBe('Teste');
    expect(l.data.length).toBe(24);
    expect(Array.from(l.data.slice(3, 6))).toEqual([1, 0, 0]);
  });
  it('identidade trilinear', () => {
    const l = parseCube(CUBE, 'x');
    const o = [0, 0, 0];
    sampleLut(l, 0.3, 0.6, 0.9, o);
    expect(o[0]).toBeCloseTo(0.3); expect(o[1]).toBeCloseTo(0.6); expect(o[2]).toBeCloseTo(0.9);
  });
  it('respeita DOMAIN_MIN/MAX', () => {
    const l = parseCube(CUBE.replace('DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 2 2 2'), 'x');
    const o = [0, 0, 0];
    sampleLut(l, 1, 1, 1, o);
    expect(o[0]).toBeCloseTo(0.5);
  });
  it('LUT 1D vira 3D', () => {
    const l = parseCube('LUT_1D_SIZE 2\n0 0 0\n0.5 1 1\n', 'y');
    expect(l.size).toBe(33);
    const o = [0, 0, 0];
    sampleLut(l, 1, 1, 1, o);
    expect(o[0]).toBeCloseTo(0.5);
  });
  it('erros claros', () => {
    expect(() => parseCube('0 0 0\n', 'z')).toThrow(CubeParseError);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n', 'z')).toThrow(/incompletos/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 a 0\n', 'z')).toThrow(/inválido/);
    expect(() => parseCube('LUT_3D_SIZE 999\n', 'z')).toThrow(/LUT_3D_SIZE/);
  });
  it('writeCube → parseCube preserva os dados', () => {
    const l = bakeLut('b', 'Ida e volta', 5, (r, g, b, o) => { o[0] = g; o[1] = b; o[2] = r; });
    const back = parseCube(writeCube(l), 'b');
    expect(back.size).toBe(5);
    expect(back.name).toBe('Ida e volta');
    for (let i = 0; i < l.data.length; i++) expect(back.data[i]).toBeCloseTo(l.data[i], 5);
  });
  it('atlas cabe em textura e guarda as fatias', () => {
    expect(lutAtlasLayout(33)).toEqual({ cols: 6, rows: 6, width: 198, height: 198 });
    expect(lutAtlasLayout(65).width).toBeLessThanOrEqual(4096);
    const a = lutAtlasData(parseCube(CUBE, 'x'));
    expect(a.width).toBe(4); expect(a.height).toBe(2);
    // fatia b=1 (tile 1) no texel (2,0) = (0,0,1)
    expect(Array.from(a.data.slice(2 * 4, 2 * 4 + 4))).toEqual([0, 0, 255, 255]);
  });
  it('cubeId é estável', () => {
    expect(cubeId(CUBE)).toBe(cubeId(CUBE));
    expect(cubeId(CUBE)).not.toBe(cubeId(CUBE + ' '));
  });
});

describe('pipeline CPU', () => {
  it('grade neutra = identidade', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]]) {
      const o = px({}, c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) expect(o[i]).toBeCloseTo(c[i], 5);
    }
  });
  it('sRGB ida e volta', () => {
    for (let i = 0; i <= 10; i++) expect(linearToSrgb(srgbToLinear(i / 10))).toBeCloseTo(i / 10, 6);
  });
  it('exposição +1 (2 stops) clareia; −1 escurece', () => {
    expect(px({ exposure: 0.5 }, 0.3, 0.3, 0.3)[0]).toBeGreaterThan(0.38);
    expect(px({ exposure: -0.5 }, 0.3, 0.3, 0.3)[0]).toBeLessThan(0.23);
  });
  it('temperatura quente aumenta R e reduz B', () => {
    const o = px({ temperature: 0.6 }, 0.5, 0.5, 0.5);
    expect(o[0]).toBeGreaterThan(0.5); expect(o[2]).toBeLessThan(0.5);
  });
  it('lift mexe nas sombras mais que nas altas luzes; gain o contrário', () => {
    const lift = { lift: { r: 0, g: 0, b: 0, y: 0.4 } };
    expect(px(lift, 0.05, 0.05, 0.05)[0] - 0.05).toBeGreaterThan(px(lift, 0.9, 0.9, 0.9)[0] - 0.9);
    const gain = { gain: { r: 0, g: 0, b: 0, y: 0.3 } };
    expect(px(gain, 0.8, 0.8, 0.8)[0] - 0.8).toBeGreaterThan(px(gain, 0.1, 0.1, 0.1)[0] - 0.1);
  });
  it('gamma positivo clareia os médios e preserva preto e branco', () => {
    const g = { gamma: { r: 0, g: 0, b: 0, y: 0.5 } };
    expect(px(g, 0.4, 0.4, 0.4)[0]).toBeGreaterThan(0.45);
    expect(px(g, 0, 0, 0)[0]).toBeCloseTo(0, 6);
    expect(px(g, 1, 1, 1)[0]).toBeCloseTo(1, 6);
  });
  it('contraste gira em torno do pivô', () => {
    const o = px({ contrast: 0.5, pivot: 0.4 }, 0.4, 0.4, 0.4);
    expect(o[0]).toBeCloseTo(0.4, 5);
    expect(px({ contrast: 0.5 }, 0.8, 0.8, 0.8)[0]).toBeGreaterThan(0.85);
  });
  it('saturação −1 dá cinza com a mesma luminância', () => {
    const o = px({ saturation: -1 }, 0.8, 0.2, 0.1);
    expect(o[0]).toBeCloseTo(o[1], 5); expect(o[1]).toBeCloseTo(o[2], 5);
    expect(o[0]).toBeCloseTo(0.2126 * 0.8 + 0.7152 * 0.2 + 0.0722 * 0.1, 5);
  });
  it('HSL: pesos somam 1 e só a faixa certa muda', () => {
    const w = new Float32Array(8);
    for (let h = 0; h < 1; h += 0.013) { bandWeights(h, w); expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5); }
    bandWeights(240 / 360, w);
    expect(w[5]).toBeCloseTo(1, 5);
    const g: ColorGrade = { hsl: { blue: { hue: 0, sat: -1, lum: 0 } } };
    const blue = px(g, 0.1, 0.2, 0.9), red = px(g, 0.9, 0.1, 0.1);
    expect(Math.max(...blue) - Math.min(...blue)).toBeLessThan(0.15); // azul dessaturado
    expect(red[0]).toBeCloseTo(0.9, 5); // vermelho intacto
    const gray = px(g, 0.5, 0.5, 0.5);
    expect(gray[0]).toBeCloseTo(0.5, 5); // neutro intacto
  });
  it('hsv ida e volta', () => {
    const a = [0, 0, 0], b = [0, 0, 0];
    for (const c of [[0.9, 0.2, 0.1], [0.1, 0.8, 0.4], [0.3, 0.3, 0.9], [0.5, 0.5, 0.5]]) {
      rgbToHsv(c[0], c[1], c[2], a); hsvToRgb(a[0], a[1], a[2], b);
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(c[i], 5);
    }
  });
  it('mix 0,5 fica no meio', () => {
    const full = px({ saturation: -1 }, 0.8, 0.2, 0.1);
    const half = px({ saturation: -1, mix: 0.5 }, 0.8, 0.2, 0.1);
    expect(half[0]).toBeCloseTo((full[0] + 0.8) / 2, 5);
  });
  it('nunca gera NaN em entradas extremas', () => {
    const g: ColorGrade = { exposure: 1, contrast: -1, saturation: 1, vibrance: 1, lift: { r: -1, g: 1, b: -1, y: -1 }, gamma: { r: 1, g: -1, b: 1, y: 1 }, gain: { r: -1, g: 1, b: 1, y: -1 }, offset: { r: 1, g: -1, b: 0, y: 1 }, hsl: { red: { hue: 1, sat: 1, lum: 1 } }, highlights: 1, shadows: -1 };
    for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 0.001, 1]]) for (const v of px(g, c[0], c[1], c[2])) expect(Number.isFinite(v)).toBe(true);
  });
  it('applyGradeImageData processa e preserva alfa 0', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 0]) };
    applyGradeImageData(img, { saturation: -1 });
    expect(img.data[0]).toBe(img.data[1]);
    expect(Array.from(img.data.slice(4))).toEqual([10, 20, 30, 0]);
  });
});

describe('looks embutidos', () => {
  it('há 10–15 looks com id e nome PT-BR únicos', () => {
    expect(BUILTIN_LOOKS.length).toBeGreaterThanOrEqual(10);
    expect(BUILTIN_LOOKS.length).toBeLessThanOrEqual(16);
    expect(new Set(BUILTIN_LOOKS.map((l) => l.id)).size).toBe(BUILTIN_LOOKS.length);
  });
  it('cada look gera LUT válida e muda a imagem', () => {
    for (const look of BUILTIN_LOOKS) {
      const l = bakeLook(look, 9);
      expect(l.data.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      let diff = 0;
      for (let i = 0; i < l.data.length; i += 3) {
        const idx = i / 3, r = (idx % 9) / 8, g = (Math.floor(idx / 9) % 9) / 8, b = Math.floor(idx / 81) / 8;
        diff += Math.abs(l.data[i] - r) + Math.abs(l.data[i + 1] - g) + Math.abs(l.data[i + 2] - b);
      }
      expect(diff / (l.data.length / 3)).toBeGreaterThan(0.02);
    }
  });
  it('Noir é P&B e LUT entra no pipeline com intensidade', () => {
    const o = px({ lut: { id: 'look:noir', intensity: 1 } }, 0.8, 0.2, 0.1);
    expect(Math.abs(o[0] - o[2])).toBeLessThan(0.02);
    const half = px({ lut: { id: 'look:noir', intensity: 0.5 } }, 0.8, 0.2, 0.1);
    expect(half[0]).toBeCloseTo((o[0] + 0.8) / 2, 2);
  });
  it('LUT desconhecida é ignorada sem erro', () => {
    const o = px({ lut: { id: 'nao-existe', intensity: 1 } }, 0.3, 0.4, 0.5);
    expect(o[0]).toBeCloseTo(0.3, 5);
  });
});

describe('rodas', () => {
  it('ida e volta disco ⇄ rgb', () => {
    for (const [x, y] of [[0.5, 0], [0, -0.7], [0.3, 0.4], [-0.6, -0.2]]) {
      const w = wheelFromPuck(x, y, 0.2);
      const p = puckFromWheel(w);
      expect(p.x).toBeCloseTo(x, 3); expect(p.y).toBeCloseTo(y, 3); expect(p.master).toBeCloseTo(0.2);
      expect(0.2126 * w.r + 0.7152 * w.g + 0.0722 * w.b).toBeCloseTo(0, 3); // só cor, sem luminância
    }
  });
  it('limita ao disco unitário', () => {
    const p = puckFromWheel(wheelFromPuck(3, 4));
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3);
  });
  it('para cima (Cr+) puxa para o vermelho', () => {
    const w = wheelFromPuck(0, 1);
    expect(w.r).toBeGreaterThan(0); expect(w.g).toBeLessThan(0);
  });
});

describe('escopos', () => {
  it('histograma, waveform e vetorscópio de uma imagem simples', () => {
    const W = 4, H = 2;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { data[i * 4] = i < 4 ? 255 : 0; data[i * 4 + 3] = 255; }
    const s = computeScopes({ data, width: W, height: H }, { waveW: 4, waveH: 8, vecSize: 16 });
    expect(s.histR[255]).toBe(4); expect(s.histR[0]).toBe(4); expect(s.histG[0]).toBe(8);
    expect(s.wave.length).toBe(4 * 8 * 3);
    expect(s.vec.reduce((a, b) => a + b, 0)).toBe(8);
  });
});
