/* Revisão de código r2 (docs/revisao/2026-11-19-r2/ia.md): um teste por bug confirmado em lib/ai. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../store';
import { useAIChat } from './chatStore';
import * as pipeline from './pipeline';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { ColorGrade, MediaAsset, Project, VideoClip } from '../types';
import { sanitizeOps } from './validate';
import { mergeKfProps, reframeKeyframes, reframeX } from './features';
import { removeZoomOps } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20, width: 1920, height: 1080 };
const assets = { a1: src };
const base = (): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 10 } },
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 10), id: 'c2', duration: 10, in: 10 } },
] as EditOp[]).project;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastAssistant = () => [...useEditor.getState().messages].reverse().find((m) => m.role === 'assistant')!;

afterEach(() => vi.restoreAllMocks());
const reset = () => {
  useEditor.setState({ project: base(), past: [], future: [], assets, messages: [], live: { running: false, done: 0, total: 0 } });
  useAIChat.setState({ status: { configured: false, provider: 'demo' } as never, fast: true, busy: false });
};

describe('#1 execução presa ao projeto', () => {
  it('trocar de projeto no meio: nada cai no projeto novo e a IA não fica "Trabalhando…"', async () => {
    reset();
    let threw: unknown;
    vi.spyOn(pipeline, 'chatEdit').mockImplementation(async (_t, o) => {
      await o!.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.5 }, explain: 'a' }], { delayMs: 0 });
      await sleep(30); // Claude pensando… usuário abre outro projeto
      try { await o!.apply!([{ op: 'ripple_delete', start: 2, end: 6, explain: 'b' }], { delayMs: 0 }); } catch (e) { threw = e; throw e; }
      return { reply: 'ok', ops: [], appliedIds: [], provider: 'demo', warnings: [] };
    });
    const p = useAIChat.getState().send('corta 2 a 6');
    await sleep(10);
    const B = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'b1', duration: 20 } }] as EditOp[]).project;
    useEditor.getState().loadProject(B);
    await p;
    expect((threw as Error)?.name).toBe('AbortError');
    expect(useEditor.getState().project).toBe(B); // B intacto (sem o ripple de A)
    expect(useAIChat.getState().busy).toBe(false);
  });
  it('pergunta pendente + troca de projeto: a execução termina (busy volta a false)', async () => {
    reset();
    vi.spyOn(pipeline, 'chatEdit').mockImplementation(async (_t, o) => {
      const a = await o!.ask!('Transcrever?', [{ id: 'go', label: 'Sim' }, { id: 'skip', label: 'Pular' }]);
      await o!.apply!([{ op: 'set_aspect', aspect: '1:1', explain: a }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: [], provider: 'demo', warnings: [] };
    });
    const p = useAIChat.getState().send('legenda');
    await sleep(10);
    useEditor.getState().newProject();
    await p;
    expect(useAIChat.getState().busy).toBe(false);
    expect(useEditor.getState().project.aspect).not.toBe('1:1');
  });
});

describe('#2 colorGrade parcial mescla com a cor do usuário', () => {
  it('temperature não apaga LUT/curvas/rodas; 0 limpa só o campo; null limpa tudo', () => {
    const user: ColorGrade = { lut: { id: 'look:teal-orange', intensity: 0.7 }, curves: { master: [{ x: 0, y: 0.05 }, { x: 1, y: 0.95 }] }, lift: { r: 0.05, g: 0, b: 0, y: 0 }, contrast: 0.2 };
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: user } }]).project;
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: { temperature: 0.15, contrast: 0 } } }], p, assets);
    const g = (r.project.tracks[0].clips[0] as VideoClip).colorGrade!;
    expect(g).toMatchObject({ lut: user.lut, curves: user.curves, lift: user.lift, temperature: 0.15 });
    expect(g.contrast).toBeUndefined();
    const r2 = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: null } }], p, assets);
    expect((r2.project.tracks[0].clips[0] as VideoClip).colorGrade).toBeUndefined();
  });
});

describe('#3 Parar / edição manual param a execução inteira', () => {
  it('Parar no meio do lote: o próximo lote não é aplicado e a mensagem diz "Edição parada."', async () => {
    reset();
    let second = false;
    vi.spyOn(pipeline, 'chatEdit').mockImplementation(async (_t, o) => {
      await o!.apply!([1, 2, 3, 4].map((i) => ({ op: 'update_clip', clipId: 'c1', patch: { volume: i / 10 }, explain: `v${i}` }) as EditOp), { delayMs: 40 });
      second = true;
      await o!.apply!([{ op: 'set_aspect', aspect: '1:1', explain: 'x' }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: [], provider: 'demo', warnings: [] };
    });
    const p = useAIChat.getState().send('x');
    await sleep(60);
    useEditor.getState().cancelLive();
    await p;
    expect(second).toBe(false);
    expect(useEditor.getState().project.aspect).not.toBe('1:1');
    expect(lastAssistant().text).toBe('Edição parada.');
    expect(useAIChat.getState().busy).toBe(false);
  });
  it('edição manual entre lotes (fora do ao vivo) também para', async () => {
    reset();
    vi.spyOn(pipeline, 'chatEdit').mockImplementation(async (_t, o) => {
      await o!.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.3 }, explain: 'a' }], { delayMs: 0 });
      await sleep(30);
      await o!.apply!([{ op: 'set_aspect', aspect: '1:1', explain: 'b' }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: [], provider: 'demo', warnings: [] };
    });
    const p = useAIChat.getState().send('x');
    await sleep(15);
    useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c2', patch: { volume: 0.9 } });
    await p;
    expect(useEditor.getState().project.aspect).not.toBe('1:1');
    expect(lastAssistant().text).toMatch(/Parei a edição/);
  });
});

describe('#4 remove_words com ids de legenda corrigida', () => {
  const withCaps = () => applyOps(base(), [{ op: 'set_captions', segments: [{ id: 'cap_mwni9qwp53gpwb7', start: 0, end: 2, text: 'é Bruna né', words: [{ id: 'w00001', text: 'é', start: 0, end: 0.3 }, { id: 'w00002', text: 'Bruna', start: 0.4, end: 1.1 }, { id: 'w00003', text: 'né', start: 1.5, end: 1.9 }] }] }] as EditOp[]).project;
  it('mesma quantidade de palavras: mantém ids e tempos reais', () => {
    const r = sanitizeOps([{ op: 'update_caption', segmentId: 'cap_mwni9qwp53gpwb7', patch: { text: 'é Bruno né' } }], withCaps(), assets);
    expect(r.project.captions.segments[0].words).toEqual([{ id: 'w00001', text: 'é', start: 0, end: 0.3 }, { id: 'w00002', text: 'Bruno', start: 0.4, end: 1.1 }, { id: 'w00003', text: 'né', start: 1.5, end: 1.9 }]);
  });
  it('id longo (> 20 caracteres) não é truncado no remove_words', () => {
    const p = applyOps(withCaps(), [{ op: 'update_caption', segmentId: 'cap_mwni9qwp53gpwb7', patch: { words: [{ id: 'cap_mwni9qwp53gpwb7_0', text: 'é', start: 0, end: 0.3 }, { id: 'cap_mwni9qwp53gpwb7_1', text: 'né', start: 1.5, end: 1.9 }] } }] as EditOp[]).project;
    const r = sanitizeOps([{ op: 'remove_words', fromWordId: 'cap_mwni9qwp53gpwb7_1', explain: 'x' }], p, assets);
    expect(r.dropped).toEqual([]);
    expect(r.ops[0]).toMatchObject({ op: 'remove_words', fromWordId: 'cap_mwni9qwp53gpwb7_1' });
  });
  it('quantidade mudou: palavras mantidas guardam id/tempo; a nova ganha id curto que continua a numeração wNNNNN', () => {
    const r = sanitizeOps([{ op: 'update_caption', segmentId: 'cap_mwni9qwp53gpwb7', patch: { text: 'é o Bruno né' } }], withCaps(), assets);
    // (legendas §1.6) correção alinhada palavra a palavra: os tempos reais da fala não são redistribuídos
    expect(r.project.captions.segments[0].words!.map((w) => w.id)).toEqual(['w00001', 'w00004', 'w00002', 'w00003']);
    expect(r.project.captions.segments[0].words![2]).toMatchObject({ text: 'Bruno', start: 0.4, end: 1.1 });
  });
});

describe('#5 zoom e reenquadramento não apagam os keyframes um do outro', () => {
  const xs = [{ t: 0, transform: { x: 0.3 } }, { t: 4, transform: { x: -0.2 }, easing: 'easeInOut' as const }];
  it('mergeKfProps troca só a propriedade pedida', () => {
    const m = mergeKfProps(xs, [{ t: 1, transform: { scale: 1.2 } }], ['scale']);
    expect(m.map((k) => k.transform)).toEqual([{ x: 0.3 }, { scale: 1.2 }, { x: -0.2 }]);
    expect(mergeKfProps([{ t: 0, transform: { x: 0.3, scale: 1.1 } }], [], ['scale'])).toEqual([{ t: 0, transform: { x: 0.3 } }]);
  });
  it('update_clip com keyframes de escala (Claude/local) preserva o x do reenquadramento; tirar zoom mantém o x', () => {
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: xs } }]).project;
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 1, transform: { scale: 1.2 } }, { t: 2, transform: { scale: 1 } }] } }], p, assets);
    const kf = (r.project.tracks[0].clips[0] as VideoClip).keyframes!;
    expect(kf.filter((k) => k.transform.x !== undefined)).toHaveLength(2);
    expect(kf.filter((k) => k.transform.scale !== undefined)).toHaveLength(2);
    const off = removeZoomOps(r.project);
    const p2 = applyOps(r.project, off).project;
    expect((p2.tracks[0].clips[0] as VideoClip).keyframes!.map((k) => k.transform)).toEqual([{ x: 0.3 }, { x: -0.2 }]);
  });
});

describe('#6 reenquadrar pedaço curto sem amostra', () => {
  it('usa a posição interpolada dos vizinhos, não o centro', () => {
    const subject = Array.from({ length: 45 }, (_, i) => ({ t: i * 4, x: 0.25 }));
    const clip = { ...makeVideoClip(src, 0), id: 'k', in: 5, duration: 1 } as VideoClip; // entre as amostras de 4 s e 8 s
    const kf = reframeKeyframes(clip, subject, 16 / 9, 9 / 16);
    expect(kf[0].transform.x).toBeCloseTo(reframeX(0.25, 16 / 9, 9 / 16));
    expect(kf[0].transform.x).not.toBe(0);
  });
});

describe('#7 ops da IA respeitam trava de trilha/clipe', () => {
  it('update/remove/move/split/trim em trilha travada caem; duplicate vai p/ trilha destravada; remove_track travada cai', () => {
    const p = applyOps(base(), [
      { op: 'add_clip', trackId: 'logo', clip: { id: 'lg', type: 'shape', shape: 'rect', fill: '#fff', start: 0, duration: 20, transform: { x: 0.4, y: -0.4, scale: 0.2, rotation: 0, opacity: 1 } } },
      { op: 'update_track', trackId: 'logo', patch: { locked: true } },
    ] as EditOp[]).project;
    const r = sanitizeOps([
      { op: 'update_clip', clipId: 'lg', patch: { opacity: 0.2 } },
      { op: 'remove_clip', clipId: 'lg' },
      { op: 'move_clip', clipId: 'lg', start: 3 },
      { op: 'split_clip', clipId: 'lg', at: 5 },
      { op: 'trim_clip', clipId: 'lg', start: 0, end: 4 },
      { op: 'remove_track', trackId: 'logo' },
    ], p, assets);
    expect(r.ops).toEqual([]);
    expect(r.dropped).toHaveLength(6);
    expect(r.dropped.every((d) => /travad/.test(d.reason))).toBe(true);
    const ok = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.5 } }], p, assets);
    expect(ok.dropped).toEqual([]);
  });
});

describe('#8 histórico cheio: a execução ainda vira 1 desfazer', () => {
  it('100 passos antes + 3 lotes -> 1 undo volta ao projeto de antes', async () => {
    reset();
    for (let i = 0; i < 101; i++) useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c2', patch: { volume: (i % 10) / 10 + 0.05 } });
    expect(useEditor.getState().past.length).toBe(100);
    const before = useEditor.getState().project;
    await pipeline.withSingleUndo(async () => {
      for (const op of [{ op: 'set_aspect', aspect: '16:9' }, { op: 'update_clip', clipId: 'c1', patch: { volume: 0.4 } }, { op: 'update_clip', clipId: 'c1', patch: { speed: 1.5 } }] as EditOp[]) {
        await useEditor.getState().applyLive([{ ...op, explain: 'x' } as EditOp], { delayMs: 0 });
      }
    });
    useEditor.getState().undo();
    expect(useEditor.getState().project).toBe(before);
  });
});
