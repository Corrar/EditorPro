/* =====================================================================
   Executa o script de edição num Web Worker ISOLADO (Blob URL, sem rede):
   - antes do código da IA, o Worker apaga fetch/XHR/WebSocket/EventSource/
     importScripts/indexedDB/caches/BroadcastChannel do escopo global
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

/** código do Worker: tranca o escopo global e chama o núcleo (mesma função testada em Node) */
export function workerSource(): string {
  return `"use strict";
const BLOCK = ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','BroadcastChannel','Worker','SharedWorker','WebTransport','RTCPeerConnection','Notification','open'];
for (const k of BLOCK) { try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch (e) { try { self[k] = undefined; } catch (e2) {} } }
try { Object.defineProperty(self, 'navigator', { value: undefined }); } catch (e) {}
const runSandboxed = ${runSandboxed.toString()};
self.onmessage = (ev) => {
  const { code, input, maxOps } = ev.data;
  let res;
  try { res = runSandboxed(code, input, maxOps); } catch (e) { res = { error: String(e && e.message || e), logs: [] }; }
  self.postMessage(JSON.parse(JSON.stringify(res)));
};`;
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
    w.onmessage = (ev: MessageEvent) => { clearTimeout(timer); w.terminate(); resolve(ev.data as SandboxResult); };
    w.onerror = (ev: ErrorEvent | Event) => { clearTimeout(timer); w.terminate(); resolve({ error: `erro no script: ${(ev as ErrorEvent).message ?? 'desconhecido'}`, logs: [] }); };
    w.postMessage({ code, input, maxOps });
  });
}

export { runSandboxed };
