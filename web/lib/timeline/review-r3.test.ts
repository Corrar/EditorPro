/* Regressões da revisão r3 (timeline): vínculo A/V × trilha magnética. */
import { describe, expect, it } from 'vitest';
import { applyOps, findClip, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { Clip, MediaAsset, Project } from '../types';
import { useTimelineUi } from './ui';
import { withMagnet } from './actions';
import { deleteOps, detachAudioOps, trimBounds } from './edit';
import { makeAudioClip } from '../defaults';

const A: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a.mp4', mime: 'video/mp4', size: 1, duration: 60 };
const V = 'track_video_1';
const clip = (p: Project, id: string) => findClip(p, id)!.clip as Clip & { in: number };
const run = (p: Project, ops: EditOp[]) => {
  const r = applyOps(p, ops);
  expect(r.errors).toEqual([]);
  return r.project;
};
const commit = (p: Project, ops: EditOp[]) => run(p, withMagnet(p, ops));

/** tempo de origem que o clipe toca no instante t da timeline (velocidade 1) */
const srcAt = (c: Clip & { in: number }, t: number) => c.in + (t - c.start);

describe('r3 — ímã com áudio vinculado em J-cut (áudio começa antes do vídeo)', () => {
  it('fechar o buraco antes do vídeo não deixa o áudio fora de sincronia', () => {
    useTimelineUi.getState().set({ magnetic: true });
    let p = createProject();
    p = run(p, [
      { op: 'add_clip', trackId: V, clip: { ...makeVideoClip(A, 0), id: 'v1', duration: 4, in: 0 } },
      { op: 'add_clip', trackId: V, clip: { ...makeVideoClip(A, 4), id: 'v2', duration: 6, in: 5 } },
    ]);
    const det = detachAudioOps(p, 'v2');
    p = run(p, det);
    const audioId = (det[0] as { clip: Clip }).clip.id;
    // J-cut: o som de v2 entra 1 s antes do corte (Alt + aparar só o áudio)
    p = run(p, [{ op: 'trim_clip', clipId: audioId, start: 3 }]);
    expect(srcAt(clip(p, audioId), 4)).toBeCloseTo(clip(p, 'v2').in, 5);

    const r = commit(p, deleteOps(p, ['v1']));
    const v = clip(r, 'v2');
    const a = clip(r, audioId);
    expect(v.start).toBeCloseTo(0, 5);
    // no início do vídeo, o áudio toca o mesmo ponto da fonte que o vídeo
    expect(srcAt(a, v.start)).toBeCloseTo(v.in, 5);
    expect(a.start).toBeGreaterThanOrEqual(0);
  });
});

describe('r3 — música do catálogo pode ser esticada (é re-renderizada no tamanho novo ao soltar)', () => {
  const music: MediaAsset = { id: 'm', kind: 'audio', role: 'music', name: 'Café da Tarde.wav', mime: 'audio/wav', size: 1, duration: 12, url: 'blob:x', library: true };
  it('a borda direita passa do fim do WAV gerado (antes: travava no tamanho do último refit)', () => {
    const c = makeAudioClip(music, 5, { id: 'cm' });
    const b = trimBounds(c, undefined, music);
    expect(b.maxEnd).toBeGreaterThan(5 + 12 + 30);
    expect(b.maxEnd).toBeLessThanOrEqual(5 + 600);
    expect(b.minStart).toBe(0); // e para a esquerda também
  });
  it('áudio importado (ou SFX da biblioteca) continua limitado à mídia', () => {
    const c = makeAudioClip({ ...music, library: false }, 5, { id: 'cm' });
    expect(trimBounds(c, undefined, { ...music, library: false }).maxEnd).toBeCloseTo(17, 6);
    const sfx = { ...music, name: 'Whoosh.wav' };
    expect(trimBounds(makeAudioClip(sfx, 5), undefined, sfx).maxEnd).toBeCloseTo(17, 6);
  });
});
