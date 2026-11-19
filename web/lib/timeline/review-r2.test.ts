/* Regressões da revisão de código r2 (docs/revisao/2026-11-19-r2/timeline.md), bugs de lógica pura. */
import { describe, expect, it } from 'vitest';
import { applyOps, clipEnd, findClip, type EditOp } from '../ops';
import { createProject, makeShapeClip, makeStickerClip, makeTextClip, makeVideoClip } from '../defaults';
import type { Clip, MediaAsset, Project } from '../types';
import { useTimelineUi } from './ui';
import { withMagnet } from './actions';
import { copyItems, deleteOps, detachAudioOps, duplicateWithGroups, expandGroups, pasteOps, splitOps } from './edit';
import { expandLinks, rippleTrimOps, splitAllOps } from './trim';

const A: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a.mp4', mime: 'video/mp4', size: 1, duration: 60 };
const V = 'track_video_1';
const clip = (p: Project, id: string) => findClip(p, id)!.clip as Clip & { in?: number };
const run = (p: Project, ops: EditOp[]) => applyOps(p, ops).project;
/** como o commit da UI: ops + magnetismo (+ religar cortes e sincronizar vínculos) */
const commit = (p: Project, ops: EditOp[]) => run(p, withMagnet(p, ops));

/** V1 (0–4) e V2 (4–10) na principal; áudio separado de V2 (vinculado) */
function linkedProject(): { p: Project; audioId: string } {
  let p = createProject();
  p = run(p, [
    { op: 'add_clip', trackId: V, clip: { ...makeVideoClip(A, 0), id: 'v1', duration: 4, in: 0 } },
    { op: 'add_clip', trackId: V, clip: { ...makeVideoClip(A, 4), id: 'v2', duration: 6, in: 5 } },
  ]);
  const det = detachAudioOps(p, 'v2');
  p = run(p, det);
  const audioId = (det[0] as { clip: Clip }).clip.id;
  return { p, audioId };
}

describe('r2 #1 — trilha magnética mantém o áudio vinculado em sincronia', () => {
  useTimelineUi.getState().set({ magnetic: true });
  const inSync = (p: Project, audioId: string) => {
    const v = clip(p, 'v2');
    const a = clip(p, audioId);
    expect(a.start).toBeCloseTo(v.start, 5);
    expect(a.in).toBeCloseTo(v.in!, 5);
  };
  it('excluir o clipe anterior', () => {
    const { p, audioId } = linkedProject();
    const r = commit(p, deleteOps(p, ['v1']));
    expect(clip(r, 'v2').start).toBeCloseTo(0);
    inSync(r, audioId);
  });
  it('aparar o início do vídeo vinculado (junto com o parceiro)', () => {
    const { p, audioId } = linkedProject();
    const r = commit(p, [
      { op: 'trim_clip', clipId: 'v2', start: 5 },
      { op: 'trim_clip', clipId: audioId, start: 5 },
    ]);
    expect(clip(r, 'v2').start).toBeCloseTo(4); // o ímã fecha o buraco
    inSync(r, audioId);
  });
  it('arrastar o par vinculado: o ímã devolve o vídeo e o áudio volta junto', () => {
    const { p, audioId } = linkedProject();
    const r = commit(p, [
      { op: 'move_clip', clipId: 'v2', start: 6 },
      { op: 'move_clip', clipId: audioId, start: 6 },
    ]);
    expect(clip(r, 'v2').start).toBeCloseTo(4);
    inSync(r, audioId);
  });
});

describe('r2 #2 — cortar clipe vinculado religa cada pedaço só ao seu par', () => {
  it('dividir em 2 pontos e excluir o meio não apaga o resto', () => {
    const { p, audioId } = linkedProject();
    const sel = expandLinks(p, ['v2']);
    let r = commit(p, splitOps(p, sel, 6));
    const sel2 = expandLinks(r, ['v2']);
    expect(sel2.sort()).toEqual([audioId, 'v2'].sort()); // a metade esquerda segue com o par original
    r = commit(r, splitOps(r, sel2.concat(expandLinks(r, [findMid(r, 7)])), 8));
    const mid = findMid(r, 7);
    const midSel = expandLinks(r, [mid]);
    expect(midSel).toHaveLength(2); // só o vídeo + áudio do trecho do meio
    const after = commit(r, deleteOps(r, midSel));
    const left = after.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video' || c.type === 'audio');
    expect(left.length).toBe(5); // v1 + 2 pedaços de vídeo + 2 de áudio
  });
  it('splitAll e lâmina usam o mesmo religar (via commit)', () => {
    const { p } = linkedProject();
    let n = 0;
    const r = commit(p, splitAllOps(p, 7, () => `n${n++}`));
    const right = findMid(r, 8);
    expect(expandLinks(r, [right])).toHaveLength(2);
    expect(expandLinks(r, ['v2'])).toHaveLength(2);
  });
});

/** vídeo da principal que cobre t */
function findMid(p: Project, t: number): string {
  return p.tracks.find((x) => x.id === V)!.clips.find((c) => c.start <= t && clipEnd(c) > t)!.id;
}

describe('r2 #3 — duplicar/colar não herdam vínculo/grupo do original', () => {
  it('Ctrl+D num par vinculado: o original continua só com o seu par', () => {
    const { p, audioId } = linkedProject();
    const d = duplicateWithGroups(p, [audioId, 'v2']);
    const r = run(p, d.ops);
    expect(expandLinks(r, ['v2']).sort()).toEqual([audioId, 'v2'].sort());
    expect(expandLinks(r, [d.newIds[0]]).sort()).toEqual([...d.newIds].sort()); // cópias vinculadas entre si
  });
  it('duplicar só um membro vinculado (Alt) gera cópia sem vínculo', () => {
    const { p } = linkedProject();
    const d = duplicateWithGroups(p, ['v2']);
    const r = run(p, d.ops);
    expect(clip(r, d.newIds[0]).linkId).toBeFalsy();
  });
  it('colar um modelo inteiro cria grupo novo; membro avulso colado fica sem grupo', () => {
    let p = createProject();
    p = run(p, [
      { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('A', 0, 2), id: 't1', groupId: 'g' } },
      { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('B', 2, 2), id: 't2', groupId: 'g' } },
    ]);
    const all = pasteOps(p, copyItems(p, ['t1', 't2']), 10);
    const r = run(p, all.ops);
    expect(expandGroups(r, ['t1']).sort()).toEqual(['t1', 't2']);
    expect(expandGroups(r, [all.newIds[0]]).sort()).toEqual([...all.newIds].sort());
    const one = pasteOps(r, copyItems(r, ['t1']), 20);
    expect((one.ops[0] as { clip: Clip }).clip.groupId).toBeUndefined();
  });
});

describe('r2 #4 — duplicar um modelo não cai em cima de clipes existentes', () => {
  it('sticker logo após o modelo na mesma trilha', () => {
    let p = createProject();
    p = run(p, [{ op: 'add_track', track: { id: 'ov', kind: 'overlay', name: 'Stickers' } }]);
    p = run(p, [
      { op: 'add_clip', trackId: 'ov', clip: { ...makeShapeClip('rect', 8, 3.4), id: 'sh', groupId: 'lt' } },
      { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Nome', 8.2, 3), id: 'tx', groupId: 'lt' } },
      { op: 'add_clip', trackId: 'ov', clip: { ...makeStickerClip(12, { emoji: '🔥' }, 2.5), id: 'st' } },
    ]);
    const d = duplicateWithGroups(p, ['sh', 'tx']);
    const r = run(p, d.ops);
    for (const tr of r.tracks) {
      const cs = [...tr.clips].sort((a, b) => a.start - b.start);
      for (let i = 1; i < cs.length; i++) expect(cs[i].start).toBeGreaterThanOrEqual(clipEnd(cs[i - 1]) - 1e-6);
    }
  });
});

describe('r2 #12 — ripple na ponta inicial de texto estende mesmo antes de 0', () => {
  it('texto em 0 s com vizinho em 2 s', () => {
    let p = createProject();
    p = run(p, [
      { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('A', 0, 2), id: 't1' } },
      { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('B', 2, 2), id: 't2' } },
    ]);
    const r = run(p, rippleTrimOps(p, 't1', 'start', -1.5));
    expect(clip(r, 't1').start).toBeCloseTo(0);
    expect(clip(r, 't1').duration).toBeCloseTo(3.5);
    expect(clip(r, 't2').start).toBeCloseTo(3.5);
  });
});
