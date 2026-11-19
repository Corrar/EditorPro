/* =====================================================================
   Export de vídeo no navegador: render offline quadro a quadro com o mesmo
   renderFrame do preview → WebCodecs (H.264/AAC em MP4, VP9/Opus em WebM)
   + muxer. Sem WebCodecs: MediaRecorder (WebM) em tempo real.
   ===================================================================== */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import type { MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import { renderFrame } from '../engine';
import { visualLayers, sourceTime } from '../engine/timing';
import { ensureProjectFonts } from '../engine/fonts';
import { mixProjectAudio, MIX_RATE } from './audioMix';
import { OfflineMediaPool } from './mediaPool';
import { DecodedMediaPool } from './decodePool';
import { encoderProducesImage } from './encoderCheck';
import { exportFps, exportSize, hasWebCodecs, QUALITY_ORDER, SPEED_PROFILE, videoBitrate, type ExportOptions, type ExportSpeed } from './options';

const abortErr = () => new DOMException('Exportação cancelada', 'AbortError');

interface VideoCodecChoice { codec: string; mux: 'avc' | 'vp9' | 'av1' | 'vp8' }
interface AudioCodecChoice { codec: string; mux: 'aac' | 'opus' }

const MP4_VIDEO: VideoCodecChoice[] = [
  { codec: 'avc1.640034', mux: 'avc' }, { codec: 'avc1.640033', mux: 'avc' }, { codec: 'avc1.4d0033', mux: 'avc' }, { codec: 'avc1.42e033', mux: 'avc' },
  { codec: 'avc1.42001f', mux: 'avc' }, { codec: 'vp09.00.41.08', mux: 'vp9' }, { codec: 'av01.0.08M.08', mux: 'av1' },
];
const WEBM_VIDEO: VideoCodecChoice[] = [
  { codec: 'vp09.00.41.08', mux: 'vp9' }, { codec: 'vp8', mux: 'vp8' }, { codec: 'av01.0.08M.08', mux: 'av1' },
];
const MP4_AUDIO: AudioCodecChoice[] = [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }];
const WEBM_AUDIO: AudioCodecChoice[] = [{ codec: 'opus', mux: 'opus' }];

/** verify: autoteste (codifica/decodifica 2 quadros) — descarta config que gera quadro preto (encoder de hardware no Android) */
async function pickVideo(list: VideoCodecChoice[], w: number, h: number, fps: number, bitrate: number, speed: ExportSpeed = 'equilibrado', verify = false) {
  const hw = SPEED_PROFILE[speed].hardware;
  for (const c of list) {
    const base: VideoEncoderConfig = {
      codec: c.codec, width: w, height: h, bitrate, framerate: fps,
      bitrateMode: 'variable', latencyMode: 'quality', alpha: 'discard',
      ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}),
    } as VideoEncoderConfig;
    // tenta com aceleração de hardware; se não houver, sem preferência
    for (const config of hw === 'prefer-hardware' ? [{ ...base, hardwareAcceleration: hw }, base] : [base]) {
      try {
        const s = await VideoEncoder.isConfigSupported(config as VideoEncoderConfig);
        if (!s.supported) continue;
        if (verify && (await encoderProducesImage(config as VideoEncoderConfig)) === false) {
          console.warn(`[export] encoder ${c.codec} (${(config as VideoEncoderConfig).hardwareAcceleration ?? 'auto'}) gerou quadro preto no autoteste; tentando outra config`);
          continue;
        }
        return { choice: c, config: config as VideoEncoderConfig };
      } catch { /* tenta o próximo */ }
    }
  }
  return null;
}

async function pickAudio(list: AudioCodecChoice[]) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of list) {
    const config: AudioEncoderConfig = { codec: c.codec, sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: 160_000 };
    try {
      const s = await AudioEncoder.isConfigSupported(config);
      if (s.supported) return { choice: c, config };
    } catch { /* próximo */ }
  }
  return null;
}


/** lista do que será desenhado no tempo t e o tempo de origem de cada vídeo */
function framePlan(p: Project, t: number) {
  return visualLayers(p, t)
    .filter((l) => l.clip.type === 'video' || (l.clip.type === 'image' && l.clip.removeBackground))
    .map((l) => ({ clip: l.clip, time: sourceTime(l.clip, t) }));
}

/** localStorage 'ep:export-decoder' = '0' volta ao pool de <video> (comparação/diagnóstico) */
function decoderDisabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ep:export-decoder') === '0'; } catch { return false; }
}

async function waitFonts() {
  try {
    if (typeof document !== 'undefined' && document.fonts) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
    }
  } catch { /* ok */ }
}

export async function exportVideo(p: Project, assets: Record<string, MediaAsset>, opts: ExportOptions): Promise<Blob> {
  const { signal, onProgress } = opts;
  const report = (f: number, stage: string) => onProgress?.(Math.max(0, Math.min(1, f)), stage);
  const duration = projectDuration(p);
  if (!(duration > 0)) throw new Error('O projeto está vazio: adicione clipes antes de exportar.');
  report(0, 'Preparando mídia');
  await Promise.race([ensureProjectFonts(p), new Promise((r) => setTimeout(r, 8000))]);
  await waitFonts();
  // WebCodecs: decodificação sequencial (sem seek por quadro); MediaRecorder: pool de <video>
  const fast = hasWebCodecs() && typeof VideoDecoder !== 'undefined' && !decoderDisabled();
  const pool = fast ? new DecodedMediaPool(assets) : new OfflineMediaPool(assets);
  // avisos do pool (ex.: troca de decodificador por quadro preto) aparecem junto do progresso
  let notice = '';
  pool.onNotice = (m) => { notice = m; };
  // avisos que precisam chegar ao usuário no fim (ex.: áudio de um arquivo não entrou)
  const warn = (m: string) => { notice = m; opts.onWarning?.(m); };
  const rawReport = report;
  const reportN = (f: number, stage: string) => rawReport(f, notice ? `${stage} · ${notice}` : stage);
  try {
    await pool.preloadImages();
    if (signal?.aborted) throw abortErr();
    report(0.02, 'Mixando áudio');
    let audio: AudioBuffer | null = null;
    try {
      audio = await mixProjectAudio(p, assets, { signal, onProgress: (f) => report(0.02 + f * 0.06, 'Mixando áudio'), onWarning: (m) => warn(m) });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      console.warn('[export] falha ao mixar áudio, exportando sem som', e);
      warn('O áudio do projeto não pôde ser mixado: o vídeo sai sem som.');
    }
    if (signal?.aborted) throw abortErr();
    // 1) WebCodecs (rápido, quadro a quadro) — só se também souber codificar o áudio (ou não houver áudio)
    // 2) MediaRecorder em tempo real (Safari: MP4; Firefox: WebM) — mantém o som
    // 3) WebCodecs sem áudio, como último recurso
    const recorder = recorderMime(opts.format);
    if (hasWebCodecs()) {
      const needAudio = !!audio;
      const audioOk = !needAudio || !!(await pickAudio(opts.format === 'mp4' ? MP4_AUDIO : WEBM_AUDIO));
      if (audioOk || !recorder) {
        const blob = await encodeWithWebCodecs(p, pool, audioOk ? audio : null, opts, reportN);
        if (blob) return blob;
      }
    }
    if (recorder) return await encodeWithMediaRecorder(p, pool, audio, opts, reportN, recorder);
    throw new Error('Este navegador não consegue gerar vídeo (sem WebCodecs nem MediaRecorder). Use Chrome, Edge, Safari 16.4+ ou Firefox atualizados, ou baixe o projeto (.fcpxml) e as legendas (.srt).');
  } finally {
    pool.dispose();
  }
}

async function encodeWithWebCodecs(
  p: Project, pool: OfflineMediaPool | DecodedMediaPool, audio: AudioBuffer | null, opts: ExportOptions,
  report: (f: number, s: string) => void,
): Promise<Blob | null> {
  const { signal } = opts;
  const fps = exportFps(p, opts.fps);
  const duration = projectDuration(p);
  const format = opts.format;
  // tenta a qualidade pedida; se o encoder não aguentar (4K em aparelho fraco), desce um degrau
  let W = 0, H = 0;
  let v: Awaited<ReturnType<typeof pickVideo>> = null;
  const ladder = QUALITY_ORDER.slice(Math.max(0, QUALITY_ORDER.indexOf(opts.quality)));
  for (const q of ladder) {
    ({ width: W, height: H } = exportSize(p, q));
    v = await pickVideo(format === 'mp4' ? MP4_VIDEO : WEBM_VIDEO, W, H, fps, videoBitrate(W, H, fps, opts.speed), opts.speed, true);
    if (v) { if (q !== opts.quality) report(0.08, `Resolução reduzida para ${W}×${H} (limite do aparelho)`); break; }
  }
  if (!v) return null;
  const a = audio ? await pickAudio(format === 'mp4' ? MP4_AUDIO : WEBM_AUDIO) : null;

  let muxer: Mp4Muxer<Mp4Target> | WebmMuxer<WebmTarget>;
  if (format === 'mp4') {
    muxer = new Mp4Muxer({
      target: new Mp4Target(),
      video: { codec: v.choice.mux as 'avc' | 'vp9' | 'av1', width: W, height: H, frameRate: fps },
      audio: a ? { codec: a.choice.mux, numberOfChannels: 2, sampleRate: MIX_RATE } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
  } else {
    const vc = { vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1', avc: 'V_MPEG4/ISO/AVC' }[v.choice.mux];
    muxer = new WebmMuxer({
      target: new WebmTarget(),
      video: { codec: vc, width: W, height: H, frameRate: fps },
      audio: a ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: MIX_RATE } : undefined,
      firstTimestampBehavior: 'offset',
    });
  }

  let failure: unknown = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  venc.configure(v.config);
  const aenc = a
    ? new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } })
    : null;
  aenc?.configure(a!.config);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;

  const total = Math.max(1, Math.round(duration * fps));
  const frameUs = 1e6 / fps;
  const AUDIO_BLOCK = 4096;
  let audioPos = 0;
  const pushAudioUntil = (sec: number) => {
    if (!aenc || !audio) return;
    const until = Math.min(audio.length, Math.ceil(sec * MIX_RATE));
    while (audioPos < until) {
      const n = Math.min(AUDIO_BLOCK, until - audioPos);
      const data = new Float32Array(n * 2);
      data.set(audio.getChannelData(0).subarray(audioPos, audioPos + n), 0);
      data.set(audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0).subarray(audioPos, audioPos + n), n);
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: MIX_RATE, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((audioPos / MIX_RATE) * 1e6), data,
      });
      aenc.encode(ad);
      ad.close();
      audioPos += n;
    }
  };

  const keyEvery = Math.max(1, Math.round(fps * SPEED_PROFILE[opts.speed ?? 'equilibrado'].keyEvery));
  const progressEvery = Math.max(1, Math.round(fps / 4)); // ~0,25 s de vídeo
  const t0 = performance.now();
  /** ms acumulados por etapa (diagnóstico em __epExportStats) */
  const timing = { decode: 0, render: 0, encode: 0, wait: 0 };
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw abortErr();
      if (failure) throw failure;
      const t = i / fps;
      // (o encode do quadro anterior roda em paralelo enquanto este é decodificado/desenhado)
      const a0 = performance.now();
      await pool.prepare(framePlan(p, t));
      const a1 = performance.now();
      renderFrame(ctx, p, t, pool);
      const a2 = performance.now();
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs), alpha: 'discard' });
      venc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      pushAudioUntil((i + 1) / fps);
      const a3 = performance.now();
      while (venc.encodeQueueSize > 24) await new Promise((r) => setTimeout(r, 1));
      timing.decode += a1 - a0; timing.render += a2 - a1; timing.encode += a3 - a2; timing.wait += performance.now() - a3;
      if (i % progressEvery === 0 || i === total - 1) report(0.08 + 0.9 * ((i + 1) / total), `Renderizando quadro ${i + 1} de ${total}`);
    }
    const st = (pool as Partial<DecodedMediaPool>).stats;
    (globalThis as { __epExportStats?: unknown }).__epExportStats = { secs: (performance.now() - t0) / 1000, frames: total, encoder: v.config.codec, hardware: v.config.hardwareAcceleration ?? 'auto', decode: st ?? 'pool <video>', msPerFrame: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +(v / total).toFixed(2)])) };
    pushAudioUntil(duration);
    report(0.985, 'Finalizando arquivo');
    await venc.flush();
    if (aenc) await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (venc.state !== 'closed') venc.close();
    if (aenc && aenc.state !== 'closed') aenc.close();
  }
  const buf = (muxer.target as Mp4Target | WebmTarget).buffer;
  report(1, 'Pronto');
  return new Blob([buf], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

const MR_MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
const MR_WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** mimeType do MediaRecorder suportado, preferindo o formato pedido (null = sem MediaRecorder) */
export function recorderMime(format: ExportOptions['format']): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  const order = format === 'mp4' ? [...MR_MP4, ...MR_WEBM] : [...MR_WEBM, ...MR_MP4];
  const ok = order.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
  return ok ?? null;
}

/** o que este navegador vai usar para exportar no formato dado */
export async function detectExportPath(format: ExportOptions['format']): Promise<{ path: 'webcodecs' | 'mediarecorder' | 'none'; container: 'mp4' | 'webm' | null }> {
  if (hasWebCodecs()) {
    const v = await pickVideo(format === 'mp4' ? MP4_VIDEO : WEBM_VIDEO, 1280, 720, 30, 4e6);
    if (v) return { path: 'webcodecs', container: format };
  }
  const m = recorderMime(format);
  if (m) return { path: 'mediarecorder', container: m.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return { path: 'none', container: null };
}

/** fallback: grava o canvas + áudio mixado em tempo real (MP4 no Safari, WebM no Firefox/Chrome) */
async function encodeWithMediaRecorder(
  p: Project, pool: OfflineMediaPool | DecodedMediaPool, audio: AudioBuffer | null, opts: ExportOptions,
  report: (f: number, s: string) => void, mime: string,
): Promise<Blob> {
  const fps = exportFps(p, opts.fps);
  const { width: W, height: H } = exportSize(p, opts.quality === '4k' ? 'fhd' : opts.quality);
  const duration = projectDuration(p);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const stream = canvas.captureStream(fps);
  let actx: AudioContext | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  if (audio) {
    actx = new AudioContext({ sampleRate: MIX_RATE });
    await actx.resume().catch(() => {});
    const dest = actx.createMediaStreamDestination();
    srcNode = actx.createBufferSource();
    srcNode.buffer = audio;
    srcNode.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBitrate(W, H, fps) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  // primeiro quadro pronto antes de começar a gravar
  await pool.prepare(framePlan(p, 0));
  renderFrame(ctx, p, 0, pool);
  rec.start(250);
  const wall0 = performance.now();
  srcNode?.start();
  try {
    const total = Math.round(duration * fps);
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw abortErr();
      const t = i / fps;
      const due = wall0 + t * 1000;
      const now = performance.now();
      if (due > now) await new Promise((r) => setTimeout(r, due - now));
      // se atrasou, pula para o quadro do relógio (mantém áudio/vídeo em sincronia)
      const tt = Math.max(t, (performance.now() - wall0) / 1000);
      if (tt >= duration) break;
      await pool.prepare(framePlan(p, tt));
      renderFrame(ctx, p, tt, pool);
      report(0.08 + 0.9 * (tt / duration), 'Gravando em tempo real (modo compatível)');
    }
    const left = wall0 + duration * 1000 - performance.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    srcNode?.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    await stopped;
    await actx?.close();
  }
  if (opts.signal?.aborted) throw abortErr();
  report(1, 'Pronto');
  const type = (rec.mimeType || mime).startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  return new Blob(chunks, { type });
}
