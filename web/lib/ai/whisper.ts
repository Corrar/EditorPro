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
  const small = dev.mobile || dev.weak;
  const name = small ? 'tiny' : 'base';
  const model = `onnx-community/whisper-${name}_timestamped`;
  if (await webgpuF16()) {
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

/** transcreve a fala de uma mídia -> CaptionSegment[] em tempos DA MÍDIA */
export async function transcribeMedia(asset: MediaAsset, opts: TranscribeOptions = {}): Promise<CaptionSegment[]> {
  if (!asset.url) throw new Error(`A mídia "${asset.name}" não está carregada.`);
  const choice = opts.choice ?? (await chooseWhisper());
  await loadWhisper(choice, opts);
  opts.onStatus?.('Lendo o áudio…');
  const audio = await toMono16k(await decodeAudio(asset.url));
  const total = audio.length / 16000;
  const cuts = splitPoints(audio, 16000, deviceProfile().weak ? 30 : 60);
  const chunks: WhisperChunk[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    if (opts.signal?.aborted) throw new DOMException('Transcrição cancelada', 'AbortError');
    const a = cuts[i], b = cuts[i + 1];
    opts.onStatus?.(`Transcrevendo a fala… ${Math.round((a / total) * 100)}%`, a / total);
    const piece = audio.slice(Math.floor(a * 16000), Math.floor(b * 16000)); // cópia: transferida ao worker
    if (!speechLikely(piece, 16000)) continue; // sem fala (silêncio/tom/zumbido): não manda ao Whisper
    const res = await request<{ chunks: WhisperChunk[] }>(getWorker(), { type: 'transcribe', audio: piece, language: whisperLanguage(opts.language ?? 'pt-BR') }, undefined, opts.signal, [piece.buffer], Math.max(30_000, (b - a) * 4000));
    for (const c of res.chunks) chunks.push({ text: c.text, timestamp: [c.timestamp[0] + a, c.timestamp[1] === null ? null : c.timestamp[1] + a] });
  }
  opts.onStatus?.('Transcrevendo a fala… 100%', 1);
  return wordsToSegments(chunks, { duration: total });
}
