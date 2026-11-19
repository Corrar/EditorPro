import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, projectDuration, findClip } from './ops';
import { createProject, makeVideoClip, makeTextClip, makeStickerClip, makeShapeClip, makeAdjustmentClip } from './defaults';
import type { MediaAsset, Project, VideoClip } from './types';

const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 20 };

function withClip(): { p: Project; clip: VideoClip } {
  const p0 = createProject();
  const clip = { ...makeVideoClip(asset, 0), id: 'c1' };
  return { p: applyOp(p0, { op: 'add_clip', trackId: 'track_video_1', clip }), clip };
}

describe('ops', () => {
  it('add_clip coloca o clipe e calcula a duração', () => {
    const { p } = withClip();
    expect(projectDuration(p)).toBe(20);
    expect(findClip(p, 'c1')?.track.id).toBe('track_video_1');
  });

  it('add_clip cria trilha nova quando trackId não existe', () => {
    const p = applyOp(createProject(), { op: 'add_clip', trackId: 'nova', clip: { ...makeTextClip('Oi', 1), id: 't1' } });
    expect(p.tracks.find((t) => t.id === 'nova')?.kind).toBe('text');
  });

  it('split_clip divide e ajusta o in do pedaço direito', () => {
    const { p } = withClip();
    const s = applyOp(p, { op: 'split_clip', clipId: 'c1', at: 8, newId: 'c2' });
    const right = findClip(s, 'c2')!.clip as VideoClip;
    expect(findClip(s, 'c1')!.clip.duration).toBe(8);
    expect(right.start).toBe(8);
    expect(right.in).toBe(8);
    expect(right.duration).toBe(12);
  });

  it('update_clip com colorGrade (DaVinci) e split preservam a correção nos dois pedaços', () => {
    const { p } = withClip();
    const grade = { lift: { r: 0, g: 0, b: 0.05, y: -0.02 }, gain: { r: 0.04, g: 0, b: 0, y: 0 }, contrast: 0.2, curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }] }, hsl: { orange: { hue: 0, sat: 0.1, lum: 0 } }, mix: 1 };
    const g = applyOp(p, { op: 'update_clip', clipId: 'c1', patch: { colorGrade: grade } });
    expect((findClip(g, 'c1')!.clip as VideoClip).colorGrade).toEqual(grade);
    const s = applyOp(g, { op: 'split_clip', clipId: 'c1', at: 5, newId: 'c2' });
    expect((findClip(s, 'c2')!.clip as VideoClip).colorGrade).toEqual(grade);
  });

  it('split respeita speed', () => {
    const { p } = withClip();
    const fast = applyOp(p, { op: 'update_clip', clipId: 'c1', patch: { speed: 2, duration: 10 } });
    const s = applyOp(fast, { op: 'split_clip', clipId: 'c1', at: 4, newId: 'c2' });
    expect((findClip(s, 'c2')!.clip as VideoClip).in).toBe(8);
  });

  it('ripple_delete remove intervalo e puxa o resto (vídeo + legendas)', () => {
    const { p } = withClip();
    const withCaps = applyOp(p, {
      op: 'set_captions',
      segments: [
        { id: 's1', start: 1, end: 3, text: 'olá' },
        { id: 's2', start: 5, end: 6, text: 'some' },
        { id: 's3', start: 12, end: 14, text: 'depois' },
      ],
    });
    const r = applyOp(withCaps, { op: 'ripple_delete', start: 4, end: 10 });
    expect(projectDuration(r)).toBe(14);
    const clips = r.tracks[0].clips as VideoClip[];
    expect(clips).toHaveLength(2);
    expect(clips[1].start).toBe(4);
    expect(clips[1].in).toBe(10);
    expect(r.captions.segments.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(r.captions.segments[1].start).toBe(6);
  });

  it('trim_clip apara início e ajusta in', () => {
    const { p } = withClip();
    const t = applyOp(p, { op: 'trim_clip', clipId: 'c1', start: 2, end: 15 });
    const c = findClip(t, 'c1')!.clip as VideoClip;
    expect([c.start, c.duration, c.in]).toEqual([2, 13, 2]);
  });

  it('applyOps pula op inválida e reporta erro', () => {
    const { p } = withClip();
    const { project, errors } = applyOps(p, [
      { op: 'remove_clip', clipId: 'nao-existe' },
      { op: 'set_aspect', aspect: '16:9' },
    ]);
    expect(errors).toHaveLength(1);
    expect(project.width).toBe(1920);
  });

  it('ripple_delete dá id determinístico ao pedaço direito (replay bate com simulação)', () => {
    const { p } = withClip();
    const a = applyOp(p, { op: 'ripple_delete', start: 4, end: 10 });
    const b = applyOp(p, { op: 'ripple_delete', start: 4, end: 10 });
    expect(a.tracks[0].clips.map((c) => c.id)).toEqual(b.tracks[0].clips.map((c) => c.id));
    expect(new Set(a.tracks[0].clips.map((c) => c.id)).size).toBe(2);
  });

  it('é imutável', () => {
    const { p } = withClip();
    const snapshot = JSON.stringify(p);
    applyOp(p, { op: 'ripple_delete', start: 0, end: 5 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('ops — recursos estilo CapCut', () => {
  it('duplicate_clip coloca a cópia logo após o original', () => {
    const { p } = withClip();
    const d = applyOp(p, { op: 'duplicate_clip', clipId: 'c1', newId: 'c9' });
    expect(findClip(d, 'c9')!.clip.start).toBe(20);
    expect(projectDuration(d)).toBe(40);
  });

  it('marcadores: adicionar, ordenar, mover com ripple e remover', () => {
    const { p } = withClip();
    let q = applyOp(p, { op: 'add_marker', marker: { id: 'm2', t: 15 } });
    q = applyOp(q, { op: 'add_marker', marker: { id: 'm1', t: 2 } });
    expect(q.markers!.map((m) => m.id)).toEqual(['m1', 'm2']);
    q = applyOp(q, { op: 'ripple_delete', start: 5, end: 10 });
    expect(q.markers!.find((m) => m.id === 'm2')!.t).toBe(10);
    q = applyOp(q, { op: 'remove_marker', markerId: 'm1' });
    expect(q.markers).toHaveLength(1);
  });

  it('sticker/forma vão para trilha de sobreposição e ajuste para trilha de efeito', () => {
    let p = createProject();
    p = applyOp(p, { op: 'add_clip', trackId: 'ov1', clip: { ...makeStickerClip(0, { emoji: '🔥' }), id: 's1' } });
    p = applyOp(p, { op: 'add_clip', trackId: 'fx1', clip: { ...makeAdjustmentClip(0), id: 'a1' } });
    expect(p.tracks.find((t) => t.id === 'ov1')!.kind).toBe('overlay');
    expect(p.tracks.find((t) => t.id === 'fx1')!.kind).toBe('effect');
  });

  it('split move animação de saída para a direita e keyframes de forma', () => {
    let p = createProject();
    const shape = { ...makeShapeClip('circle', 0, 4), id: 'sh', keyframes: [{ t: 0, transform: { scale: 0.2 } }, { t: 3, transform: { scale: 0.6 } }], animationOut: { kind: 'fade' as const, duration: 0.3 } };
    p = applyOp(p, { op: 'add_clip', trackId: 'ov1', clip: shape });
    p = applyOp(p, { op: 'split_clip', clipId: 'sh', at: 2, newId: 'sh2' });
    const left = findClip(p, 'sh')!.clip as typeof shape;
    const right = findClip(p, 'sh2')!.clip as typeof shape;
    expect(left.animationOut).toBeUndefined();
    expect(right.animationOut?.kind).toBe('fade');
    expect(right.keyframes!.map((k) => k.t)).toEqual([1]);
  });

  it('move_track reordena camadas', () => {
    const p = applyOp(createProject(), { op: 'move_track', trackId: 'track_audio_1', index: 0 });
    expect(p.tracks[0].id).toBe('track_audio_1');
  });
});

describe('ops — cortes ancorados em palavras', () => {
  it('remove_words corta o trecho das palavras com ripple', () => {
    const { p } = withClip();
    const q = applyOp(p, {
      op: 'set_captions',
      segments: [{ id: 's1', start: 1, end: 6, text: 'olá né tipo pessoal', words: [
        { id: 'w0', start: 1, end: 1.5, text: 'olá' },
        { id: 'w1', start: 2, end: 2.4, text: 'né' },
        { id: 'w2', start: 2.5, end: 3, text: 'tipo' },
        { id: 'w3', start: 5, end: 6, text: 'pessoal' },
      ] }],
    });
    const r = applyOp(q, { op: 'remove_words', fromWordId: 'w1', toWordId: 'w2', padding: 0 });
    expect(projectDuration(r)).toBeCloseTo(19, 5);
    const words = r.captions.segments[0].words!;
    expect(words.map((w) => w.id)).toEqual(['w0', 'w3']);
    expect(words[1].start).toBeCloseTo(4, 5);
    expect(r.captions.segments[0].text).toBe('olá pessoal');
  });
});
