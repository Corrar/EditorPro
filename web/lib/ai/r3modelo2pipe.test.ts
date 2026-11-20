/* Revisão r3 (2ª rodada) — conferência de fidelidade no pipeline */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ color: { r: 0.6, g: 0.47, b: 0.35 }, calls: 0, status: { configured: false, provider: 'demo', transcribe: null } as Record<string, unknown>, edit: vi.fn() }));
vi.mock('./fidelity', async (orig) => ({ ...(await orig<typeof import('./fidelity')>()), renderedColor: async () => { h.calls++; return h.color; } }));
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), getStatus: async () => h.status, requestEdit: h.edit }));
vi.mock('./review', async (orig) => ({ ...(await orig<typeof import('./review')>()), reviewEnabled: () => false }));
vi.mock('./analysis', async (orig) => ({
  ...(await orig<typeof import('./analysis')>()),
  // modelo quente e escuro × material neutro: o casamento gera um colorGrade
  colorStatsOf: async (a: { id: string }) => (a.id === 'ref' ? { r: 0.6, g: 0.45, b: 0.3, sat: 0.5, lum: 0.4, lumSd: 0.2 } : { r: 0.5, g: 0.5, b: 0.5, sat: 0.2, lum: 0.5, lumSd: 0.2 }),
}));

import { useEditor } from '../store';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project, ReferenceTemplate } from '../types';
import { applyModelStyle, checkFidelity } from './pipeline';
import { styleFromCuts } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 12 };
const color = { r: 0.6, g: 0.47, b: 0.35, sat: 0.684, lum: 0.5, lumSd: 0.2 };
// modelo de câmera parada, 10 tomadas de 1,2 s
const tpl: ReferenceTemplate = {
  shots: Array.from({ length: 10 }, (_, i) => ({ start: +(i * 1.2).toFixed(1), end: +((i + 1) * 1.2).toFixed(1) })),
  shotStats: { median: 1.2, p10: 1.2, p90: 1.2 },
  motion: { mode: 'static', avgZoomPerShot: 1, easing: 'easeInOut', direction: 'in', punchFrequency: 0, perShot: [] },
  transitions: [{ kind: 'cut', duration: 0, frequency: 1 }], color,
};
const style = styleFromCuts(tpl.shots.slice(1).map((s) => s.start), 12, { width: 1080, height: 1920 }, color, tpl);

describe('fidelidade depois do conserto', () => {
  it('conserto do movimento não derruba a nota da cor para o palpite (antes: "cor 50%" com a cor medida igual à do modelo)', async () => {
    // 10 tomadas de 1,2 s, todas com zoom (o modelo é parado → movimento reprova e o conserto roda)
    const ops: EditOp[] = Array.from({ length: 10 }, (_, i) => ({ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, i * 1.2, { duration: 1.2 }), in: i * 1.2, id: `c${i}`, keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 1.2, transform: { scale: 1.1 }, easing: 'easeInOut' }] } }) as EditOp);
    const p: Project = applyOps({ ...createProject(), style }, ops).project;
    useEditor.setState({ project: p, past: [], future: [], assets: { a1: src }, messages: [], live: { running: false, done: 0, total: 0 } });
    const logs: string[] = [];
    const line = await checkFidelity(async (o) => { useEditor.getState().dispatch(o); return o.map(() => ''); }, { onLog: (m) => logs.push(m) });
    expect(logs.some((l) => /Fidelidade baixa \(movimento/.test(l))).toBe(true);
    expect(line).toMatch(/movimento 100%/);
    expect(line).toMatch(/cor 100%/);
  });
});

describe('cor do modelo com a IA configurada: não empilha look', () => {
  const ref: MediaAsset = { id: 'ref', kind: 'video', role: 'reference', name: 'modelo.mp4', mime: 'video/mp4', size: 1, duration: 12, url: 'blob:ref' };
  const setup = () => {
    const ops: EditOp[] = [0, 1].map((i) => ({ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, i * 6, { duration: 6 }), in: i * 6, id: `c${i}`, colorPreset: 'cinematic' } }) as EditOp);
    const p: Project = applyOps({ ...createProject(), style, referenceAssetId: 'ref' }, ops).project;
    useEditor.setState({ project: p, past: [], future: [], assets: { a1: { ...src, url: 'blob:a1' }, ref }, messages: [], live: { running: false, done: 0, total: 0 } });
    h.status = { configured: true, provider: 'anthropic', transcribe: null };
  };
  const vids = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video') as { colorPreset?: string; colorGrade?: object }[];
  it('"só as cores do modelo": tira o look antigo de baixo do casamento (antes: cinematic + colorGrade empilhados)', async () => {
    setup();
    await applyModelStyle('colors', { apply: async (o) => { useEditor.getState().dispatch(o); return o.map(() => ''); } });
    expect(vids().every((c) => c.colorGrade)).toBe(true);
    expect(vids().filter((c) => c.colorPreset && c.colorPreset !== 'none')).toHaveLength(0);
  });
  it('"reedite seguindo o modelo": idem, e a IA recebe o pedido sem look', async () => {
    setup();
    h.edit.mockResolvedValueOnce({ reply: 'ok', ops: [] });
    await applyModelStyle('all', { apply: async (o) => { useEditor.getState().dispatch(o); return o.map(() => ''); } });
    expect(vids().filter((c) => c.colorPreset && c.colorPreset !== 'none')).toHaveLength(0);
  });
});
