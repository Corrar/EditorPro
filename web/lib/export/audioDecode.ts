/* =====================================================================
   Áudio do export SEM carregar o arquivo inteiro: em MP4/MOV, indexa só o
   moov (mp4box) e decodifica com AudioDecoder apenas as amostras do trecho
   usado pelo clipe. Outros formatos (MP3/WAV/WebM) ou falha do AudioDecoder:
   decodeAudioData do arquivo inteiro, só abaixo de um teto de tamanho.
   Falha de verdade vira AVISO ("o áudio de X não pôde ser incluído"), nunca
   um export mudo em silêncio.
   ===================================================================== */
import type { MediaAsset } from '../types';
import { indexMp4, SampleReader, type AudioIndex, type SampleRef } from './demux';

/** decodeAudioData do arquivo inteiro só abaixo disto (mesmo teto da ingestão) */
export const MAX_FULL_DECODE_BYTES = 350 * 1024 * 1024;

export interface DecodedRange {
  buffer: AudioBuffer;
  /** tempo de origem (s) da amostra 0 do buffer */
  t0: number;
}

export interface RangeResult {
  range: DecodedRange | null;
  /** motivo p/ o usuário quando o áudio existe mas não entrou */
  warning?: string;
}

/**
 * Índices (contíguos) das amostras que cobrem [from, to], com 1 amostra extra antes
 * (o AAC precisa do quadro anterior p/ a sobreposição do MDCT). Vazio se nada cobre.
 */
export function audioSampleRange(samples: Pick<SampleRef, 'cts' | 'duration'>[], from: number, to: number): { first: number; last: number } | null {
  let first = -1, last = -1;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.cts + s.duration < from) continue;
    if (s.cts > to) break;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  return { first: Math.max(0, first - 1), last };
}

/** junta blocos planares decodificados num AudioBuffer; t0 = timestamp do 1º bloco */
export function joinPlanar(blocks: { ts: number; planes: Float32Array[] }[]): { t0: number; channels: Float32Array[] } | null {
  if (!blocks.length) return null;
  blocks.sort((a, b) => a.ts - b.ts);
  const nch = Math.max(...blocks.map((b) => b.planes.length));
  const len = blocks.reduce((n, b) => n + b.planes[0].length, 0);
  const channels = Array.from({ length: nch }, () => new Float32Array(len));
  let o = 0;
  for (const b of blocks) {
    for (let c = 0; c < nch; c++) channels[c].set(b.planes[Math.min(c, b.planes.length - 1)], o);
    o += b.planes[0].length;
  }
  return { t0: blocks[0].ts, channels };
}

async function decodeWithAudioDecoder(ctx: BaseAudioContext, blob: Blob, a: AudioIndex, from: number, to: number): Promise<DecodedRange | null> {
  if (typeof AudioDecoder === 'undefined') return null;
  const cfg: AudioDecoderConfig = { codec: a.codec, sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description };
  const ok = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!ok.supported) return null;
  const r = audioSampleRange(a.samples, from, to);
  if (!r) return null;
  const blocks: { ts: number; planes: Float32Array[] }[] = [];
  let sr = a.sampleRate;
  let failure: unknown = null;
  const dec = new AudioDecoder({
    output: (d) => {
      try {
        sr = d.sampleRate;
        const planes: Float32Array[] = [];
        for (let c = 0; c < d.numberOfChannels; c++) {
          const p = new Float32Array(d.numberOfFrames);
          d.copyTo(p, { planeIndex: c, format: 'f32-planar' });
          planes.push(p);
        }
        blocks.push({ ts: d.timestamp / 1e6, planes });
      } catch (e) { failure = e; } finally { d.close(); }
    },
    error: (e) => { failure = e; },
  });
  try {
    dec.configure(cfg);
    const reader = new SampleReader(blob, a.samples);
    for (let i = r.first; i <= r.last; i++) {
      if (failure) throw failure;
      const s = a.samples[i];
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(s.cts * 1e6), duration: Math.round(s.duration * 1e6), data: await reader.get(i) }));
      while (dec.decodeQueueSize > 32) await new Promise((q) => setTimeout(q, 0));
    }
    await dec.flush();
    if (failure) throw failure;
  } finally {
    try { if (dec.state !== 'closed') dec.close(); } catch { /* ok */ }
  }
  const j = joinPlanar(blocks);
  if (!j || !j.channels[0].length) return null;
  const buffer = ctx.createBuffer(j.channels.length, j.channels[0].length, sr);
  j.channels.forEach((ch, c) => buffer.copyToChannel(ch, c));
  return { buffer, t0: j.t0 };
}

const isMp4Like = (a: MediaAsset) => !a.mime || /mp4|quicktime|mov|m4a|m4v|3gp|aac/i.test(a.mime);

/**
 * Decodifica o áudio de [from, to] (tempo de origem, s) do asset. null + sem aviso = o arquivo
 * não tem trilha de áudio (vídeo mudo); null + aviso = tinha som mas não deu p/ incluir.
 */
/** decodificação INTEIRA compartilhada entre os clipes do mesmo asset (o mix solta ao terminar o último) */
export type FullDecodeCache = Map<string, Promise<{ buffer: AudioBuffer } | { error: unknown }>>;

export async function decodeAudioRange(ctx: BaseAudioContext, asset: MediaAsset, blob: Blob, from: number, to: number, full?: FullDecodeCache): Promise<RangeResult> {
  const fail = (why: string): RangeResult => ({ range: null, warning: `O áudio de "${asset.name}" não pôde ser incluído (${why}).` });
  let hasAudio: true | null = asset.kind === 'audio' ? true : asset.waveform?.length ? true : null;
  if (isMp4Like(asset)) {
    const idx = await indexMp4(blob).catch(() => null);
    if (idx) {
      if (!idx.hasAudioTrack) return { range: null }; // vídeo sem som: nada a avisar
      hasAudio = true;
      if (idx.audio) {
        try {
          const range = await decodeWithAudioDecoder(ctx, blob, idx.audio, from, to);
          if (range) return { range };
        } catch (e) {
          console.warn('[export] AudioDecoder falhou, tentando decodeAudioData', asset.name, e);
        }
      }
    }
  }
  if (blob.size > MAX_FULL_DECODE_BYTES) {
    return fail('arquivo grande demais para decodificar neste aparelho');
  }
  // MP3/WAV/WebM: o arquivo inteiro é decodificado UMA vez por asset (antes: uma vez por clipe —
  // música de 5 min cortada em 12 pedaços = 12 decodificações e ~5 GB de pico)
  let job = full?.get(asset.id);
  if (!job) {
    job = blob.arrayBuffer().then((ab) => ctx.decodeAudioData(ab)).then((buffer) => ({ buffer }), (error: unknown) => ({ error }));
    full?.set(asset.id, job);
  }
  const r = await job;
  if ('buffer' in r) return { range: { buffer: r.buffer, t0: 0 } };
  const e = r.error;
  console.warn('[export] sem áudio decodificável em', asset.name, e);
  // sem índice nem waveform não dá p/ saber se havia som (ex.: WebM mudo): não alarma
  return hasAudio ? fail(e instanceof RangeError ? 'memória insuficiente' : 'formato não suportado pelo navegador') : { range: null };
}
