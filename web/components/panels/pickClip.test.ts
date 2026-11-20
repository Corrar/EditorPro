/* "Selecionar o clipe no cursor" nos painéis sem seleção (Efeitos, Ajustes, Cor, Transições). */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '@/lib/ops';
import { createProject, makeTextClip, makeVideoClip } from '@/lib/defaults';
import type { MediaAsset } from '@/lib/types';
import { clipForPanel } from './pickClip';
import { isFilterable, isVisual } from './clipkit';

const src: MediaAsset = { id: 'a', kind: 'video', role: 'source', name: 'a.mp4', mime: 'video/mp4', size: 1, duration: 30, width: 1080, height: 1920 };
const p = applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'v1', duration: 5 } },
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 5), id: 'v2', duration: 5 } },
  { op: 'add_clip', trackId: 'track_text_1', clip: { ...makeTextClip('Oi', 3, 4), id: 't1' } },
] as EditOp[]).project;
const media = (c: { type: string }) => c.type === 'video' || c.type === 'image';

describe('clipForPanel', () => {
  it('pega o clipe sob o cursor', () => {
    expect(clipForPanel(p, 2, media)).toEqual({ clip: expect.objectContaining({ id: 'v1' }), underPlayhead: true });
    expect(clipForPanel(p, 6, media)?.clip.id).toBe('v2');
  });
  it('vídeo antes de texto no mesmo instante (efeitos aceitam os dois)', () => {
    expect(clipForPanel(p, 4, (c) => isVisual(c) || c.type === 'text')?.clip.id).toBe('v1');
  });
  it('cursor no fim da timeline: o último clipe ainda conta como "no cursor"', () => {
    expect(clipForPanel(p, 10, isFilterable)).toEqual({ clip: expect.objectContaining({ id: 'v2' }), underPlayhead: true });
  });
  it('nada aceito sob o cursor: o mais perto', () => {
    expect(clipForPanel(p, 1, (c) => c.type === 'text')).toEqual({ clip: expect.objectContaining({ id: 't1' }), underPlayhead: false });
  });
  it('nenhum clipe aceito: null', () => {
    expect(clipForPanel(p, 1, (c) => c.type === 'audio')).toBeNull();
    expect(clipForPanel(createProject(), 0, media)).toBeNull();
  });
});
