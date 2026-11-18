import { describe, expect, it } from 'vitest';
import { createProject } from '../defaults';
import { applyOps } from '../ops';
import type { MediaAsset } from '../types';
import { placeAssetOp, projectNameFromBrief, sequenceOps } from './place';

const mk = (id: string, kind: MediaAsset['kind'], duration: number, role: MediaAsset['role'] = 'source'): MediaAsset => ({
  id, kind, role, name: `${id}`, mime: '', size: 1, duration,
});

describe('sequenceOps', () => {
  it('coloca vídeos e imagens em sequência e áudio na trilha de áudio; ignora o exemplo', () => {
    const p = createProject();
    const ops = sequenceOps(p, [mk('v1', 'video', 4), mk('ref', 'video', 9, 'reference'), mk('i1', 'image', 0), mk('v2', 'video', 2.5), mk('m', 'audio', 30, 'music')]);
    expect(ops).toHaveLength(4);
    const { project, errors } = applyOps(p, ops);
    expect(errors).toEqual([]);
    const video = project.tracks.find((t) => t.id === 'track_video_1')!;
    expect(video.clips.map((c) => [c.start, c.duration])).toEqual([[0, 4], [4, 3], [7, 2.5]]);
    expect(video.clips.map((c) => c.type)).toEqual(['video', 'image', 'video']);
    const audio = project.tracks.find((t) => t.id === 'track_audio_1')!;
    expect(audio.clips[0]).toMatchObject({ type: 'audio', start: 0, duration: 30 });
  });

  it('continua do fim do que já existe', () => {
    const p0 = createProject();
    const p = applyOps(p0, sequenceOps(p0, [mk('a', 'video', 5)])).project;
    const op = placeAssetOp(p, mk('b', 'video', 2));
    expect(op.op === 'add_clip' && op.clip.start).toBe(5);
  });

  it('cria trilha quando não há uma do tipo', () => {
    const p = { ...createProject(), tracks: [] };
    const { project } = applyOps(p, [placeAssetOp(p, mk('m', 'audio', 3))]);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0].kind).toBe('audio');
  });
});

describe('projectNameFromBrief', () => {
  it('gera nome curto', () => {
    expect(projectNameFromBrief('quero um reels dinâmico da minha padaria com legendas. Bem rápido!')).toBe('Reels dinâmico da minha padaria com');
    expect(projectNameFromBrief('   ')).toBe('Projeto sem título');
  });
});

import { freezeFrameOps } from './place';
describe('freezeFrameOps', () => {
  it('divide, insere a imagem e empurra o resto', () => {
    const p0 = createProject();
    const p = applyOps(p0, sequenceOps(p0, [mk('a', 'video', 4), mk('b', 'video', 3)])).project;
    const a = p.tracks[0].clips[0];
    const { project, errors } = applyOps(p, freezeFrameOps(p, a.id, 2, mk('f', 'image', 0), 1.5));
    expect(errors).toEqual([]);
    const v = project.tracks[0].clips.map((c) => [c.type, c.start, c.duration]);
    expect(v).toEqual([['video', 0, 2], ['image', 2, 1.5], ['video', 3.5, 2], ['video', 5.5, 3]]);
  });
  it('fora do clipe não faz nada', () => {
    const p0 = createProject();
    const p = applyOps(p0, sequenceOps(p0, [mk('a', 'video', 4)])).project;
    expect(freezeFrameOps(p, p.tracks[0].clips[0].id, 0, mk('f', 'image', 0))).toEqual([]);
  });
});
