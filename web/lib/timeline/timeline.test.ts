import { describe, expect, it } from 'vitest';
import { collectSnapPoints, nearestPoint, snapSpan, snapThreshold, snapTime } from './snap';
import {
  deleteOps, duplicateOps, fitZoom, formatTick, nearestFreeStart, overlaps, placeClip, rulerSteps, splitOps,
  thumbIndexAt, trimBounds, waveformSlice,
} from './edit';
import { applyOps, findClip } from '../ops';
import { createProject, makeAudioClip, makeTextClip, makeVideoClip } from '../defaults';
import type { MediaAsset, Project, Track, VideoClip } from '../types';

const vid: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const aud: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'trilha.mp3', mime: 'audio/mpeg', size: 1, duration: 60 };

function mock(): Project {
  const p = createProject();
  const { project } = applyOps(p, [
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(vid, 0, { duration: 5, in: 2 }), id: 'v1' } },
    { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(vid, 8, { duration: 4, in: 10 }), id: 'v2' } },
    { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Oi', 1, 2), id: 't1' } },
    { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(aud, 0, { duration: 12 }), id: 'm1' } },
    { op: 'set_captions', segments: [{ id: 's1', start: 0.5, end: 2.2, text: 'olá pessoal' }] },
  ]);
  return project;
}

const track = (p: Project, id: string) => p.tracks.find((t) => t.id === id) as Track;

describe('snap', () => {
  it('coleta pontos únicos e ordenados, com exclusão e playhead', () => {
    const pts = collectSnapPoints(mock(), { exclude: ['v2'], playhead: 6.5 });
    expect(pts).toEqual([0, 0.5, 1, 2.2, 3, 5, 6.5, 12]);
  });

  it('nearestPoint acha o mais próximo', () => {
    expect(nearestPoint(4.4, [0, 3, 5, 12])).toBe(5);
    expect(nearestPoint(3.9, [0, 3, 5, 12])).toBe(3);
    expect(nearestPoint(100, [0, 3])).toBe(3);
    expect(nearestPoint(1, [])).toBeUndefined();
  });

  it('snapTime respeita o limiar', () => {
    expect(snapTime(4.95, [0, 5], 0.1)).toEqual({ t: 5, point: 5 });
    expect(snapTime(4.5, [0, 5], 0.1)).toEqual({ t: 4.5 });
  });

  it('snapSpan encaixa pela borda mais próxima (início ou fim)', () => {
    const pts = [0, 5, 12];
    expect(snapSpan(5.05, 2, pts, 0.1)).toEqual({ start: 5, edge: 'start', point: 5 });
    const r = snapSpan(9.97, 2, pts, 0.1); // fim 11.97 -> 12
    expect(r.edge).toBe('end');
    expect(r.start).toBeCloseTo(10);
    expect(snapSpan(7, 2, pts, 0.1)).toEqual({ start: 7 });
  });

  it('snapThreshold converte px em segundos', () => {
    expect(snapThreshold(80, 8)).toBeCloseTo(0.1);
  });
});

describe('espaço livre', () => {
  it('overlaps detecta sobreposição ignorando excluídos', () => {
    const p = mock();
    expect(overlaps(track(p, 'track_video_1'), 4, 2)).toBe(true);
    expect(overlaps(track(p, 'track_video_1'), 5, 3)).toBe(false);
    expect(overlaps(track(p, 'track_video_1'), 4, 2, ['v1'])).toBe(false);
  });

  it('nearestFreeStart acha a lacuna mais próxima que caiba', () => {
    const tr = track(mock(), 'track_video_1'); // [0,5] [8,12]
    expect(nearestFreeStart(tr, 2, 6)).toBe(6);
    expect(nearestFreeStart(tr, 2, 4)).toBe(5); // empurra para a lacuna
    expect(nearestFreeStart(tr, 4, 6)).toBe(12); // lacuna de 3s não cabe
    expect(nearestFreeStart(tr, 2, 11)).toBe(12);
    expect(nearestFreeStart(tr, 2, -3, ['v1'])).toBe(0);
  });
});

describe('trimBounds', () => {
  it('respeita in>=0, fim da mídia e vizinhos', () => {
    const p = mock();
    const v2 = findClip(p, 'v2')!; // start 8, in 10, dur 4, mídia 20s
    const b = trimBounds(v2.clip, v2.track, vid);
    expect(b.minStart).toBe(5); // vizinho v1 termina em 5 (mídia permitiria -2→0)
    expect(b.maxEnd).toBe(18); // 8 + (20-10)
    const v1 = findClip(p, 'v1')!; // start 0, in 2
    const b1 = trimBounds(v1.clip, v1.track, vid);
    expect(b1.minStart).toBe(0);
    expect(b1.maxEnd).toBe(8); // vizinho v2
    expect(b1.maxStart).toBeCloseTo(4.9);
  });

  it('considera speed', () => {
    const clip = { ...makeVideoClip(vid, 10, { duration: 2, in: 4, speed: 2 }), id: 'x' } as VideoClip;
    const b = trimBounds(clip, undefined, vid);
    expect(b.minStart).toBe(8); // in 4 / speed 2
    expect(b.maxEnd).toBe(10 + (20 - 4) / 2);
  });

  it('texto não tem limite de mídia', () => {
    const p = mock();
    const t = findClip(p, 't1')!;
    expect(trimBounds(t.clip, t.track, undefined).maxEnd).toBe(Infinity);
  });
});

describe('comandos', () => {
  it('splitOps usa seleção ou tudo sob o playhead', () => {
    const p = mock();
    expect(splitOps(p, ['v1'], 2).map((o) => (o as { clipId: string }).clipId)).toEqual(['v1']);
    expect(splitOps(p, [], 2).map((o) => (o as { clipId: string }).clipId).sort()).toEqual(['m1', 't1', 'v1']);
    expect(splitOps(p, ['v2'], 2)).toEqual([]);
  });

  it('splitOps ignora trilhas travadas', () => {
    const p = mock();
    const { project } = applyOps(p, [{ op: 'update_track', trackId: 'track_audio_1', patch: { locked: true } }]);
    expect(splitOps(project, [], 2).map((o) => (o as { clipId: string }).clipId).sort()).toEqual(['t1', 'v1']);
  });

  it('deleteOps com ripple processa da direita para a esquerda', () => {
    const p = mock();
    const ops = deleteOps(p, ['v1', 'v2'], true);
    expect(ops.map((o) => (o as { clipId: string }).clipId)).toEqual(['v2', 'v1']);
    const { project } = applyOps(p, deleteOps(p, ['v1'], true));
    expect(findClip(project, 'v2')!.clip.start).toBe(3);
  });

  it('duplicateOps coloca a cópia no espaço livre seguinte', () => {
    const p = mock();
    const { ops, newIds } = duplicateOps(p, ['v1']);
    const { project, errors } = applyOps(p, ops);
    expect(errors).toEqual([]);
    expect(findClip(project, newIds[0])!.clip.start).toBe(12); // lacuna 5..8 não cabe 5s
  });

  it('placeClip escolhe trilha preferida, outra livre ou nova', () => {
    const p = mock();
    expect(placeClip(p, 'video', 2, 5.5, 'track_video_1')).toEqual({ trackId: 'track_video_1', start: 5.5, newTrack: false });
    const busy = placeClip(p, 'video', 2, 1, 'track_video_1');
    expect(busy.newTrack).toBe(true);
    expect(placeClip(p, 'audio', 2, 20).trackId).toBe('track_audio_1');
    expect(placeClip(p, 'video', 2, 1, 'track_audio_1').newTrack).toBe(true);
  });
});

describe('régua e mídia', () => {
  it('rulerSteps adapta ao zoom', () => {
    expect(rulerSteps(80).major).toBe(1);
    expect(rulerSteps(10).major).toBe(10);
    expect(rulerSteps(400).major).toBe(0.2);
    expect(rulerSteps(8).major * 8).toBeGreaterThanOrEqual(72);
  });

  it('formatTick mostra frames em passos sub-segundo', () => {
    expect(formatTick(75, 5)).toBe('1:15');
    expect(formatTick(1.5, 0.5)).toBe('0:01:15f');
    expect(formatTick(2, 0.5)).toBe('0:02');
  });

  it('fitZoom cabe a duração na largura', () => {
    expect(fitZoom(10, 1000)).toBeCloseTo(94);
    expect(fitZoom(10000, 1000)).toBe(8);
  });

  it('thumbIndexAt e waveformSlice', () => {
    expect(thumbIndexAt(10, 20, 10)).toBe(5);
    expect(thumbIndexAt(25, 20, 10)).toBe(9);
    expect(thumbIndexAt(1, 0, 4)).toBe(0);
    const peaks = Array.from({ length: 100 }, (_, i) => i / 100); // 10/s em 10s
    const s = waveformSlice(peaks, 10, 2, 2, 4);
    expect(s.length).toBe(4);
    expect(s[0]).toBeCloseTo(0.24);
    expect(s[3]).toBeCloseTo(0.39);
  });
});
