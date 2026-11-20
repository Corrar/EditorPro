/* QA r3: pedidos do chat como uma pessoa digita (modo demo). */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import { chatIntent } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 10, width: 1080, height: 1920 };
const assets = { a1: src };
const withCaps = (enabled = true): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 10 } },
  { op: 'set_captions', segments: [{ id: 's1', start: 0, end: 2, text: 'Hoje eu vou mostrar' }, { id: 's2', start: 2, end: 4, text: 'como fazer' }] },
  { op: 'toggle_captions', enabled },
] as EditOp[]).project;

describe('"coloque legenda" com legendas já no vídeo', () => {
  it('responde que já estão no vídeo (antes: "Não entendi esse pedido")', () => {
    for (const txt of ['coloque legenda', 'coloca legenda', 'põe legenda']) {
      const r = chatIntent(txt, { project: withCaps(), assets });
      expect(r.ops).toEqual([]);
      expect(r.reply).not.toMatch(/Não entendi/);
      expect(r.reply).toMatch(/já estão no vídeo/);
    }
  });
  it('legendas escondidas: continua ligando', () => {
    const r = chatIntent('coloque legenda', { project: withCaps(false), assets });
    expect(r.ops.some((o) => o.op === 'toggle_captions')).toBe(true);
  });
  it('"coloca legenda amarela" continua mudando a cor', () => {
    const r = chatIntent('coloca legenda amarela', { project: withCaps(), assets });
    expect(r.ops.some((o) => o.op === 'set_caption_style')).toBe(true);
  });
});
