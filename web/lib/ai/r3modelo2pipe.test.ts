/* Revisão r3 (2ª rodada) — conferência de fidelidade no pipeline */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ color: { r: 0.6, g: 0.47, b: 0.35 }, calls: 0 }));
vi.mock('./fidelity', async (orig) => ({ ...(await orig<typeof import('./fidelity')>()), renderedColor: async () => { h.calls++; return h.color; } }));

import { useEditor } from '../store';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project, ReferenceTemplate } from '../types';
import { checkFidelity } from './pipeline';
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
