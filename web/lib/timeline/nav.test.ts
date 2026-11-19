import { describe, expect, it } from 'vitest';
import { applyOps, findClip } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import { clipRangeAt, editPointNear, editPoints, nudgeOps, shuttleNext } from './nav';

const A: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a.mp4', mime: 'video/mp4', size: 1, duration: 30 };
function proj(): Project {
  const v = (id: string, start: number, dur: number) => ({ ...makeVideoClip(A, start), id, duration: dur });
  return applyOps(createProject(), [
    { op: 'add_clip', trackId: 'track_video_1', clip: v('v1', 0, 4) },
    { op: 'add_clip', trackId: 'track_video_1', clip: v('v2', 5, 3) },
  ]).project;
}

describe('navegação', () => {
  it('pontos de edição e ↑/↓', () => {
    const p = proj();
    expect(editPoints(p)).toEqual([0, 4, 5, 8]);
    expect(editPointNear(p, 4, 1)).toBe(5);
    expect(editPointNear(p, 4.5, -1)).toBe(4);
    expect(editPointNear(p, 8, 1)).toBeNull();
  });
  it('shuttle J/K/L', () => {
    expect(shuttleNext(0, 'l')).toBe(1);
    expect(shuttleNext(1, 'l')).toBe(2);
    expect(shuttleNext(8, 'l')).toBe(8);
    expect(shuttleNext(2, 'j')).toBe(-1);
    expect(shuttleNext(-1, 'j')).toBe(-2);
    expect(shuttleNext(-4, 'k')).toBe(0);
  });
  it('empurrar quadro a quadro para no vizinho e no zero', () => {
    const p = proj();
    const r = applyOps(p, nudgeOps(p, ['v1'], 60)).project; // 2s, mas só cabe 1s
    expect(findClip(r, 'v1')!.clip.start).toBeCloseTo(1);
    expect(nudgeOps(p, ['v1'], -5)).toEqual([]);
    const r2 = applyOps(p, nudgeOps(p, ['v2'], -3)).project;
    expect(findClip(r2, 'v2')!.clip.start).toBeCloseTo(4.9);
  });
  it('trecho do clipe (X)', () => {
    const p = proj();
    expect(clipRangeAt(p, 6, [])).toEqual({ start: 5, end: 8 });
    expect(clipRangeAt(p, 6, ['v1'])).toEqual({ start: 0, end: 4 });
    expect(clipRangeAt(p, 4.5, [])).toBeNull();
  });
});
