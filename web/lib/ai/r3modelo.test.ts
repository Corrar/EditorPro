/* Revisão r3 — vídeo-modelo definitivo e movimento suave: um teste por bug confirmado */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, Keyframe, MediaAsset, Project, ReferenceTemplate } from '../types';
import { styleFromCuts } from './demo';
import { fidelityOf } from './fidelity';
import { edgePxPerFrame, measureReference, type Gray } from './motion';
import { smoothMotionOps, templateOps } from './template';
import { sanitizeOps } from './validate';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 15 };
const base = (dur = 15): Project => applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip({ ...src, duration: dur }, 0), id: 'c1' } }]).project;
const assets = { a1: src };
/** fala com 1 palavra a cada 0,4 s e respiros de 0,3 s a cada 4 palavras */
function speech(dur: number): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  let t = 0.1, k = 0;
  while (t < dur - 1) {
    const words = [];
    for (let i = 0; i < 4 && t < dur - 0.4; i++, k++) { words.push({ id: `w${k}`, text: `p${k}`, start: +t.toFixed(3), end: +(t + 0.34).toFixed(3) }); t += 0.4; }
    segs.push({ id: `s${segs.length}`, start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(' '), words });
    t += 0.3;
  }
  return segs;
}
const color = { r: 0.6, g: 0.47, b: 0.35, sat: 0.684, lum: 0.5, lumSd: 0.2 };
const withSpeech = (dur = 15) => applyOps(base(dur), [{ op: 'set_captions', segments: speech(dur), language: 'pt-BR' } as EditOp]).project;
const kfOf = (ops: EditOp[]) => (ops[0] as Extract<EditOp, { op: 'update_clip' }>).patch.keyframes as Keyframe[];

describe('smoothMotionOps: rampa que não dá para esticar não fica brusca (≤8 px/quadro)', () => {
  it('zoom com x no mesmo keyframe (antes: 56 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1, x: 0 } }, { t: 0.3, transform: { scale: 1.25, x: 0.05 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
    expect(kf[1].transform.scale).toBeGreaterThan(1.2); // esticou no tempo, não cortou o zoom à toa
  });
  it('clipe curto: o fim do clipe impede de esticar → encurta o zoom (antes: 15 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.3, transform: { scale: 1.3 } }] } }];
    const kf = kfOf(smoothMotionOps(base(1), ops));
    expect(edgePxPerFrame(kf, 1)).toBeLessThanOrEqual(8);
    expect(kf[1].transform.scale).toBeGreaterThan(1.05);
    expect(kf.every((k) => k.t >= 0 && k.t <= 1)).toBe(true);
  });
  it('vai e volta: o próximo keyframe impede de esticar (antes: 27 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.3, transform: { scale: 1.3 } }, { t: 0.6, transform: { scale: 1 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
  });
  it('keyframe com props (efeito) mantém o tempo e encurta a variação', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.5, transform: { scale: 1.2 }, props: { 'effects.0.intensity': 1 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(kf[1].t).toBe(0.5);
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
  });
});

describe('fidelidade: modelo com movimento lateral (pan)', () => {
  it('a réplica do pan pontua o movimento (antes: 0% sempre, e o conserto rodava à toa)', () => {
    const t: ReferenceTemplate = {
      shots: Array.from({ length: 5 }, (_, i) => ({ start: i * 2, end: (i + 1) * 2 })), shotStats: { median: 2, p10: 2, p90: 2 },
      motion: { mode: 'pan', avgZoomPerShot: 1, easing: 'easeInOut', direction: 'in', punchFrequency: 0, perShot: [] },
      transitions: [{ kind: 'cut', duration: 0, frequency: 1 }], color,
    };
    const st = styleFromCuts([2, 4, 6, 8], 10, {}, color, t);
    let p = withSpeech(15);
    p = sanitizeOps(templateOps(p, st).ops, p, assets).project;
    const f = fidelityOf(p, st, { r: 0.6, g: 0.47, b: 0.35 })!;
    expect(f.scores.movimento).toBeGreaterThanOrEqual(0.8);
    // sem movimento nenhum a nota cai
    expect(fidelityOf(withSpeech(15), st)!.scores.movimento).toBeLessThan(0.5);
  });
});

/** textura procedural (como em motion.test.ts) com zoom `s` e deslocamento `dx` (px) */
const GW = 108, GH = 192;
function scene(s: number, seed = 0, dx = 0): Gray {
  const d = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const k = 1 + 0.35 * (seed % 3);
    const u = ((x - GW / 2) / s + GW / 2 + dx) * k + seed * 37.3, v = ((y - GH / 2) / s + GH / 2) * k + seed * 91.7;
    d[y * GW + x] = 128 + 50 * Math.sin(u * 0.21 + seed) * Math.cos(v * 0.17 - seed) + 35 * Math.sin((u + v) * 0.09 + seed * 2) + 20 * Math.cos(u * 0.53 - v * 0.31 + seed);
  }
  return { w: GW, h: GH, data: d };
}

describe('medição do modelo: pan lento não vira zoom', () => {
  it('deslocamento subpixel por quadro (0,6–1,7 px a 108 px): modo pan, zoom 1, pan medido certo', () => {
    for (const v of [0.6, 1.2, 1.7]) {
      const gray: Gray[] = [], times: number[] = [];
      for (let i = 0; i < 30; i++) { gray.push(scene(1, 1, i * v)); times.push(+(i / 10).toFixed(3)); }
      const m = measureReference(gray, times, []);
      expect(m.template.motion.mode).toBe('pan');
      expect(Math.abs(m.template.motion.perShot[0].zoomTotal - 1)).toBeLessThan(0.01);
      expect(Math.abs(m.template.motion.perShot[0].panX - (-29 * v) / GW)).toBeLessThan(0.03);
    }
  });
});
