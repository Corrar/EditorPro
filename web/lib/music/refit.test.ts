/* refitMusicClip (re-render da música do catálogo depois de aparar) × desfazer, aparos
   seguidos, clipe curto e velocidade. A renderização/ingestão é simulada (sem Worker). */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioClip, MediaAsset } from '../types';

/** render "travado" por duração pedida (simula o Worker demorando) */
const gate = { hold: null as Promise<void> | null, only: undefined as number | undefined };
let seq = 0;

vi.mock('./render', () => ({
  renderMusic: vi.fn(async (_id: string, o: { duration: number }) => {
    if (gate.hold && (gate.only === undefined || gate.only === o.duration)) await gate.hold;
    return new Blob([JSON.stringify({ d: Math.min(600, Math.max(2, o.duration)) })], { type: 'audio/wav' });
  }),
}));

vi.mock('../media/ingest', () => ({
  ingestFile: vi.fn(async (file: File) => {
    const { useEditor } = await import('../store');
    const { d } = JSON.parse(await file.text()) as { d: number };
    const a: MediaAsset = { id: `m${++seq}`, kind: 'audio', role: 'music', name: file.name, mime: 'audio/wav', size: 1, duration: d, url: 'blob:x' };
    useEditor.getState().addAsset(a);
    return a;
  }),
}));

import { useEditor } from '../store';
import { createProject } from '../defaults';
import { applyOps } from '../ops';
import { musicClipOps } from './ops';
import { refitMusicClip } from './insert';

const clipOf = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === 'cm') as AudioClip;

// carrega os módulos simulados antes (imports dinâmicos concorrentes no 1º uso confundem o vi.mock)
beforeAll(async () => { await import('../media/ingest'); await import('./render'); });

beforeEach(() => {
  gate.hold = null;
  gate.only = undefined;
  const p0 = createProject();
  const a: MediaAsset = { id: 'm0', kind: 'audio', role: 'music', name: 'Café da Tarde.wav', mime: 'audio/wav', size: 1, duration: 30, url: 'blob:x', library: true };
  const p = applyOps(p0, musicClipOps(p0, a, 0, { id: 'cm' })).project;
  useEditor.getState().loadProject(p);
  useEditor.setState({ assets: {} }); // sem reaproveitar assets de outro teste
  useEditor.getState().addAsset(a);
});

describe('refitMusicClip', () => {
  it('troca o asset pela versão no tamanho novo', async () => {
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 20 });
    expect(await refitMusicClip('cm', 20, { history: false })).toBe(true);
    const c = clipOf();
    expect(c.assetId).not.toBe('m0');
    expect(c.duration).toBeCloseTo(20, 3);
    expect(c.in).toBe(0);
  });

  it('desfazer enquanto a música renderiza: o refit atrasado NÃO reaplica o aparo desfeito', async () => {
    let release!: () => void;
    gate.hold = new Promise<void>((r) => { release = r; });
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 20 });
    const run = refitMusicClip('cm', 20, { history: false });
    await new Promise((r) => setTimeout(r, 0)); // o render já começou
    useEditor.getState().undo(); // usuário desfaz o aparo antes do render terminar
    release();
    await run;
    const c = clipOf();
    expect(c.duration).toBeCloseTo(30, 3);
    expect(c.assetId).toBe('m0');
  });

  it('dois aparos seguidos: o refit do 1º, terminando depois, não sobrescreve o 2º', async () => {
    let release!: () => void;
    gate.hold = new Promise<void>((r) => { release = r; });
    gate.only = 20; // só o render de 20 s demora
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 20 });
    const first = refitMusicClip('cm', 20, { history: false });
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 12 });
    await import('../media/ingest'); // deixa o 1º refit chegar ao render (travado) antes do 2º
    await refitMusicClip('cm', 12, { history: false });
    release();
    await first;
    expect(clipOf().duration).toBeCloseTo(12, 3);
  });

  it('aparado abaixo do mínimo do motor (2 s): o clipe não volta a crescer por cima do vizinho', async () => {
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 1 });
    await refitMusicClip('cm', 1, { history: false });
    expect(clipOf().duration).toBeCloseTo(1, 3);
  });

  it('clipe com velocidade 2x: a nova música cobre o clipe inteiro (não acaba na metade)', async () => {
    useEditor.getState().dispatch({ op: 'update_clip', clipId: 'cm', patch: { speed: 2, duration: 15 } });
    useEditor.getState().dispatch({ op: 'trim_clip', clipId: 'cm', end: 10 });
    await refitMusicClip('cm', 10, { history: false });
    const c = clipOf();
    const asset = useEditor.getState().assets[c.assetId];
    expect(c.duration).toBeCloseTo(10, 3);
    // a 2x o clipe de 10 s consome 20 s da fonte
    expect(asset.duration).toBeGreaterThanOrEqual(c.duration * 2 - 0.01);
  });
});
