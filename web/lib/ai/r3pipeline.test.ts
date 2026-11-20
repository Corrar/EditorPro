/* Revisão r3 — "reedite seguindo o modelo" no chat (demo e Claude) */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ status: { configured: false, provider: 'demo', transcribe: null } as Record<string, unknown>, edit: vi.fn() }));
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), getStatus: async () => h.status, requestEdit: h.edit }));
vi.mock('./review', async (orig) => ({ ...(await orig<typeof import('./review')>()), reviewEnabled: () => false }));

import { useEditor } from '../store';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, Keyframe, MediaAsset, Project, ReferenceTemplate, VideoClip } from '../types';
import { chatEdit, type PipelineOptions } from './pipeline';
import { styleFromCuts } from './demo';
import { edgePxPerFrame } from './motion';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 15 };
function speech(dur: number): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  let t = 0.1, k = 0;
  while (t < dur - 1) {
    const words = [];
    for (let i = 0; i < 4 && t < dur - 0.4; i++, k++) { words.push({ id: `w${k}`, text: `p${k}`, start: +t.toFixed(3), end: +(t + 0.34).toFixed(3) }); t += 0.4; }
    segs.push({ id: `s${segs.length}`, start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(' '), words });
    t += 0.3;
  }
  return segs;
}
const color = { r: 0.6, g: 0.47, b: 0.35, sat: 0.684, lum: 0.5, lumSd: 0.2 };
const refTemplate: ReferenceTemplate = {
  shots: Array.from({ length: 10 }, (_, i) => ({ start: +(i * 1.2).toFixed(1), end: +((i + 1) * 1.2).toFixed(1) })),
  shotStats: { median: 1.2, p10: 1.2, p90: 1.2 },
  motion: { mode: 'smooth-push', avgZoomPerShot: 1.15, easing: 'easeInOut', direction: 'in', punchFrequency: 0, perShot: [] },
  transitions: [{ kind: 'cut', duration: 0, frequency: 1 }],
  color,
};
const style = styleFromCuts(refTemplate.shots.slice(1).map((s) => s.start), 12, { width: 1080, height: 1920 }, color, refTemplate);
const base = (): Project => applyOps({ ...createProject(), style }, [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0, { duration: 15 }), id: 'c1' } },
  { op: 'set_captions', segments: speech(15), language: 'pt-BR' },
] as EditOp[]).project;
const reset = () => useEditor.setState({ project: base(), past: [], future: [], assets: { a1: src }, messages: [], live: { running: false, done: 0, total: 0 } });
const applied: EditOp[][] = [];
const opts = (): PipelineOptions => ({ apply: async (ops) => { applied.push(ops); useEditor.getState().dispatch(ops); return ops.map((o) => o.id ?? ''); } });
const vids = () => useEditor.getState().project.tracks.flatMap((t) => t.clips).filter((c): c is VideoClip => c.type === 'video');

beforeEach(() => { applied.length = 0; h.edit.mockReset(); h.status = { configured: false, provider: 'demo', transcribe: null }; });

describe('modo demo: pedidos digitados de "seguir o modelo"', () => {
  for (const text of ['reedite seguindo o modelo', 'segue o modelo', 'edita igual o modelo', 'deixa como o vídeo modelo']) {
    it(`"${text}" aplica o molde (antes: "Não entendi esse pedido")`, async () => {
      reset();
      const r = await chatEdit(text, opts());
      expect(r.reply).not.toMatch(/Não entendi/);
      expect(vids().length).toBeGreaterThanOrEqual(8);
    });
  }
});

describe('Claude no chat com modelo suave: zoom da IA sai suave (≤8 px/quadro)', () => {
  it('"reedite seguindo o modelo" com rampa de 0,2 s vinda da IA', async () => {
    reset();
    h.status = { configured: true, provider: 'anthropic', transcribe: null };
    h.edit.mockResolvedValue({ reply: 'Feito.', ops: [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.2, transform: { scale: 1.2 } }, { t: 6, transform: { scale: 1 } }] }, explain: 'zoom' }] });
    await chatEdit('reedite seguindo o modelo', opts());
    const c = vids()[0];
    expect(c.keyframes?.length).toBeGreaterThan(1);
    expect(edgePxPerFrame(c.keyframes as Keyframe[], c.duration)).toBeLessThanOrEqual(8);
  });
  it('pedido explícito de pancada continua pancada', async () => {
    reset();
    h.status = { configured: true, provider: 'anthropic', transcribe: null };
    h.edit.mockResolvedValue({ reply: 'Feito.', ops: [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 0.2, transform: { scale: 1.2 } }] }, explain: 'zoom' }] });
    await chatEdit('coloca um zoom em pancada no começo', opts());
    const c = vids()[0];
    expect(edgePxPerFrame(c.keyframes as Keyframe[], c.duration)).toBeGreaterThan(8);
  });
});
