/* Revisão r3 — vídeo-modelo definitivo e movimento suave: um teste por bug confirmado */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { Keyframe, MediaAsset, Project } from '../types';
import { edgePxPerFrame } from './motion';
import { smoothMotionOps } from './template';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 15 };
const base = (dur = 15): Project => applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip({ ...src, duration: dur }, 0), id: 'c1' } }]).project;
const kfOf = (ops: EditOp[]) => (ops[0] as Extract<EditOp, { op: 'update_clip' }>).patch.keyframes as Keyframe[];

describe('smoothMotionOps: rampa que não dá para esticar não fica brusca (≤8 px/quadro)', () => {
  it('zoom com x no mesmo keyframe (antes: 56 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1, x: 0 } }, { t: 0.3, transform: { scale: 1.25, x: 0.05 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
    expect(kf[1].transform.scale).toBeGreaterThan(1.2); // esticou no tempo, não cortou o zoom à toa
  });
  it('clipe curto: o fim do clipe impede de esticar → encurta o zoom (antes: 15 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.3, transform: { scale: 1.3 } }] } }];
    const kf = kfOf(smoothMotionOps(base(1), ops));
    expect(edgePxPerFrame(kf, 1)).toBeLessThanOrEqual(8);
    expect(kf[1].transform.scale).toBeGreaterThan(1.05);
    expect(kf.every((k) => k.t >= 0 && k.t <= 1)).toBe(true);
  });
  it('vai e volta: o próximo keyframe impede de esticar (antes: 27 px/quadro)', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.3, transform: { scale: 1.3 } }, { t: 0.6, transform: { scale: 1 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
  });
  it('keyframe com props (efeito) mantém o tempo e encurta a variação', () => {
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.5, transform: { scale: 1.2 }, props: { 'effects.0.intensity': 1 } }] } }];
    const kf = kfOf(smoothMotionOps(base(10), ops));
    expect(kf[1].t).toBe(0.5);
    expect(edgePxPerFrame(kf, 10)).toBeLessThanOrEqual(8);
  });
});
