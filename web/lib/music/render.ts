/* =====================================================================
   Música · renderMusic (navegador): WAV Blob com cache em memória +
   IndexedDB, renderizado num Web Worker (UI não trava). Sem Worker,
   cai para a thread principal cedendo o laço antes.
   ===================================================================== */
import { ENGINE_VERSION, clampDuration, musicTiming } from './engine';
import { musicTrack, type MusicTrack } from './catalog';

export interface RenderMusicOptions {
  duration?: number;
  sampleRate?: number;
  loop?: boolean;
}

/** última medição de tempo de render (ms), para diagnóstico */
export const renderStats: { lastMs: number; lastId: string; worker: boolean } = { lastMs: 0, lastId: '', worker: false };

const mem = new Map<string, Promise<Blob>>();
const MEM_MAX = 24;

export function cacheKey(id: string, o: RenderMusicOptions = {}): string {
  const d = clampDuration(o.duration ?? musicTrack(id)?.duration ?? 30);
  return `v${ENGINE_VERSION}:${id}:${d.toFixed(3)}:${o.sampleRate ?? 44100}:${o.loop ? 'L' : 'F'}`;
}

/* ---------- IndexedDB ---------- */

const DB = 'ep-music';
const STORE = 'wav';
const IDB_MAX = 40;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((res) => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch { res(null); }
  });
}
let dbP: Promise<IDBDatabase | null> | null = null;
const db = () => (dbP ??= openDb());

async function idbGet(key: string): Promise<Blob | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => {
    try {
      const rq = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      rq.onsuccess = () => { const v = rq.result as { blob: Blob } | undefined; res(v?.blob ?? null); };
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((res) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      st.put({ blob, at: Date.now() }, key);
      // poda: mantém só as IDB_MAX mais recentes (e tira versões antigas do motor)
      const all = st.getAll();
      const keys = st.getAllKeys();
      tx.oncomplete = () => res();
      tx.onerror = () => res();
      keys.onsuccess = () => {
        all.onsuccess = () => {
          const rows = (keys.result as string[]).map((k, i) => ({ k, at: (all.result[i] as { at: number }).at ?? 0 }));
          const stale = rows.filter((r) => !r.k.startsWith(`v${ENGINE_VERSION}:`));
          const fresh = rows.filter((r) => r.k.startsWith(`v${ENGINE_VERSION}:`)).sort((a, b) => b.at - a.at).slice(IDB_MAX);
          for (const r of [...stale, ...fresh]) st.delete(r.k);
        };
      };
    } catch { res(); }
  });
}

/* ---------- worker ---------- */

type Pending = { res: (b: ArrayBuffer) => void; rej: (e: Error) => void };
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    const w = new Worker(new URL('./music.worker.ts', import.meta.url));
    w.onmessage = (e: MessageEvent<{ reqId: number; wav?: ArrayBuffer; error?: string; ms?: number }>) => {
      const p = pending.get(e.data.reqId);
      if (!p) return;
      pending.delete(e.data.reqId);
      if (e.data.wav) { renderStats.lastMs = e.data.ms ?? 0; renderStats.worker = true; p.res(e.data.wav); } else p.rej(new Error(e.data.error ?? 'falha ao gerar a música'));
    };
    w.onerror = (ev) => {
      ev.preventDefault?.();
      for (const p of pending.values()) p.rej(new Error('worker de música falhou'));
      pending.clear();
      worker = null; // próximas: thread principal
    };
    return (worker = w);
  } catch {
    return (worker = null);
  }
}

async function renderWav(id: string, duration: number, sampleRate: number, loop: boolean): Promise<ArrayBuffer> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<ArrayBuffer>((res, rej) => {
        const reqId = ++seq;
        pending.set(reqId, { res, rej });
        w.postMessage({ reqId, id, duration, sampleRate, loop });
      });
    } catch { /* cai para a thread principal */ }
  }
  await new Promise((r) => setTimeout(r, 0));
  const { musicWav } = await import('./wav');
  const t0 = performance.now();
  const wav = musicWav(id, { duration, sampleRate, loop });
  renderStats.lastMs = performance.now() - t0; renderStats.worker = false;
  return wav;
}

/**
 * WAV (Blob audio/wav) da faixa `id` na duração pedida. Cacheado em memória
 * e no IndexedDB: a 2ª vez é instantânea, mesmo depois de recarregar.
 */
export function renderMusic(id: string, o: RenderMusicOptions = {}): Promise<Blob> {
  const t = musicTrack(id);
  if (!t) return Promise.reject(new Error(`música desconhecida: ${id}`));
  const duration = clampDuration(o.duration ?? t.duration);
  const sampleRate = o.sampleRate ?? 44100;
  const key = cacheKey(id, { duration, sampleRate, loop: o.loop });
  const hit = mem.get(key);
  if (hit) return hit;
  const p = (async () => {
    const stored = await idbGet(key);
    if (stored) return stored;
    const wav = await renderWav(id, duration, sampleRate, !!o.loop);
    renderStats.lastId = id;
    const blob = new Blob([wav], { type: 'audio/wav' });
    void idbPut(key, blob);
    return blob;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
  return p;
}

/** AudioBuffer decodificado (para quem quer tocar via WebAudio) */
export async function renderMusicBuffer(id: string, o: RenderMusicOptions & { context?: BaseAudioContext } = {}): Promise<AudioBuffer> {
  const blob = await renderMusic(id, o);
  const ctx = o.context ?? new OfflineAudioContext(2, 1, o.sampleRate ?? 44100);
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/** duração da prévia: um ciclo A+B em loop (8 compassos; 4 se ficar longo) ≤ ~16 s */
export function previewDuration(t: MusicTrack): number {
  const bar = 240 / t.bpm;
  return Math.round((bar * 8 <= 16.5 ? bar * 8 : bar * 4) * 1000) / 1000;
}

/** WAV da prévia (loop curto, começa direto no groove) */
export function renderPreview(id: string): Promise<Blob> {
  const t = musicTrack(id);
  if (!t) return Promise.reject(new Error(`música desconhecida: ${id}`));
  return renderMusic(id, { duration: previewDuration(t), loop: true });
}

/* reexport útil para a UI */
export { musicTiming };
