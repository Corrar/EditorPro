/* =====================================================================
   Transcrição no NAVEGADOR com Whisper (transformers.js) — grátis, sem chave.
   - escolhe modelo/dispositivo: WebGPU (com f16) -> WASM; celular = modelo menor
   - avisa o tamanho do download antes; progresso narrado no chat
   - processa o áudio em pedaços (~60 s, cortados em silêncio) p/ não estourar memória
   - pode ser cancelada (AbortSignal) — o worker é encerrado
   ===================================================================== */
import type { CaptionSegment, MediaAsset } from '../types';
import { decodeAudio, toMono16k } from './analysis';
import { deviceProfile } from './frames';
import { speechLikely, splitPoints, wordsToSegments, type WhisperChunk } from './words';
import { getStatus } from './client';

export interface WhisperChoice {
  model: string;
  device: 'webgpu' | 'wasm';
  dtype: string | Record<string, string>;
  /** download aproximado (1ª vez; depois fica no cache do navegador) */
  sizeMB: number;
  label: string;
}

const LANG: Record<string, string> = { pt: 'portuguese', en: 'english', es: 'spanish', fr: 'french', it: 'italian', de: 'german' };
export function whisperLanguage(code: string): string {
  return LANG[(code || 'pt').slice(0, 2).toLowerCase()] ?? 'portuguese';
}

/** WebGPU utilizável (com shader-f16)? Sem WebGPU (Firefox/Safari antigo) cai para WASM. */
async function webgpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter && adapter.features.has('shader-f16');
  } catch {
    return false;
  }
}

/** tamanhos medidos no Hugging Face (onnx-community/*_timestamped) */
export async function chooseWhisper(): Promise<WhisperChoice> {
  const dev = deviceProfile();
  // tiny erra muito em português (testado: troca o começo da fala por palavras sem sentido) → só em aparelho muito fraco
  const small = dev.memoryGB !== undefined && dev.memoryGB <= 2;
  const name = small ? 'tiny' : 'base';
  const model = `onnx-community/whisper-${name}_timestamped`;
  // celular: só WASM — WebGPU em fp16 nas GPUs de celular trava ("0%") ou devolve texto que não é a fala
  if (!dev.mobile && (await webgpuF16())) {
    return { model, device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' }, sizeMB: small ? 63 : 110, label: `Whisper ${name} (GPU)` };
  }
  return { model, device: 'wasm', dtype: 'q8', sizeMB: small ? 41 : 77, label: `Whisper ${name}` };
}

let worker: Worker | null = null;
let workerKey = '';
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    workerKey = '';
  }
  return worker;
}

export function stopWhisper() {
  worker?.terminate();
  worker = null;
  workerKey = '';
}

/**
 * pedido ao worker com "cão de guarda": se ficar `stallMs` sem resposta (nem progresso),
 * encerra o worker e rejeita — a transcrição nunca trava o chat.
 */
function request<T>(w: Worker, msg: Record<string, unknown>, onProgress: ((loaded: number, total: number) => void) | undefined, signal?: AbortSignal, transfer: Transferable[] = [], stallMs = 90_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { cleanup(); stopWhisper(); reject(new Error('a transcrição travou e foi interrompida')); }, stallMs);
    };
    const onAbort = () => { cleanup(); stopWhisper(); reject(new DOMException('Transcrição cancelada', 'AbortError')); };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as { type: string; id?: number; loaded?: number; total?: number; message?: string };
      if (m.type === 'progress') { arm(); onProgress?.(m.loaded ?? 0, m.total ?? 0); }
      else if (m.type === 'error' && (m.id === undefined || m.id === id)) { cleanup(); reject(new Error(m.message || 'erro no Whisper')); }
      else if ((m.type === 'ready' && msg.type === 'load') || (m.type === 'result' && m.id === id)) { cleanup(); resolve(m as T); }
    };
    const onErr = (ev: ErrorEvent) => { cleanup(); reject(new Error(ev.message || 'o worker do Whisper falhou')); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    arm();
    w.postMessage({ ...msg, id }, transfer);
  });
}

export interface TranscribeOptions {
  language?: string;
  choice?: WhisperChoice;
  onStatus?: (text: string, progress?: number) => void;
  signal?: AbortSignal;
}

/** carrega o modelo (download na 1ª vez) */
export async function loadWhisper(choice: WhisperChoice, opts: TranscribeOptions = {}): Promise<void> {
  const key = `${choice.model}|${choice.device}`;
  const w = getWorker();
  if (workerKey === key) return;
  opts.onStatus?.(`Preparando a transcrição (${choice.label}, ~${choice.sizeMB} MB na 1ª vez)…`);
  try {
    await request(w, { type: 'load', model: choice.model, device: choice.device, dtype: choice.dtype }, (loaded, total) => {
      const f = total ? loaded / total : 0;
      opts.onStatus?.(`Baixando o modelo de transcrição (~${choice.sizeMB} MB, 1ª vez)… ${Math.round(f * 100)}%`, f);
    }, opts.signal);
  } catch (e) {
    if (choice.device === 'webgpu' && !(e instanceof DOMException)) {
      // WebGPU falhou neste aparelho: tenta WASM
      stopWhisper();
      return loadWhisper({ ...choice, device: 'wasm', dtype: 'q8', sizeMB: choice.model.includes('tiny') ? 41 : 77 }, opts);
    }
    throw e;
  }
  workerKey = key;
}

/** frases que o Whisper "inventa" em silêncio/música (não são fala) */
const HALLUCINATION = /amara\.org|legendas pela comunidade|legenda(s|do)? por|obrigad[oa] por assistir|inscreva-se|ative o sininho|transcri[cç][aã]o (feita )?por|subtitles by|thanks for watching/i;
function dropHallucinations(segs: CaptionSegment[]): CaptionSegment[] {
  return segs.filter((s) => !HALLUCINATION.test(s.text));
}

/** Float32 16 kHz mono -> WAV PCM 16 bits */
export function encodeWav(samples: Float32Array, rate = 16000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}

/** progresso "andando" enquanto um trecho processa (estimativa pelo tempo), sem passar do fim do trecho */
function ticker(onStatus: TranscribeOptions['onStatus'], label: string, from: number, to: number, estMs: number) {
  const t0 = Date.now();
  const id = setInterval(() => {
    const f = from + (to - from) * Math.min(0.92, (Date.now() - t0) / Math.max(800, estMs));
    onStatus?.(`${label} ${Math.round(f * 100)}%`, f);
  }, 400);
  return () => clearInterval(id);
}

/** Whisper large no SERVIDOR: trechos de até ~100 s (WAV ≤ ~3,3 MB), 2 de cada vez */
async function transcribeOnServer(audio: Float32Array, opts: TranscribeOptions): Promise<WhisperChunk[]> {
  const total = audio.length / 16000;
  const cuts = splitPoints(audio, 16000, 100, 8);
  const jobs: { a: number; b: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (speechLikely(audio.subarray(Math.floor(a * 16000), Math.floor(b * 16000)), 16000)) jobs.push({ a, b });
  }
  const chunks: WhisperChunk[] = [];
  let done = 0;
  const label = 'Transcrevendo a fala (alta precisão)…';
  const stop = ticker(opts.onStatus, label, 0, 1, Math.max(2500, total * 120));
  try {
    const run = async (j: { a: number; b: number }) => {
      if (opts.signal?.aborted) throw new DOMException('Transcrição cancelada', 'AbortError');
      const wav = encodeWav(audio.subarray(Math.floor(j.a * 16000), Math.floor(j.b * 16000)));
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctrl.abort(), 70_000);
      try {
        const res = await fetch(`/api/ai/transcribe?lang=${encodeURIComponent(opts.language ?? 'pt-BR')}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: ctrl.signal });
        const data = (await res.json().catch(() => ({}))) as { words?: { word: string; start: number; end: number }[]; error?: string };
        if (!res.ok) throw new Error(data.error || `erro ${res.status} na transcrição`);
        for (const w of data.words ?? []) chunks.push({ text: ` ${w.word.trim()}`, timestamp: [w.start + j.a, w.end + j.a] });
      } catch (e) {
        if (opts.signal?.aborted) throw new DOMException('Transcrição cancelada', 'AbortError');
        throw e;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      done++;
    };
    for (let i = 0; i < jobs.length; i += 2) await Promise.all(jobs.slice(i, i + 2).map(run));
  } finally {
    stop();
  }
  opts.onStatus?.(`${label} 100%`, 1);
  void done;
  return chunks.sort((x, y) => x.timestamp[0] - y.timestamp[0]);
}

/** Whisper no aparelho: trechos curtos (progresso real) e cão de guarda por trecho */
async function transcribeLocal(audio: Float32Array, opts: TranscribeOptions): Promise<WhisperChunk[]> {
  let choice = opts.choice ?? (await chooseWhisper());
  if (deviceProfile().mobile && choice.device === 'webgpu') choice = { ...choice, device: 'wasm', dtype: 'q8', sizeMB: choice.model.includes('tiny') ? 41 : 77 };
  await loadWhisper(choice, opts);
  const total = audio.length / 16000;
  const cuts = splitPoints(audio, 16000, deviceProfile().weak ? 20 : 25, 5);
  const chunks: WhisperChunk[] = [];
  let speed = deviceProfile().mobile ? 1.6 : 0.5; // ms de processamento por ms de áudio (estimativa; ajusta no 1º trecho)
  for (let i = 0; i < cuts.length - 1; i++) {
    if (opts.signal?.aborted) throw new DOMException('Transcrição cancelada', 'AbortError');
    const a = cuts[i], b = cuts[i + 1];
    const piece = audio.slice(Math.floor(a * 16000), Math.floor(b * 16000)); // cópia: transferida ao worker
    if (!speechLikely(piece, 16000)) continue; // sem fala (silêncio/tom/zumbido): não manda ao Whisper
    const stop = ticker(opts.onStatus, 'Transcrevendo a fala…', a / total, b / total, (b - a) * 1000 * speed);
    const t0 = Date.now();
    try {
      const res = await request<{ chunks: WhisperChunk[] }>(getWorker(), { type: 'transcribe', audio: piece, language: whisperLanguage(opts.language ?? 'pt-BR') }, undefined, opts.signal, [piece.buffer], Math.max(45_000, (b - a) * 8000));
      for (const c of res.chunks) chunks.push({ text: c.text, timestamp: [c.timestamp[0] + a, c.timestamp[1] === null ? null : c.timestamp[1] + a] });
    } finally {
      stop();
    }
    speed = (Date.now() - t0) / Math.max(1, (b - a) * 1000);
  }
  opts.onStatus?.('Transcrevendo a fala… 100%', 1);
  return chunks;
}

/** transcreve a fala de uma mídia -> CaptionSegment[] em tempos DA MÍDIA.
 *  1º Whisper large no servidor (se configurado), senão/falhou → Whisper no aparelho. */
export async function transcribeMedia(asset: MediaAsset, opts: TranscribeOptions = {}): Promise<CaptionSegment[]> {
  if (!asset.url) throw new Error(`A mídia "${asset.name}" não está carregada.`);
  opts.onStatus?.('Lendo o áudio…');
  const audio = await toMono16k(await decodeAudio(asset.url));
  const total = audio.length / 16000;
  let chunks: WhisperChunk[] | null = null;
  const status = await getStatus().catch(() => null);
  if (status?.transcribe) {
    try {
      chunks = await transcribeOnServer(audio, opts);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      opts.onStatus?.(`A transcrição no servidor falhou (${e instanceof Error ? e.message : e}) — usando a do aparelho…`);
    }
  }
  if (!chunks) chunks = await transcribeLocal(audio, opts);
  return dropHallucinations(wordsToSegments(chunks, { duration: total }));
}
