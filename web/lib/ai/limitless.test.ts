import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { AudioClip, MediaAsset, Project, VideoClip } from '../types';
import { sanitizeOps } from './validate';
import { sanitizeKeyframeProps } from './sanitize';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const mus: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'm.mp3', mime: 'audio/mpeg', size: 1, duration: 60 };
const assets = { a1: src, m1: mus };
const base = (): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 10 } },
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 10), id: 'c2', duration: 10, in: 10 } },
] as EditOp[]).project;

const FX = 'vec4 effect(vec2 uv){ vec4 c = texture2D(uTex, uv); return vec4(c.rgb * (0.5 + 0.5*sin(uTime)), c.a); }';
const TR = 'vec4 transition(vec2 uv){ return mix(texture2D(uFrom, uv), texture2D(uTo, uv), step(uv.x, uProgress)); }';

describe('contrato "IA sem limites" no validate', () => {
  it('efeito e transição custom (GLSL) passam; sem a função de entrada ou grande demais caem', () => {
    const r = sanitizeOps([
      { op: 'update_clip', clipId: 'c2', patch: { effects: [{ kind: 'custom', code: FX, name: 'Pulso', params: [1, 2, 3, 4, 5, 6, 7, 8, 9], intensity: 0.8 }, { kind: 'custom', code: 'void main(){}' }, { kind: 'custom', code: FX + '//' + 'x'.repeat(9000) }], transitionIn: { kind: 'custom', code: TR, duration: 0.8, name: 'Cortina' } } },
    ], base(), assets);
    expect(r.dropped).toEqual([]);
    const c = r.project.tracks[0].clips.find((x) => x.id === 'c2') as VideoClip;
    expect(c.effects).toHaveLength(1);
    expect(c.effects![0]).toMatchObject({ kind: 'custom', name: 'Pulso', params: [1, 2, 3, 4, 5, 6, 7, 8], intensity: 0.8 });
    expect(c.transitionIn).toMatchObject({ kind: 'custom', name: 'Cortina', duration: 0.8 });
    expect(c.transitionIn!.code).toContain('vec4 transition(');
  });

  it('keyframes universais: só caminhos simples e valores número/cor; sem transform tudo bem', () => {
    expect(sanitizeKeyframeProps([{ path: 'style.color', value: '#FF0000' }, { path: 'volume', value: 0.4 }, { path: '__proto__.x', value: 1 }, { path: 'a.b.c.d.e', value: 1 }, { path: 'effects.0.intensity', value: 'x' }, { path: 'id', value: 3 }]))
      .toEqual({ 'style.color': '#FF0000', volume: 0.4 });
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, props: { 'filters.blur': 0 } }, { t: 3, props: { 'filters.blur': 0.8 }, easing: 'easeIn' }] } }], base(), assets);
    const c = r.project.tracks[0].clips[0] as VideoClip;
    expect(c.keyframes).toEqual([{ t: 0, transform: {}, props: { 'filters.blur': 0 } }, { t: 3, transform: {}, props: { 'filters.blur': 0.8 }, easing: 'easeIn' }]);
  });

  it('áudio aceita automação (props.volume)', () => {
    const p = applyOps(base(), [{ op: 'add_clip', trackId: 'track_audio_1', clip: { id: 'au', type: 'audio', assetId: 'm1', start: 0, duration: 20, in: 0, speed: 1, volume: 0.5 } } as EditOp]).project;
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'au', patch: { keyframes: [{ t: 0, props: { volume: 0 } }, { t: 4, props: { volume: 0.6 } }] } }], p, assets);
    const a = r.project.tracks.flatMap((t) => t.clips).find((x) => x.id === 'au') as AudioClip;
    expect(a.keyframes?.map((k) => k.props?.volume)).toEqual([0, 0.6]);
  });
});
