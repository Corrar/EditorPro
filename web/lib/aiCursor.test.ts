import { describe, expect, it } from 'vitest';
import { aiTargetFor } from './aiCursor';
import { applyOp } from './ops';
import { createProject, makeTextClip, makeVideoClip } from './defaults';
import type { MediaAsset } from './types';

const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'v.mp4', mime: 'video/mp4', size: 1, duration: 10 };

describe('aiTargetFor', () => {
  const base = applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'v1' } });

  it('corte vai para o tempo na timeline com a ferramenta Editar', () => {
    expect(aiTargetFor(base, { op: 'ripple_delete', start: 2, end: 3 })).toEqual({ kind: 'time', t: 2, tool: 'edit' });
    expect(aiTargetFor(base, { op: 'split_clip', clipId: 'v1', at: 4 })).toEqual({ kind: 'time', t: 4, tool: 'edit' });
  });

  it('texto novo aponta para a posição dele no vídeo', () => {
    const t = aiTargetFor(base, { op: 'add_clip', trackId: 'tx', clip: { ...makeTextClip('Oi', 1), position: { x: 0.5, y: 0.3 } } });
    expect(t).toEqual({ kind: 'preview', x: 0.5, y: 0.3, tool: 'text' });
  });

  it('filtro num clipe aponta para o vídeo com a ferramenta Filtros', () => {
    const t = aiTargetFor(base, { op: 'update_clip', clipId: 'v1', patch: { colorPreset: 'cinematic' } });
    expect(t?.kind).toBe('preview');
    expect(t && 'tool' in t ? t.tool : undefined).toBe('filters');
  });

  it('volume aponta para o clipe na timeline com Áudio', () => {
    expect(aiTargetFor(base, { op: 'update_clip', clipId: 'v1', patch: { volume: 0.5 } })).toEqual({ kind: 'clip', clipId: 'v1', tool: 'audio' });
  });

  it('estilo de legenda aponta para a legenda no vídeo', () => {
    const t = aiTargetFor(base, { op: 'set_caption_style', style: { fontSize: 90 } });
    expect(t).toMatchObject({ kind: 'preview', tool: 'captions' });
  });

  it('op desconhecida/sem alvo devolve null', () => {
    expect(aiTargetFor(base, { op: 'set_project', patch: { name: 'x' } })).toBeNull();
    expect(aiTargetFor(base, { op: 'update_clip', clipId: 'nao', patch: {} })).toBeNull();
  });
});
