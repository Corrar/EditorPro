/* Cortes (split/trim/ripple) preservando o que o usuário vê: velocidade/reverso/curva,
   fades, keyframes e marcadores de trecho. Cada teste compara o quadro de origem / o
   valor animado antes e depois da operação nos mesmos tempos de timeline. */
import { describe, expect, it } from 'vitest';
import { applyOp, findClip } from './ops';
import { createProject, makeVideoClip, makeTextClip } from './defaults';
import { mapSourceTime } from './engine/speed';
import { interpolateTransform } from './engine/easing';
import type { Clip, MediaAsset, Project, TextClip, VideoClip } from './types';

const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'v.mp4', mime: 'video/mp4', size: 1, duration: 60 };

function project(patch: Partial<VideoClip>): Project {
  const clip = { ...makeVideoClip(asset, 0), id: 'c1', in: 2, duration: 10, ...patch } as VideoClip;
  return applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip });
}

function videoClips(p: Project): VideoClip[] {
  return p.tracks.flatMap((t) => t.clips).filter((c): c is VideoClip => c.type === 'video');
}

/** tempo de origem mostrado no tempo de timeline t (procura o clipe que cobre t) */
function sourceAt(p: Project, t: number): number {
  const c = videoClips(p).find((x) => t >= x.start - 1e-9 && t < x.start + x.duration - 1e-9)!;
  return mapSourceTime(c, t);
}

const SAMPLES = [0.1, 1, 2.5, 2.99, 3.01, 4, 6, 9.9];

describe('split preserva o quadro de origem', () => {
  it('velocidade constante 2×', () => {
    const p = project({ speed: 2 });
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 3, newId: 'c2' });
    for (const t of SAMPLES) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 6);
  });

  it('reverso', () => {
    const p = project({ reverse: true });
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 3, newId: 'c2' });
    for (const t of SAMPLES) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 6);
  });

  it('curva de velocidade (preset herói) e curva própria', () => {
    for (const patch of [{ speedPreset: 'hero' as const }, { speedCurve: [{ t: 0, speed: 0.5 }, { t: 0.4, speed: 3 }, { t: 1, speed: 1 }] }]) {
      const p = project(patch);
      const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 3, newId: 'c2' });
      for (const t of SAMPLES) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 5);
    }
  });

  it('reverso + curva', () => {
    const p = project({ reverse: true, speedPreset: 'bullet' });
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 4, newId: 'c2' });
    for (const t of SAMPLES) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 5);
  });
});

describe('trim e ripple preservam o quadro de origem', () => {
  it('trim do fim num clipe reverso não muda o começo', () => {
    const p = project({ reverse: true });
    const s = applyOp(p, { op: 'trim_clip', clipId: 'c1', end: 6 });
    for (const t of [0, 1, 3, 5.9]) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 6);
  });

  it('trim do início com curva mantém o resto igual', () => {
    const p = project({ speedPreset: 'montage' });
    const s = applyOp(p, { op: 'trim_clip', clipId: 'c1', start: 2.5 });
    for (const t of [2.6, 4, 7, 9.9]) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 5);
  });

  it('ripple_delete num clipe reverso: o que sobra mostra os mesmos quadros (deslocados)', () => {
    const p = project({ reverse: true, speed: 1.5 });
    const s = applyOp(p, { op: 'ripple_delete', start: 3, end: 5 });
    for (const t of [0.5, 2.9]) expect(sourceAt(s, t)).toBeCloseTo(sourceAt(p, t), 6);
    for (const t of [5.1, 7, 9.9]) expect(sourceAt(s, t - 2)).toBeCloseTo(sourceAt(p, t), 6);
  });
});

describe('fades e animações não reaparecem no corte', () => {
  it('split remove fadeOut da esquerda e fadeIn da direita', () => {
    const p = project({ fadeIn: 1, fadeOut: 1 });
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 5, newId: 'c2' });
    const [l, r] = videoClips(s);
    expect(l.fadeIn).toBe(1);
    expect(l.fadeOut).toBeUndefined();
    expect(r.fadeIn).toBeUndefined();
    expect(r.fadeOut).toBe(1);
  });

  it('ripple_delete no meio faz o mesmo nos dois pedaços', () => {
    const p = project({ fadeIn: 0.5, fadeOut: 1.5 });
    const s = applyOp(p, { op: 'ripple_delete', start: 4, end: 5 });
    const [l, r] = videoClips(s);
    expect([l.fadeIn, l.fadeOut, r.fadeIn, r.fadeOut]).toEqual([0.5, undefined, undefined, 1.5]);
  });

  it('texto dividido não repete a animação de entrada no pedaço direito', () => {
    const t = { ...makeTextClip('Oi', 0, 6), id: 't1', animation: 'pop' } as TextClip;
    const p = applyOp(createProject(), { op: 'add_clip', trackId: 'track_text_1', clip: t });
    const s = applyOp(p, { op: 'split_clip', clipId: 't1', at: 3, newId: 't2' });
    expect((findClip(s, 't1')!.clip as TextClip).animation).toBe('pop');
    expect((findClip(s, 't2')!.clip as TextClip).animation).toBe('none');
  });
});

describe('keyframes continuam contínuos', () => {
  const kfs = [{ t: 0, transform: { scale: 1 } }, { t: 10, transform: { scale: 2 } }];
  const scaleAt = (p: Project, t: number) => {
    const c = videoClips(p).find((x) => t >= x.start - 1e-9 && t < x.start + x.duration - 1e-9)! as Clip & { keyframes?: VideoClip['keyframes']; transform: VideoClip['transform'] };
    return interpolateTransform(c.transform, c.keyframes, t - c.start).scale;
  };

  it('split no meio não salta', () => {
    const p = project({ keyframes: kfs });
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 5, newId: 'c2' });
    for (const t of [1, 4.9, 5, 5.1, 9]) expect(scaleAt(s, t)).toBeCloseTo(scaleAt(p, t), 6);
  });

  it('trim do início desloca os keyframes', () => {
    const p = project({ keyframes: kfs });
    const s = applyOp(p, { op: 'trim_clip', clipId: 'c1', start: 4 });
    for (const t of [4, 6, 9.9]) expect(scaleAt(s, t)).toBeCloseTo(scaleAt(p, t), 6);
  });

  it('ripple_delete: o pedaço direito continua de onde estava', () => {
    const p = project({ keyframes: kfs });
    const s = applyOp(p, { op: 'ripple_delete', start: 2, end: 4 });
    for (const t of [1, 1.9]) expect(scaleAt(s, t)).toBeCloseTo(scaleAt(p, t), 6);
    for (const t of [4.1, 7]) expect(scaleAt(s, t - 2)).toBeCloseTo(scaleAt(p, t), 6);
  });
});

describe('marcadores de trecho no ripple_delete', () => {
  const withMarkers = () => {
    let p = project({});
    p = applyOp(p, { op: 'add_marker', marker: { id: 'm1', t: 8, end: 12, kind: 'comment', label: 'a' } as never });
    p = applyOp(p, { op: 'add_marker', marker: { id: 'm2', t: 2, end: 12, kind: 'comment', label: 'b' } as never });
    p = applyOp(p, { op: 'add_marker', marker: { id: 'm3', t: 5, end: 9, kind: 'comment', label: 'c' } as never });
    return applyOp(p, { op: 'ripple_delete', start: 4, end: 6 });
  };
  it('desloca o fim junto e não apaga trecho que sobrevive', () => {
    const m = Object.fromEntries((withMarkers().markers ?? []).map((x) => [x.id, x as { t: number; end?: number }]));
    expect([m.m1.t, m.m1.end]).toEqual([6, 10]);
    expect([m.m2.t, m.m2.end]).toEqual([2, 10]);
    expect(m.m3).toBeDefined();
    expect([m.m3.t, m.m3.end]).toEqual([4, 7]);
  });
});
