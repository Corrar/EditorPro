/* motion.ts em quadros sintéticos (zoom suave, pancada, corte, dissolver, legenda) */
import { describe, expect, it } from 'vitest';
import { alignPair, cutsOnBeatsRatio, detectCaptionBand, detectCuts, easingFromVelocity, edgePxPerFrame, measureReference, summarizeMotion, type Gray, type RgbFrame } from './motion';

const W = 108, H = 192;
/** textura procedural (várias frequências) vista com zoom `s` em torno do centro; `seed` troca a cena */
function scene(s: number, seed = 0, dx = 0): Gray {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = 1 + 0.35 * (seed % 3);
    const u = ((x - W / 2) / s + W / 2 + dx) * k + seed * 37.3, v = ((y - H / 2) / s + H / 2) * k + seed * 91.7;
    d[y * W + x] = 128 + 50 * Math.sin(u * 0.21 + seed) * Math.cos(v * 0.17 - seed) + 35 * Math.sin((u + v) * 0.09 + seed * 2) + 20 * Math.cos(u * 0.53 - v * 0.31 + seed);
  }
  return { w: W, h: H, data: d };
}
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const toRgb = (g: Gray, band?: { y0: number; y1: number; text: [number, number, number]; box: [number, number, number] }): RgbFrame => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const y = Math.floor(i / W), x = i % W;
    let c: [number, number, number] = [g.data[i], g.data[i] * 0.9, g.data[i] * 0.8];
    if (band && y >= band.y0 * H && y < band.y1 * H && x > W * 0.2 && x < W * 0.8) c = (x % 6 < 3 && y % 5 < 3) ? band.text : band.box;
    d.set([c[0], c[1], c[2], 255], i * 4);
  }
  return { w: W, h: H, data: d };
};

describe('motion.ts (sintético)', () => {
  it('alignPair recupera a escala entre quadros vizinhos (±0,002)', () => {
    for (const s of [1, 1.012, 1.03, 0.985]) {
      const m = alignPair(scene(1), scene(s), { sMin: 0.94, sMax: 1.1 });
      expect(Math.abs(m.s - s)).toBeLessThan(0.002);
    }
  });
  it('3 tomadas de 1,2 s com push-in suave 1→1,15 (easeInOut): cortes exatos, smooth-push ~1,15, pico/média < 3', () => {
    const fps = 10, gray: Gray[] = [], times: number[] = [];
    for (let i = 0; i < 36; i++) {
      const t = i / fps + 0.05, shot = Math.floor(t / 1.2), x = (t - shot * 1.2) / 1.2;
      gray.push(scene(1 + 0.15 * ease(x), shot * 3));
      times.push(+t.toFixed(3));
    }
    const m = measureReference(gray, times, [], { duration: 3.6 });
    expect(m.cuts).toEqual([1.2, 2.4]);
    expect(m.template.motion.mode).toBe('smooth-push');
    expect(Math.abs(m.template.motion.avgZoomPerShot - 1.15)).toBeLessThan(0.03);
    expect(m.template.motion.perShot.every((s) => s.peakOverMean < 3 && s.punches === 0)).toBe(true);
    expect(m.template.transitions.filter((t) => t.kind !== 'cut')).toEqual([]);
  });
  it('pancada (1→1,15 em 2 quadros, depois parado) vira punch', () => {
    const fps = 10, gray: Gray[] = [], times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = i / fps, ph = t % 2;
      gray.push(scene(ph < 0.2 ? 1 + 0.15 * (ph / 0.2) : ph < 1.6 ? 1.15 : 1 + 0.15 * (1 - (ph - 1.6) / 0.4)));
      times.push(+t.toFixed(3));
    }
    const m = measureReference(gray, times, []);
    expect(m.template.motion.mode).toBe('punch');
  });
  it('câmera parada = static; dissolver detectado', () => {
    const fps = 10, gray: Gray[] = [], times: number[] = [];
    const A = scene(1, 0), B = scene(1, 5);
    for (let i = 0; i < 30; i++) {
      const t = i / fps;
      const al = Math.max(0, Math.min(1, (t - 1.2) / 0.6));
      gray.push({ w: W, h: H, data: A.data.map((v, k) => v * (1 - al) + B.data[k] * al) as Float32Array });
      times.push(+t.toFixed(3));
    }
    const m = measureReference(gray, times, []);
    expect(m.template.motion.mode).toBe('static');
    expect(m.template.transitions.some((t) => t.kind === 'crossfade')).toBe(true);
  });
  it('faixa de legenda: texto amarelo em caixa parado sobre fundo que mexe; fundo parado = nada (sem falso positivo)', () => {
    const band = { y0: 0.7, y1: 0.77, text: [255, 212, 0] as [number, number, number], box: [17, 14, 13] as [number, number, number] };
    const moving = Array.from({ length: 24 }, (_, i) => toRgb(scene(1 + i * 0.012, Math.floor(i / 12)), band));
    const cap = detectCaptionBand(moving)!;
    expect(cap).toBeTruthy();
    expect(Math.abs(cap.region.y0 - 0.7)).toBeLessThan(0.02);
    expect(Math.abs(cap.region.y1 - 0.77)).toBeLessThan(0.02);
    expect(cap.boxColor).not.toBeNull();
    expect(parseInt(cap.textColor.slice(1, 3), 16)).toBeGreaterThan(200);
    const still = Array.from({ length: 24 }, () => toRgb(scene(1), band));
    expect(detectCaptionBand(still)).toBeUndefined();
  });
  it('easing pela posição do pico de velocidade', () => {
    expect(easingFromVelocity([1, 3, 5, 3, 1])).toBe('easeInOut');
    expect(easingFromVelocity([5, 3, 2, 1, 0.5])).toBe('easeOut');
    expect(easingFromVelocity([0.5, 1, 2, 3, 5])).toBe('easeIn');
    expect(easingFromVelocity([2, 2, 2, 2])).toBe('linear');
  });
  it('detectCuts ignora movimento e pega troca de cena', () => {
    const gray = [scene(1), scene(1.01), scene(1.02), scene(1, 4), scene(1.01, 4)];
    const pairs = gray.slice(1).map((g, i) => alignPair(gray[i], g, { sMin: 0.94, sMax: 1.1 }));
    expect(detectCuts({ times: [0, 0.1, 0.2, 0.3, 0.4], pairs })).toEqual([0.25]);
  });
  it('summarizeMotion: push-pull quando alterna; cutsOnBeats; régua px/quadro', () => {
    const shot = (z: number) => ({ start: 0, end: 1.5, zoomTotal: z, panX: 0, panY: 0, peakOverMean: 1.6, easing: 'easeInOut' as const, punches: 0 });
    expect(summarizeMotion([shot(1.06), shot(1 / 1.06), shot(1.06), shot(1 / 1.06)]).mode).toBe('push-pull');
    expect(cutsOnBeatsRatio([1, 2, 3], [1.05, 2.5, 3.02])).toBeCloseTo(0.667, 2);
    // 1.0→1.2 em 3 s easeInOut ≈ 5,4 px/quadro (pico 3× a média); 1.25→1 em 0,5 s easeOut ≈ 40 px
    expect(edgePxPerFrame([{ t: 0, transform: { scale: 1 } }, { t: 3, transform: { scale: 1.2 }, easing: 'easeInOut' }], 3)).toBeLessThan(6);
    expect(edgePxPerFrame([{ t: 0, transform: { scale: 1.25 } }, { t: 0.5, transform: { scale: 1 }, easing: 'easeOut' }], 1)).toBeGreaterThan(20);
  });
});
