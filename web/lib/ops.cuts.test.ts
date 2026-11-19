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

/* ---------- legendas ancoradas na mídia (sessão legendas, plano §2.7) ---------- */
import { applyOps, retimeCaptions, timelineTimeForSource } from './ops';
import type { CaptionSegment } from './types';
import { captionsMediaToTimeline } from './ai/timemap';

describe('legendas acompanham a fala depois de mexer nos clipes (deriva ≤ 1 ms)', () => {
  // 2 clipes da mesma mídia: c1 mostra 0–10 s, c2 mostra 10–20 s; palavra a cada 0,5 s (tempo = mídia)
  const base = (): Project => {
    let p = applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'c1', in: 0, duration: 10 } as VideoClip });
    p = applyOp(p, { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 10), id: 'c2', in: 10, duration: 10 } as VideoClip });
    const segs: CaptionSegment[] = [];
    for (let s = 0; s < 20; s += 2) {
      const words = [0, 0.5, 1, 1.5].map((d, i) => ({ id: `w${s * 10 + i}`, start: s + d + 0.05, end: s + d + 0.4, text: `p${s * 10 + i}` }));
      segs.push({ id: `s${s}`, start: words[0].start, end: words[3].end, text: words.map((w) => w.text).join(' '), words });
    }
    return applyOp(p, { op: 'set_captions', segments: segs, source: 'transcription' });
  };
  /** instante da mídia de cada palavra (pelo nome pN, a mídia original é conhecida) */
  const mediaOf = (text: string) => { const n = +text.slice(1); const s = Math.floor(n / 10); const i = n % 10; return s + [0, 0.5, 1, 1.5][i] + 0.225; };
  function drift(p: Project): { max: number; words: number } {
    let max = 0, words = 0;
    for (const s of p.captions.segments) for (const w of s.words ?? []) {
      // início da palavra (o meio não serve com curva de velocidade: não é linear)
      const t = w.start + 1e-6;
      const c = videoClips(p).find((x) => t >= x.start - 1e-9 && t <= x.start + x.duration + 1e-9);
      expect(c, `palavra ${w.text} fora de clipe`).toBeTruthy();
      max = Math.max(max, Math.abs(mapSourceTime(c!, w.start) - (mediaOf(w.text) - 0.175)));
      words++;
    }
    return { max, words };
  }

  it('velocidade 1,2 no 2º clipe', () => {
    const p = applyOp(base(), { op: 'update_clip', clipId: 'c2', patch: { speed: 1.2, duration: 10 / 1.2 } });
    const d = drift(p);
    expect(d.max).toBeLessThanOrEqual(0.001);
    expect(d.words).toBe(40);
  });
  it('preset de velocidade "herói" no 1º clipe (curva)', () => {
    const p = applyOp(base(), { op: 'update_clip', clipId: 'c1', patch: { speedPreset: 'hero' } });
    const d = drift(p);
    expect(d.max).toBeLessThanOrEqual(0.001);
  });
  it('remover o 1º clipe com ripple: palavras dele somem, as do 2º vêm junto', () => {
    const p = applyOp(base(), { op: 'remove_clip', clipId: 'c1', ripple: true });
    const d = drift(p);
    expect(d.max).toBeLessThanOrEqual(0.001);
    expect(d.words).toBe(20);
    expect(p.captions.segments[0].start).toBeLessThan(0.2);
  });
  it('mover o 2º clipe', () => {
    const p = applyOp(base(), { op: 'move_clip', clipId: 'c2', start: 11 });
    expect(drift(p).max).toBeLessThanOrEqual(0.001);
    expect(p.captions.segments.find((s) => s.id === 's10')!.start).toBeCloseTo(11.05, 3);
  });
  it('aparar o fim do 1º clipe: palavras do trecho cortado somem, as outras não mexem', () => {
    const before = base();
    const p = applyOp(before, { op: 'trim_clip', clipId: 'c1', end: 8 });
    const d = drift(p);
    expect(d.max).toBeLessThanOrEqual(0.001);
    expect(d.words).toBe(36);
    expect(p.captions.segments.find((s) => s.id === 's10')).toEqual(before.captions.segments.find((s) => s.id === 's10'));
  });
  it('curva "montagem" já na hora de transcrever (timemap usa o inverso da curva)', () => {
    const p0 = applyOp(base(), { op: 'set_captions', segments: [], source: undefined });
    const p = applyOp(p0, { op: 'update_clip', clipId: 'c1', patch: { speedPreset: 'montage' } });
    // transcrição em tempos DA MÍDIA -> timeline
    const media: CaptionSegment[] = [{ id: 'm', start: 2.05, end: 9.4, text: 'p20 p21 p80 p81', words: [
      { start: 2.05, end: 2.4, text: 'p20' }, { start: 2.55, end: 2.9, text: 'p21' }, { start: 8.05, end: 8.4, text: 'p80' }, { start: 8.55, end: 8.9, text: 'p81' }] }];
    const tl = captionsMediaToTimeline(p, 'a1', media);
    const p2 = applyOp(p, { op: 'set_captions', segments: tl });
    expect(drift(p2).max).toBeLessThanOrEqual(0.001);
  });
  it('clipe sem mudança de tempo (só volume): legendas idênticas (mesmo objeto)', () => {
    const before = base();
    const p = applyOp(before, { op: 'update_clip', clipId: 'c1', patch: { volume: 0.5 } });
    expect(p.captions).toBe(before.captions);
    const p2 = applyOps(before, [{ op: 'update_clip', clipId: 'c1', patch: { speed: 1 } }]).project;
    expect(p2.captions.segments).toEqual(before.captions.segments);
  });
  it('timelineTimeForSource inverte mapSourceTime (constante, curva e reverso)', () => {
    for (const patch of [{ speed: 1.7 }, { speedPreset: 'bullet' as const }, { reverse: true }, { reverse: true, speedPreset: 'montage' as const }]) {
      const c = { ...makeVideoClip(asset, 3), id: 'x', in: 5, duration: 8, ...patch } as VideoClip;
      for (const t of [3.1, 5, 7.77, 10.9]) {
        const m = mapSourceTime(c, t);
        expect(Math.abs(timelineTimeForSource(c, m)! - t)).toBeLessThan(1e-4);
      }
    }
    expect(retimeCaptions(base(), base()).captions.segments.length).toBe(10);
  });
});
