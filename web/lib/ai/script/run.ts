/* =====================================================================
   Executa o script de edição num Web Worker ISOLADO (Blob URL, sem rede):
   - antes do código da IA, o Worker apaga fetch/XHR/WebSocket/EventSource/
     importScripts/indexedDB/caches/BroadcastChannel/FontFace… do escopo global
     e de toda a cadeia de protótipos, tira texto -> código (Function, eval,
     setTimeout('…')) e o núcleo recusa `import()`; a resposta é conferida
   - 3 s de limite: estourou -> worker.terminate()
   - devolve EditOp[] (cru; o chamador valida com sanitizeOps)
   ===================================================================== */
import { allWords, projectDuration } from '../../ops';
import type { Id, MediaAsset, Project } from '../../types';
import { timelineBeats } from '../features';
import { runSandboxed, type SandboxResult, type ScriptInput } from './sandbox';

export const SCRIPT_TIMEOUT_MS = 3000;
export const SCRIPT_MAX_OPS = 3000;
export const MAX_SCRIPT_CHARS = 20000;

export function scriptInput(p: Project, assets: Record<Id, MediaAsset>): ScriptInput {
  return {
    project: JSON.parse(JSON.stringify(p)),
    assets: Object.values(assets).map((a) => ({ id: a.id, kind: a.kind, role: a.role, name: a.name, duration: a.duration, ...(a.width ? { width: a.width, height: a.height } : {}), ...(a.beats?.length ? { beats: a.beats.slice(0, 2000) } : {}) })),
    words: allWords(p).map((w) => ({ ...(w.id ? { id: w.id } : {}), text: w.text, start: w.start, end: w.end })),
    beats: timelineBeats(p, assets),
    duration: projectDuration(p),
  };
}

/** nomes que dão rede, código a partir de texto ou saída do Worker: somem do escopo global e de TODA a cadeia de protótipos */
export const WORKER_BLOCK = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker',
  'WebTransport', 'RTCPeerConnection', 'Notification', 'FontFace', 'fonts', 'open', 'navigator', 'postMessage', 'close',
  'Function', 'eval', 'setTimeout', 'setInterval',
];

/**
 * código do Worker: tranca o escopo e chama o núcleo (mesma função testada em Node).
 * - `fetch` e cia. moram no PROTÓTIPO do escopo global (WorkerGlobalScope.prototype): apagar só em `self`
 *   não basta — a cadeia inteira é trancada;
 * - texto -> código (Function/eval/setTimeout('…') e os construtores de funções async/geradoras) some, para o
 *   script não montar um `import()` escondido; o núcleo recebe o construtor capturado antes;
 * - tudo fica dentro de uma IIFE (nada de `const` global visível ao script) e o postMessage é capturado antes.
 */
export function workerSource(): string {
  return `(() => {
"use strict";
const F = Function;
const compile = (params, body) => new F(...params, body);
const post = self.postMessage.bind(self);
const BLOCK = ${JSON.stringify(WORKER_BLOCK)};
const kill = (o, k) => { try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) { try { delete o[k]; } catch (e2) {} } };
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of BLOCK) if (Object.prototype.hasOwnProperty.call(o, k)) kill(o, k);
for (const k of BLOCK) kill(self, k);
for (const f of [function () {}, async function () {}, function* () {}, async function* () {}]) kill(Object.getPrototypeOf(f), 'constructor');
const runSandboxed = ${runSandboxed.toString()};
self.onmessage = (ev) => {
  const { code, input, maxOps } = ev.data;
  let res;
  try { res = runSandboxed(code, input, maxOps, compile); } catch (e) { res = { error: String(e && e.message || e), logs: [] }; }
  try { post(JSON.parse(JSON.stringify(res))); } catch (e) { post({ error: 'o script devolveu algo que não dá para copiar', logs: [] }); }
};
})();`;
}

/** resposta do Worker: só aceita a forma do núcleo ({ops: []} ou {error}) */
export function workerResult(data: unknown): SandboxResult {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const logs = Array.isArray(d.logs) ? d.logs.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  if (typeof d.error === 'string') return { error: d.error.slice(0, 400), ...(typeof d.line === 'number' ? { line: d.line } : {}), logs };
  if (Array.isArray(d.ops)) return { ops: d.ops, logs };
  return { error: 'o script devolveu uma resposta inválida', logs };
}

export interface RunScriptOptions {
  timeoutMs?: number;
  maxOps?: number;
  /** testes: fábrica de Worker */
  makeWorker?: (src: string) => Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((ev: MessageEvent) => void) | null; onerror: ((ev: ErrorEvent | Event) => void) | null };
}

export async function runScript(code: string, p: Project, assets: Record<Id, MediaAsset>, opts: RunScriptOptions = {}): Promise<SandboxResult> {
  if (typeof code !== 'string' || !code.trim()) return { error: 'script vazio', logs: [] };
  if (code.length > MAX_SCRIPT_CHARS) return { error: `script grande demais (máx. ${MAX_SCRIPT_CHARS} caracteres)`, logs: [] };
  const input = scriptInput(p, assets);
  const maxOps = opts.maxOps ?? SCRIPT_MAX_OPS;
  const make = opts.makeWorker ?? ((src: string) => {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return w;
  });
  if (!opts.makeWorker && typeof Worker === 'undefined') return { error: 'scripts precisam de um navegador com Web Workers', logs: [] };
  return new Promise<SandboxResult>((resolve) => {
    let w: ReturnType<typeof make>;
    try { w = make(workerSource()); } catch (e) { resolve({ error: `não deu para iniciar o script: ${e instanceof Error ? e.message : String(e)}`, logs: [] }); return; }
    const timer = setTimeout(() => { w.terminate(); resolve({ error: `o script passou de ${(opts.timeoutMs ?? SCRIPT_TIMEOUT_MS) / 1000} s (laço infinito?) e foi interrompido`, logs: [] }); }, opts.timeoutMs ?? SCRIPT_TIMEOUT_MS);
    w.onmessage = (ev: MessageEvent) => { clearTimeout(timer); w.terminate(); resolve(workerResult(ev.data)); };
    w.onerror = (ev: ErrorEvent | Event) => { clearTimeout(timer); w.terminate(); resolve({ error: `erro no script: ${(ev as ErrorEvent).message ?? 'desconhecido'}`, logs: [] }); };
    w.postMessage({ code, input, maxOps });
  });
}

export { runSandboxed };
