/* r3: ajustar a música do catálogo pelo chat ("quero a música mais baixa") NÃO pode trocar a faixa */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), getStatus: async () => ({ configured: false, provider: 'demo', transcribe: null }) }));
vi.mock('./catalogMusic', async (orig) => ({ ...(await orig<typeof import('./catalogMusic')>()), catalogMusicOps: h.catalog }));

import { useEditor } from '../store';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeAudioClip, makeVideoClip } from '../defaults';
import type { AudioClip, MediaAsset, Project } from '../types';
import { chatEdit, type PipelineOptions } from './pipeline';
import { chatMusicRequest } from './catalogMusic';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 20, url: 'blob:fala' };
const lib: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'Sol de Verão.wav', mime: 'audio/wav', size: 1, duration: 20, url: 'blob:m1', library: true };
const nova: MediaAsset = { id: 'm2', kind: 'audio', role: 'music', name: 'Outra.wav', mime: 'audio/wav', size: 1, duration: 20, url: 'blob:m2', library: true };
const base = (): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0, { duration: 20 }), id: 'c1' } },
  { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(lib, 0, { duration: 20, volume: 0.5 }), id: 'mus' } },
] as EditOp[]).project;
const opts = (): PipelineOptions => ({ apply: async (ops) => { useEditor.getState().dispatch(ops); return ops.map((o) => o.id ?? ''); } });
const musicClips = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).filter((c): c is AudioClip => c.type === 'audio');

beforeEach(() => {
  useEditor.setState({ project: base(), past: [], future: [], assets: { a1: src, m1: lib }, messages: [], live: { running: false, done: 0, total: 0 } });
  h.catalog.mockReset();
  h.catalog.mockImplementation(async (_t: string, p: Project) => {
    useEditor.getState().addAsset(nova);
    return { name: 'Outra', id: 'outra', ops: [{ op: 'add_clip', trackId: p.tracks.find((t) => t.kind === 'audio')!.id, clip: { ...makeAudioClip(nova, 0, { duration: 20 }), id: 'mus2' }, explain: 'Música do catálogo' }] };
  });
});

describe('música do catálogo: ajuste x troca', () => {
  for (const pedido of ['quero a música mais baixa', 'coloca a música mais alta', 'muda o volume da música para 20%', 'usa a música só no começo']) {
    it(`"${pedido}" não troca a faixa`, async () => {
      await chatEdit(pedido, opts());
      expect(h.catalog).not.toHaveBeenCalled();
      expect(musicClips().map((c) => c.assetId)).toEqual(['m1']);
    });
  }

  it('o volume muda de verdade (modo demo) em vez de trocar', async () => {
    await chatEdit('quero a música mais baixa', opts());
    expect(musicClips()[0].volume).toBeLessThan(0.5);
  });

  it('pedidos de troca continuam trocando', async () => {
    for (const t of ['troca a música', 'muda a música', 'coloca outra música mais animada']) expect(chatMusicRequest(t, true), t).toBe('swap');
    await chatEdit('troca a música por uma mais calma', opts());
    expect(h.catalog).toHaveBeenCalledTimes(1);
    expect(musicClips().map((c) => c.assetId)).toEqual(['m2']);
  });

  it('sem música na timeline, "coloca uma música mais animada" põe a faixa', async () => {
    useEditor.setState({ project: applyOps(base(), [{ op: 'remove_clip', clipId: 'mus' }] as EditOp[]).project });
    await chatEdit('coloca uma música mais animada', opts());
    expect(h.catalog).toHaveBeenCalledTimes(1);
  });
});
