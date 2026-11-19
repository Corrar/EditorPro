import { describe, expect, it } from 'vitest';
import { applyOps, clipEnd, findClip } from '../ops';
import { createProject, makeAudioClip, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import {
  expandLinks, linkOps, linkedEdgePartners, rippleRange, rippleTrimOps, rollOps, rollPair, rollRange,
  slideOps, slideRange, slipOps, slipRange, splitAllOps, unlinkOps,
} from './trim';

const A: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a.mp4', mime: 'video/mp4', size: 1, duration: 30 };
const M: MediaAsset = { id: 'm', kind: 'audio', role: 'music', name: 'm.mp3', mime: 'audio/mpeg', size: 1, duration: 60 };
const assets = { a: A, m: M };

/** v1: [0,4) in=2 · v2: [4,8) in=10 · v3: [10,12) in=0 */
function proj(): Project {
  let p = createProject();
  const v = (id: string, start: number, dur: number, inn: number) => ({ ...makeVideoClip(A, start), id, duration: dur, in: inn });
  p = applyOps(p, [
    { op: 'add_clip', trackId: 'track_video_1', clip: v('v1', 0, 4, 2) },
    { op: 'add_clip', trackId: 'track_video_1', clip: v('v2', 4, 4, 10) },
    { op: 'add_clip', trackId: 'track_video_1', clip: v('v3', 10, 2, 0) },
  ]).project;
  return p;
}
const clip = (p: Project, id: string) => findClip(p, id)!.clip as { start: number; duration: number; in: number };
const track = (p: Project) => p.tracks.find((t) => t.id === 'track_video_1')!;

describe('ripple trim', () => {
  it('ponta final empurra os seguintes', () => {
    const p = proj();
    const r = applyOps(p, rippleTrimOps(p, 'v1', 'end', 5)).project;
    expect(clip(r, 'v1').duration).toBeCloseTo(5);
    expect(clip(r, 'v2').start).toBeCloseTo(5);
    expect(clip(r, 'v3').start).toBeCloseTo(11);
  });
  it('ponta inicial muda o in, mantém o clipe no lugar e puxa os seguintes', () => {
    const p = proj();
    const r = applyOps(p, rippleTrimOps(p, 'v2', 'start', 5)).project;
    expect(clip(r, 'v2').start).toBeCloseTo(4);
    expect(clip(r, 'v2').in).toBeCloseTo(11);
    expect(clip(r, 'v2').duration).toBeCloseTo(3);
    expect(clip(r, 'v3').start).toBeCloseTo(9);
    expect(clip(r, 'v1').start).toBe(0);
  });
  it('faixa respeita a mídia e a duração mínima', () => {
    const p = proj();
    const r = rippleRange(findClip(p, 'v1')!.clip, 'start', A);
    expect(r.min).toBeCloseTo(-2); // dá para revelar 2s antes
    expect(r.max).toBeCloseTo(3.9);
    expect(rippleRange(findClip(p, 'v2')!.clip, 'end', A).max).toBeCloseTo(4 + 20); // 30-10
  });
});

describe('roll', () => {
  it('move o corte entre dois clipes encostados sem mudar a duração total', () => {
    const p = proj();
    const pair = rollPair(track(p), findClip(p, 'v1')!.clip, 'end')!;
    expect(pair.right.id).toBe('v2');
    const r = applyOps(p, rollOps(pair.left, pair.right, 3)).project;
    expect(clipEnd(findClip(r, 'v1')!.clip)).toBeCloseTo(3);
    expect(clip(r, 'v2').start).toBeCloseTo(3);
    expect(clip(r, 'v2').in).toBeCloseTo(9);
    expect(clipEnd(findClip(r, 'v2')!.clip)).toBeCloseTo(8);
    const r2 = applyOps(p, rollOps(pair.left, pair.right, 6)).project;
    expect(clipEnd(findClip(r2, 'v1')!.clip)).toBeCloseTo(6);
    expect(clip(r2, 'v2').duration).toBeCloseTo(2);
  });
  it('sem vizinho encostado não há roll; faixa limitada por mídia e mínimo', () => {
    const p = proj();
    expect(rollPair(track(p), findClip(p, 'v2')!.clip, 'end')).toBeNull();
    const rr = rollRange(findClip(p, 'v1')!.clip, findClip(p, 'v2')!.clip, assets);
    expect(rr.min).toBeCloseTo(0.1);
    expect(rr.max).toBeCloseTo(7.9);
  });
});

describe('slip e slide', () => {
  it('slip muda só o in, limitado pela mídia', () => {
    const p = proj();
    const c = findClip(p, 'v2')!.clip;
    expect(slipRange(c, A)).toEqual({ min: 0, max: 26 });
    const r = applyOps(p, slipOps(c, 40, A)).project;
    expect(clip(r, 'v2').in).toBeCloseTo(26);
    expect(clip(r, 'v2').start).toBe(4);
  });
  it('slide move o clipe e ajusta o vizinho encostado; espaço vazio limita', () => {
    const p = proj();
    const c = findClip(p, 'v2')!.clip;
    const rg = slideRange(track(p), c, assets);
    expect(rg.min).toBeCloseTo(0.1);
    expect(rg.max).toBeCloseTo(6); // até encostar no v3 (10 - 4)
    const r = applyOps(p, slideOps(track(p), c, 5)).project;
    expect(clip(r, 'v2').start).toBeCloseTo(5);
    expect(clipEnd(findClip(r, 'v1')!.clip)).toBeCloseTo(5);
    const r2 = applyOps(p, slideOps(track(p), c, 3)).project;
    expect(clipEnd(findClip(r2, 'v1')!.clip)).toBeCloseTo(3);
  });
});

describe('cortar em todas as trilhas e vínculo', () => {
  it('splitAll corta tudo que cruza o cursor, menos trilha travada', () => {
    let p = proj();
    p = applyOps(p, [{ op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(M, 0), id: 'au', duration: 12 } }]).project;
    let n = 0;
    expect(splitAllOps(p, 2, () => `n${n++}`).map((o) => (o as { clipId: string }).clipId).sort()).toEqual(['au', 'v1']);
    p = applyOps(p, [{ op: 'update_track', trackId: 'track_audio_1', patch: { locked: true } }]).project;
    expect(splitAllOps(p, 2, () => 'x')).toHaveLength(1);
  });
  it('vincular expande seleção e acha a ponta parceira; desvincular remove', () => {
    let p = proj();
    p = applyOps(p, [{ op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(M, 0), id: 'au', duration: 4 } }]).project;
    p = applyOps(p, linkOps(p, ['v1', 'au'], 'L')).project;
    expect(expandLinks(p, ['v1']).sort()).toEqual(['au', 'v1']);
    expect(linkedEdgePartners(p, 'v1', 'end').map((c) => c.id)).toEqual(['au']);
    p = applyOps(p, unlinkOps(p, ['au'])).project;
    expect(expandLinks(p, ['v1'])).toEqual(['v1']);
  });
});

describe('sessão de trim (UI)', () => {
  it('ripple com vínculo apara o áudio junto; Alt (J/L-cut) só o vídeo', async () => {
    const { proSession, overridesAfter, monitorFrames } = await import('./trim');
    let p = proj();
    p = applyOps(p, [{ op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(M, 0), id: 'au', duration: 4 } }]).project;
    p = applyOps(p, linkOps(p, ['v1', 'au'], 'L')).project;
    const s = proSession(p, assets, 'ripple', 'v1', 'end', false)!;
    const after = applyOps(p, s.build(1)).project;
    expect(clip(after, 'au').duration).toBeCloseTo(5);
    expect(clip(after, 'v2').start).toBeCloseTo(5);
    expect(overridesAfter(after, s.touched).v2.start).toBeCloseTo(5);
    const [a, b] = monitorFrames(after, s);
    expect(a?.clipId).toBe('v1');
    expect(b?.clipId).toBe('v2');
    const sAlt = proSession(p, assets, 'ripple', 'v1', 'end', true)!;
    expect(clip(applyOps(p, sAlt.build(1)).project, 'au').duration).toBeCloseTo(4);
  });
  it('faixa do slip é a interseção dos clipes vinculados', async () => {
    const { proSession } = await import('./trim');
    const p = proj();
    const s = proSession(p, assets, 'slip', 'v2', undefined, false)!;
    expect(s.range.min).toBeCloseTo(-16); // in pode ir até 26
    expect(s.range.max).toBeCloseTo(10); // ... e até 0
    expect(proSession(p, assets, 'roll', 'v2', 'end', false)).toBeNull();
  });
});
