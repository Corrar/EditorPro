import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, projectDuration, findClip } from './ops';
import { createProject, makeVideoClip, makeTextClip } from './defaults';
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
