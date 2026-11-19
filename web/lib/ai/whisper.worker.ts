/* =====================================================================
   Web Worker do Whisper (transformers.js). Roda fora da thread da UI.
   A biblioteca é carregada em tempo de execução do CDN (versão fixa), sem
   passar pelo bundler do Next — ela traz o onnxruntime-web e o .wasm.
   Mensagens:
     -> {type:'load', model, device, dtype}
     <- {type:'progress', loaded, total} | {type:'ready', device} | {type:'error', message}
     -> {type:'transcribe', id, audio: Float32Array (16 kHz), language}
     <- {type:'result', id, chunks}
   ===================================================================== */
/// <reference lib="webworker" />

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

type ASRChunk = { text: string; timestamp: [number, number | null] };
type ASR = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: ASRChunk[] }>;
interface TransformersLib {
  env: { allowLocalModels: boolean };
  pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
}

let lib: Promise<TransformersLib> | null = null;
let asr: ASR | null = null;
let loadedKey = '';
const files = new Map<string, { loaded: number; total: number }>();

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

function transformers(): Promise<TransformersLib> {
  lib ??= import(/* webpackIgnore: true */ TRANSFORMERS_URL).then((m: TransformersLib) => {
    m.env.allowLocalModels = false;
    return m;
  });
  return lib;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; id?: number; [k: string]: unknown };
  try {
    if (msg.type === 'load') {
      const key = `${msg.model}|${msg.device}|${JSON.stringify(msg.dtype)}`;
      if (!asr || loadedKey !== key) {
        files.clear();
        const { pipeline } = await transformers();
        asr = (await pipeline('automatic-speech-recognition', String(msg.model), {
          device: msg.device,
          dtype: msg.dtype,
          progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
            if (info.status === 'progress' && info.file && info.total) {
              files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
              let loaded = 0, total = 0;
              for (const f of files.values()) { loaded += f.loaded; total += f.total; }
              post({ type: 'progress', loaded, total });
            }
          },
        })) as ASR;
        loadedKey = key;
      }
      post({ type: 'ready', device: msg.device, id: msg.id });
    } else if (msg.type === 'transcribe') {
      if (!asr) throw new Error('modelo não carregado');
      const out = await asr(msg.audio as Float32Array, {
        language: msg.language ?? 'portuguese',
        task: 'transcribe',
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        // trava de segurança contra loops de alucinação (fala real de 30 s cabe folgado)
        max_new_tokens: 220,
        no_repeat_ngram_size: 4,
      });
      post({ type: 'result', id: msg.id, chunks: out.chunks ?? [], text: out.text });
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
