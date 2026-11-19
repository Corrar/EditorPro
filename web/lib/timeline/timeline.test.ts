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
    expect(formatTick(1.5, 0.5)).toBe('15f');
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

describe('responsivo', () => {
  it('dimsFor alterna compacto/baixo/toque', async () => {
    const { dimsFor, rowLayout } = await import('./ui');
    const desk = dimsFor(1200, 400, false);
    expect(desk.compact).toBe(false);
    expect(desk.headerW).toBe(184);
    const phone = dimsFor(390, 300, true);
    expect(phone.compact).toBe(true);
    expect(phone.headerW).toBeLessThan(64);
    expect(phone.rowH.video).toBeLessThan(desk.rowH.video);
    const low = dimsFor(1200, 150, false);
    expect(low.short).toBe(true);
    expect(low.rulerH).toBeLessThan(desk.rulerH);
    expect(dimsFor(0, 0, false).compact).toBe(false); // ainda não medido
    expect(dimsFor(760, 300, false)).toMatchObject({ compact: false, barCompact: true }); // timeline ao lado do chat
    expect(dimsFor(1000, 300, false).barCompact).toBe(false);
    const rows = rowLayout(mock(), false, phone.rowH);
    expect(rows[0].kind).toBe('captions');
    expect(rows.find((r) => r.kind === 'video')!.height).toBe(phone.rowH.video);
  });
});

describe('selos do clipe', () => {
  it('clipBadges resume velocidade, reverso, efeitos, máscara e keyframes', async () => {
    const { clipBadges, assetIdOf } = await import('./clip');
    const { makeStickerClip, makeAdjustmentClip } = await import('../defaults');
    const v = { ...makeVideoClip(vid, 0, { speed: 2, reverse: true, effects: [{ kind: 'glitch', intensity: 0.5 }], mask: { shape: 'circle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rotation: 0, feather: 0 } }) };
    expect(clipBadges(v)).toMatchObject({ speed: '2x', reverse: true, effects: 1, mask: true });
    expect(clipBadges({ ...v, speedPreset: 'hero' }).speed).toBe('herói');
    expect(clipBadges(makeVideoClip(vid, 0)).speed).toBeUndefined();
    expect(assetIdOf(makeStickerClip(0, { emoji: '🔥' }))).toBeUndefined();
    expect(clipBadges(makeAdjustmentClip(0, 3, { colorPreset: 'warm', filters: [{ kind: 'contrast', value: 0.2 }] })).effects).toBe(2);
  });
});

describe('edição avançada', () => {
  const run = (p: Project, ops: import('../ops').EditOp[]) => {
    const r = applyOps(p, ops);
    expect(r.errors).toEqual([]);
    return r.project;
  };
  it('packOps fecha buracos da trilha principal', async () => {
    const { packOps, mainTrackId } = await import('./edit');
    const p = mock();
    expect(mainTrackId(p)).toBe('track_video_1');
    const q = run(p, packOps(track(p, 'track_video_1')));
    expect(findClip(q, 'v2')!.clip.start).toBe(5);
  });
  it('magneticOrder reordena pelo centro e packOps aplica a ordem', async () => {
    const { magneticOrder, packOps, magneticInsertTime } = await import('./edit');
    const p = mock(); // v1 [0,5], v2 [8,12]
    const tr = track(p, 'track_video_1');
    const order = magneticOrder(tr, 'v2', 0, 4);
    expect(order).toEqual(['v2', 'v1']);
    expect(magneticInsertTime(tr, order, 'v2')).toBe(0);
    const q = run(p, packOps(tr, order));
    expect(findClip(q, 'v2')!.clip.start).toBe(0);
    expect(findClip(q, 'v1')!.clip.start).toBe(4);
  });
  it('insertOps divide quem cruza e empurra o resto', async () => {
    const { insertOps } = await import('./edit');
    const p = mock();
    const q = run(p, insertOps(track(p, 'track_video_1'), 2, 3));
    const tr = track(q, 'track_video_1');
    expect(tr.clips.map((c) => [c.start, c.duration])).toEqual([[0, 2], [5, 3], [11, 4]]);
    expect((tr.clips[1] as VideoClip).in).toBe(4); // in 2 + 2s
  });
  it('overwriteOps apara, divide e remove', async () => {
    const { overwriteOps } = await import('./edit');
    const p = mock();
    const q = run(p, overwriteOps(track(p, 'track_video_1'), 4, 9));
    expect(track(q, 'track_video_1').clips.map((c) => [c.start, c.duration])).toEqual([[0, 4], [9, 3]]);
    const r = run(p, overwriteOps(track(p, 'track_video_1'), 1, 2));
    expect(track(r, 'track_video_1').clips.map((c) => [c.start, +c.duration.toFixed(3)])).toEqual([[0, 1], [2, 3], [8, 4]]);
    const s2 = run(p, overwriteOps(track(p, 'track_video_1'), 7, 13));
    expect(track(s2, 'track_video_1').clips.map((c) => c.id)).toEqual(['v1']);
  });
  it('copiar/colar mantém deslocamento relativo e evita sobreposição', async () => {
    const { copyItems, pasteOps } = await import('./edit');
    const p = mock();
    const items = copyItems(p, ['t1', 'm1']);
    const { ops, newIds } = pasteOps(p, items, 20);
    const q = run(p, ops);
    expect(findClip(q, newIds[0])!.clip.start).toBe(20); // m1 começava em 0 (base)
    expect(findClip(q, newIds[1])!.clip.start).toBe(21); // t1 em +1
    expect(findClip(q, newIds[1])!.track.id).toBe('track_text_1');
    const again = pasteOps(q, items, 0); // ocupado => trilhas novas
    const r = run(q, again.ops);
    expect(findClip(r, again.newIds[1])!.track.id).not.toBe('track_text_1');
  });
  it('duplicateOps usa duplicate_clip e cópias não colidem', async () => {
    const p = mock();
    const { ops, newIds } = duplicateOps(p, ['v1', 'v2']);
    expect(ops[0].op).toBe('duplicate_clip');
    const q = run(p, ops);
    const a = findClip(q, newIds[0])!.clip;
    const b = findClip(q, newIds[1])!.clip;
    expect(a.start + a.duration <= b.start || b.start + b.duration <= a.start).toBe(true);
  });
  it('separar áudio, velocidade e congelar quadro', async () => {
    const { detachAudioOps, speedOps, freezeFrameOps } = await import('./edit');
    const p = mock();
    const q = run(p, detachAudioOps(p, 'v1'));
    expect((findClip(q, 'v1')!.clip as VideoClip).muted).toBe(true);
    const audio = q.tracks.flatMap((t) => t.clips).find((c) => c.type === 'audio' && c.start === 0 && c.duration === 5);
    expect(audio && (audio as { in: number }).in).toBe(2);
    const s2 = run(p, speedOps(p, 'v1', 2, 20));
    expect(findClip(s2, 'v1')!.clip.duration).toBe(2.5);
    const s3 = run(p, speedOps(p, 'v2', 0.5, 20)); // in 10, 4s -> limitado pela mídia (10s restantes) => 8s
    expect(findClip(s3, 'v2')!.clip.duration).toBe(8);
    const fr = freezeFrameOps(p, 'v1', 2, { id: 'img1' }, 1.5);
    const s4 = run(p, fr.ops);
    expect(findClip(s4, fr.imageId!)!.clip.start).toBe(2);
    expect(findClip(s4, 'v2')!.clip.start).toBe(9.5);
  });
});

describe('keyframes', () => {
  it('interpola, alterna e move', async () => {
    const { transformAt, keyframeToggleOps, moveKeyframeOps, keyframesOf } = await import('./keyframes');
    const p = mock();
    const v = findClip(p, 'v1')!.clip;
    const withKf = { ...v, keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 2 } }] } as typeof v;
    expect(transformAt(withKf, 1).scale).toBeCloseTo(1.5);
    expect(transformAt(withKf, 5).scale).toBe(2);
    expect(transformAt(withKf, 1).x).toBe(0);
    let q = applyOps(p, keyframeToggleOps(p, 'v1', 1)).project;
    expect(keyframesOf(findClip(q, 'v1')!.clip).map((k) => k.t)).toEqual([1]);
    q = applyOps(q, keyframeToggleOps(q, 'v1', 3)).project;
    q = applyOps(q, moveKeyframeOps(q, 'v1', 0, 4)).project;
    expect(keyframesOf(findClip(q, 'v1')!.clip).map((k) => k.t)).toEqual([3, 4]);
    q = applyOps(q, keyframeToggleOps(q, 'v1', 3.01)).project; // a menos de 1 quadro => remove
    expect(keyframesOf(findClip(q, 'v1')!.clip).map((k) => k.t)).toEqual([4]);
    expect(keyframeToggleOps(p, 'm1', 1)).toEqual([]); // áudio não tem keyframe
  });
});

describe('batidas e marcadores', () => {
  it('beatTimes mapeia batidas da mídia para a timeline (in/speed) e markerSnapPoints junta marcadores', async () => {
    const { beatTimes, markerSnapPoints } = await import('./edit');
    const p = applyOps(mock(), [{ op: 'add_marker', marker: { id: 'mk1', t: 3, end: 4, kind: 'comment' } }]).project;
    // m1: áudio de 0..12 com in 0; v1: in 2 dur 5 (vid sem beats)
    const assets = { m1: { ...aud, beats: [0.5, 1, 30] }, a1: { ...vid, beats: [1, 3, 9] } };
    const bt = beatTimes(p, assets);
    expect(bt).toContain(0.5); // música
    expect(bt).toContain(1); // v1: beat 3 da mídia (in 2) => t=1
    expect(bt).not.toContain(30); // fora do trecho usado
    const pts = markerSnapPoints(p, assets, []);
    expect(pts).toContain(3);
    expect(pts).toContain(4);
    expect(markerSnapPoints(p, {}, ['mk1'])).toEqual([]);
  });
});
