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
import { energyRuns, refineWordTimes, speechSeconds, type Range } from './vad';
import { filterAsr } from './asrFilter';
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
  // (plano §1.4) base q8 até em celular de 2 GB; tiny só abaixo disso
  const small = dev.memoryGB !== undefined && dev.memoryGB <= 1;
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

/** de onde veio a transcrição (o chat conta ao usuário) */
export interface TranscribeInfo {
  mode: 'server' | 'local' | 'mixed';
  /** "Groq whisper-large-v3-turbo", "Whisper base"… (vai para Captions.model) */
  label: string;
  /** trechos que o servidor não conseguiu e foram feitos no aparelho */
  localPieces?: number;
}

export interface TranscribeOptions {
  language?: string;
  onInfo?: (info: TranscribeInfo) => void;
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

export interface Job { a: number; b: number }

/** trechos com voz dentro de [a,b] */
function runsIn(runs: Range[], a: number, b: number): Range[] {
  return runs.filter((r) => r.end > a && r.start < b).map((r) => ({ start: Math.max(a, r.start), end: Math.min(b, r.end) }));
}

/**
 * (plano §1.3) o pedaço vai ao Whisper se tem ≥ 0,4 s de voz (antes: 8% da janela, que perdia
 * 2 s de fala num minuto). speechLikely só desempata som CONTÍNUO (tom/zumbido sem pausas).
 */
export function pieceHasSpeech(samples: Float32Array, rate: number, runs: Range[], a: number, b: number): boolean {
  const sec = speechSeconds(runsIn(runs, a, b));
  if (sec < 0.4) return false;
  const continuous = sec >= 0.85 * (b - a);
  if (continuous && !speechLikely(samples.subarray(Math.floor(a * rate), Math.floor(b * rate)), rate)) return false;
  return true;
}

function abortError() { return new DOMException('Transcrição cancelada', 'AbortError'); }

export interface ServerDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}
const defaultDeps: ServerDeps = {
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

class HttpFail extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) { super(message); }
}

/**
 * Whisper large no SERVIDOR (plano §1.5): 3 trechos ao mesmo tempo; cada trecho tenta de novo até 2×
 * (429/5xx/rede, respeitando Retry-After); o que ainda falhar volta em `failed` para o aparelho fazer
 * SÓ aquele trecho. Palavras presas a [0, duração do trecho] e com inícios não decrescentes.
 */
export async function serverChunks(audio: Float32Array, jobs: Job[], opts: TranscribeOptions, deps: ServerDeps = defaultDeps, rate = 16000): Promise<{ chunks: WhisperChunk[]; failed: Job[]; label?: string; errors: string[] }> {
  const chunks: WhisperChunk[] = [];
  const failed: Job[] = [];
  const errors: string[] = [];
  let label: string | undefined;
  const one = async (j: Job) => {
    const wav = encodeWav(audio.subarray(Math.floor(j.a * rate), Math.floor(j.b * rate)), rate);
    const len = j.b - j.a;
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw abortError();
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      opts.signal?.addEventListener('abort', onAbort);
      const timer = setTimeout(() => ctrl.abort(), 70_000);
      try {
        const res = await deps.fetch(`/api/ai/transcribe?lang=${encodeURIComponent(opts.language ?? 'pt-BR')}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: ctrl.signal });
        const data = (await res.json().catch(() => ({}))) as { words?: { word: string; start: number; end: number }[]; error?: string; retryAfter?: number; provider?: string; model?: string };
        if (!res.ok) {
          const ra = Number(res.headers?.get?.('retry-after')) || data.retryAfter;
          throw new HttpFail(data.error || `erro ${res.status} na transcrição`, res.status, ra && ra > 0 ? ra : undefined);
        }
        if (data.model) label = `${data.provider === 'groq' ? 'Groq' : data.provider === 'openai' ? 'OpenAI' : 'servidor'} ${data.model}`;
        const local: WhisperChunk[] = [];
        for (const w of data.words ?? []) {
          if (!w || typeof w.word !== 'string' || !Number.isFinite(w.start)) continue;
          const s = Math.min(len, Math.max(0, w.start));
          const e = Math.min(len, Math.max(s, Number.isFinite(w.end) ? w.end : s));
          local.push({ text: ` ${w.word.trim()}`, timestamp: [s + j.a, e + j.a] });
        }
        local.sort((x, y) => x.timestamp[0] - y.timestamp[0]);
        chunks.push(...local);
        return;
      } catch (e) {
        if (opts.signal?.aborted) throw abortError();
        const st = e instanceof HttpFail ? e.status : 0; // 0 = rede/tempo esgotado
        // 502 = o provedor recusou (chave, formato): repetir não adianta. 503/504/500/429/rede: tenta de novo
        const retryable = st === 0 || st === 429 || (st >= 500 && st !== 502);
        if (!retryable || attempt >= 2) {
          failed.push(j);
          errors.push(e instanceof Error ? e.message : String(e));
          return;
        }
        const wait = e instanceof HttpFail && e.retryAfter ? Math.min(20_000, e.retryAfter * 1000) : 800 * 2 ** attempt;
        await deps.sleep(wait);
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
  };
  // fila com 3 trabalhando ao mesmo tempo
  let next = 0;
  const worker = async () => { while (next < jobs.length) await one(jobs[next++]); };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  chunks.sort((x, y) => x.timestamp[0] - y.timestamp[0]);
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].timestamp[0] < chunks[i - 1].timestamp[0]) chunks[i] = { ...chunks[i], timestamp: [chunks[i - 1].timestamp[0], Math.max(chunks[i - 1].timestamp[0], chunks[i].timestamp[1] ?? 0)] };
  }
  return { chunks, failed: failed.sort((x, y) => x.a - y.a), label, errors };
}

/** Whisper no aparelho: trechos curtos (progresso real) e cão de guarda por trecho. `ranges` = só esses trechos. */
async function transcribeLocal(audio: Float32Array, runs: Range[], opts: TranscribeOptions, ranges?: Job[]): Promise<{ chunks: WhisperChunk[]; label: string }> {
  let choice = opts.choice ?? (await chooseWhisper());
  if (deviceProfile().mobile && choice.device === 'webgpu') choice = { ...choice, device: 'wasm', dtype: 'q8', sizeMB: choice.model.includes('tiny') ? 41 : 77 };
  await loadWhisper(choice, opts);
  const total = audio.length / 16000;
  const target = deviceProfile().weak ? 20 : 25;
  const cuts: Job[] = [];
  for (const r of ranges ?? [{ a: 0, b: total }]) {
    const pts = splitPoints(audio.subarray(Math.floor(r.a * 16000), Math.floor(r.b * 16000)), 16000, target, 5).map((x) => x + r.a);
    for (let i = 0; i < pts.length - 1; i++) cuts.push({ a: pts[i], b: pts[i + 1] });
  }
  const chunks: WhisperChunk[] = [];
  let speed = deviceProfile().mobile ? 1.6 : 0.5; // ms de processamento por ms de áudio (estimativa; ajusta no 1º trecho)
  for (const { a, b } of cuts) {
    if (opts.signal?.aborted) throw abortError();
    if (!pieceHasSpeech(audio, 16000, runs, a, b)) continue; // sem voz (silêncio/tom/zumbido): não manda ao Whisper
    const piece = audio.slice(Math.floor(a * 16000), Math.floor(b * 16000)); // cópia: transferida ao worker
    const stop = ticker(opts.onStatus, 'Transcrevendo a fala no aparelho…', a / total, b / total, (b - a) * 1000 * speed);
    const t0 = Date.now();
    try {
      const res = await request<{ chunks: WhisperChunk[] }>(getWorker(), { type: 'transcribe', audio: piece, language: whisperLanguage(opts.language ?? 'pt-BR') }, undefined, opts.signal, [piece.buffer], Math.max(45_000, (b - a) * 8000));
      for (const c of res.chunks) chunks.push({ text: c.text, timestamp: [c.timestamp[0] + a, c.timestamp[1] === null ? null : c.timestamp[1] + a] });
    } finally {
      stop();
    }
    speed = (Date.now() - t0) / Math.max(1, (b - a) * 1000);
  }
  opts.onStatus?.('Transcrevendo a fala no aparelho… 100%', 1);
  return { chunks, label: choice.label };
}

/**
 * Palavras cruas do Whisper -> legendas (tempos DA MÍDIA): filtro de alucinação/loop (asrFilter),
 * correção de tempo pela energia (vad) e agrupamento em FRASES (até 12 palavras / 6 s, quebra em
 * pausa ≥ 0,45 s). O bloco que aparece na tela é montado depois, no ritmo da fala (engine/captions).
 */
export function chunksToCaptions(chunks: WhisperChunk[], runs: Range[] | undefined, duration: number): CaptionSegment[] {
  const clean = filterAsr(chunks, runs, { duration });
  const timed = runs ? refineWordTimes(clean, runs) : clean;
  return wordsToSegments(timed, { duration, maxWords: 12, maxDur: 6, pauseGap: 0.45 });
}

/** transcreve a fala de uma mídia -> CaptionSegment[] em tempos DA MÍDIA.
 *  1º Whisper large no servidor (se configurado); trechos que falharem → Whisper no aparelho só neles. */
export async function transcribeMedia(asset: MediaAsset, opts: TranscribeOptions = {}): Promise<CaptionSegment[]> {
  if (!asset.url) throw new Error(`A mídia "${asset.name}" não está carregada.`);
  opts.onStatus?.('Lendo o áudio…');
  let decoded: AudioBuffer;
  try {
    decoded = await decodeAudio(asset.url);
  } catch (e) {
    // vídeo SEM faixa de áudio (gravação de tela, b-roll, stock): o navegador recusa com EncodingError.
    // É "sem fala", não falha — antes a transcrição inteira caía (até a fala dos outros vídeos sumia).
    // (Safari antigo chama o callback de erro com null)
    if (e == null || (e instanceof DOMException && (e.name === 'EncodingError' || e.name === 'NotSupportedError'))) {
      opts.onInfo?.({ mode: 'local', label: 'sem fala' });
      return [];
    }
    throw e;
  }
  const audio = await toMono16k(decoded);
  const total = audio.length / 16000;
  const runs = energyRuns(audio, 16000);
  if (speechSeconds(runs) < 0.4) {
    opts.onInfo?.({ mode: 'local', label: 'sem fala' });
    return [];
  }
  let chunks: WhisperChunk[] | null = null;
  const status = await getStatus().catch(() => null);
  if (status?.transcribe) {
    const cuts = splitPoints(audio, 16000, 100, 8);
    const jobs: Job[] = [];
    for (let i = 0; i < cuts.length - 1; i++) if (pieceHasSpeech(audio, 16000, runs, cuts[i], cuts[i + 1])) jobs.push({ a: cuts[i], b: cuts[i + 1] });
    const label = 'Transcrevendo a fala (alta precisão)…';
    const stop = ticker(opts.onStatus, label, 0, 1, Math.max(2500, total * 120));
    let res: Awaited<ReturnType<typeof serverChunks>>;
    try {
      res = await serverChunks(audio, jobs, opts);
    } finally {
      stop();
    }
    chunks = res.chunks;
    const name = res.label ?? `servidor (${status.transcribe})`;
    if (res.failed.length) {
      opts.onStatus?.(`${res.failed.length} trecho${res.failed.length > 1 ? 's' : ''} não ${res.failed.length > 1 ? 'foram' : 'foi'} no servidor (${res.errors[0] ?? 'erro'}) — fazendo ${res.failed.length > 1 ? 'esses' : 'esse'} no aparelho…`);
      const loc = await transcribeLocal(audio, runs, opts, res.failed);
      chunks = [...chunks, ...loc.chunks].sort((x, y) => x.timestamp[0] - y.timestamp[0]);
      const all = res.failed.length === jobs.length;
      opts.onInfo?.({ mode: all ? 'local' : 'mixed', label: all ? loc.label : `${name} + ${loc.label}`, localPieces: res.failed.length });
    } else {
      opts.onStatus?.(`${label} 100%`, 1);
      opts.onInfo?.({ mode: 'server', label: name });
    }
  }
  if (!chunks) {
    const loc = await transcribeLocal(audio, runs, opts);
    chunks = loc.chunks;
    opts.onInfo?.({ mode: 'local', label: loc.label });
  }
  // diagnóstico (QA/Playwright): saída crua do Whisper, trechos de voz e o que o filtro deixou
  try { (globalThis as { __epAsr?: unknown }).__epAsr = { asset: asset.id, raw: chunks, runs, duration: total }; } catch { /* sem global */ }
  return chunksToCaptions(chunks, runs, total);
}
