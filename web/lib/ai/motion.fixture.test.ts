/* motion.ts nos vídeos reais do diagnóstico (docs/fixtures/legendas-modelo/referencia), via ffmpeg */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { measureReference, type Gray, type RgbFrame } from './motion';

const DIR = path.resolve(__dirname, '../../../docs/fixtures/legendas-modelo/referencia');
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return existsSync(DIR); } catch { return false; } })();
const W = 108, H = 192, FPS = 10;

function load(file: string): { gray: Gray[]; rgb: RgbFrame[]; times: number[] } {
  const g = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(DIR, file), '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const c = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(DIR, file), '-vf', `fps=${FPS},scale=${W}:${H},format=rgba`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const n = Math.floor(g.length / (W * H));
  const gray: Gray[] = [], rgb: RgbFrame[] = [], times: number[] = [];
  for (let i = 0; i < n; i++) {
    gray.push({ w: W, h: H, data: new Uint8ClampedArray(g.buffer, g.byteOffset + i * W * H, W * H) });
    rgb.push({ w: W, h: H, data: new Uint8ClampedArray(c.buffer, c.byteOffset + i * W * H * 4, W * H * 4) });
    times.push(+(i / FPS + 0.05).toFixed(3));
  }
  return { gray, rgb, times };
}

describe.skipIf(!hasFfmpeg)('motion.ts nos vídeos reais', () => {
  it('reference.mp4: cortes 1,2…10,8, push-in suave ~15%, faixa de legenda amarela em caixa', () => {
    const f = load('reference.mp4');
    const t0 = Date.now();
    const m = measureReference(f.gray, f.times, f.rgb);
    const ms = Date.now() - t0;
    console.log('reference', ms, 'ms (cálculo', m.ms, 'ms)', JSON.stringify({ cuts: m.cuts, motion: { ...m.template.motion, perShot: m.template.motion.perShot.map((s) => [s.start, s.end, s.zoomTotal, s.peakOverMean, s.easing, s.punches]) }, tr: m.template.transitions, cap: m.template.captions }));
    expect(m.cuts.length).toBe(9);
    m.cuts.forEach((c, i) => expect(Math.abs(c - 1.2 * (i + 1))).toBeLessThanOrEqual(0.11));
    expect(m.template.motion.mode).toBe('smooth-push');
    expect(m.template.motion.avgZoomPerShot).toBeGreaterThan(1.1);
    expect(m.template.motion.avgZoomPerShot).toBeLessThan(1.2);
    expect(m.template.transitions.filter((t) => t.kind !== 'cut')).toEqual([]);
  });
  it('punch.mp4: classificado como pancada', () => {
    const f = load('punch.mp4');
    const m = measureReference(f.gray, f.times, f.rgb);
    console.log('punch', JSON.stringify({ cuts: m.cuts, motion: { ...m.template.motion, perShot: m.template.motion.perShot.map((s) => [s.start, s.end, s.zoomTotal, s.peakOverMean, s.easing, s.punches]) }, cap: m.template.captions }));
    expect(m.template.motion.mode).toBe('punch');
  });
  it('raw.mp4 (material bruto)', () => {
    const f = load('raw.mp4');
    const m = measureReference(f.gray, f.times, f.rgb);
    console.log('raw', JSON.stringify({ cuts: m.cuts, mode: m.template.motion.mode, z: m.template.motion.avgZoomPerShot, cap: m.template.captions }));
  });
});
