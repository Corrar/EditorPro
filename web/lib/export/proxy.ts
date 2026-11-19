/* =====================================================================
   PROXY DE PREVIEW: cópia leve (540p/720p, H.264, GOP curto) de um vídeo
   para o preview em tempo real. Celular decodificando 1080p/4K/HEVC e copiando
   cada quadro p/ o canvas é o que pesa; o proxy resolve. A original continua
   sendo usada no export.
   - demux: mp4box (MP4/MOV — o que celulares gravam)
   - vídeo: VideoDecoder → canvas (escala + rotação do celular) → VideoEncoder H.264
   - áudio: AAC copiado sem reencode (outros codecs: sem proxy → null)
   - GOP de 0,5 s: seek barato nos cortes
   Devolve null quando o navegador/arquivo não suporta (o preview usa a original).
   ===================================================================== */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { demuxMp4, decoderConfigFor, matrixRotation } from './demux';

export interface ProxyOptions {
  /** lado MENOR do proxy em px ("540p"/"720p"); nunca amplia */
  maxHeight?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** tamanho do proxy: lado menor = maxHeight (sem ampliar), dimensões pares */
export function proxySize(w: number, h: number, maxShort: number): { w: number; h: number } {
  const short = Math.min(w, h);
  const k = Math.min(1, maxShort / short);
  return { w: Math.max(2, Math.round((w * k) / 2) * 2), h: Math.max(2, Math.round((h * k) / 2) * 2) };
}

export { matrixRotation };

/** codec H.264 com nível suficiente p/ o tamanho */
export function avcCodecFor(w: number, h: number): string {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  // 3.1 (até 3600 MBs = 1280x720), 4.0 (8192 MBs = 1080p)
  return mbs <= 3600 ? 'avc1.42001f' : 'avc1.420028';
}

export function canMakeProxy(): boolean {
  return typeof window !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window && 'VideoFrame' in window;
}

function abortErr() {
  return new DOMException('Cancelado', 'AbortError');
}

/** motivo de não gerar proxy (fica no console p/ diagnóstico) */
function skip(reason: string): null {
  console.info('[proxy] sem proxy:', reason);
  return null;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function makePreviewProxy(file: Blob, opts: ProxyOptions = {}): Promise<Blob | null> {
  if (!canMakeProxy()) return skip('navegador sem WebCodecs');
  const { signal, onProgress } = opts;
  const maxShort = Math.max(144, Math.min(2160, opts.maxHeight ?? 540));
  /* ---------- demux ---------- */
  const dm = await demuxMp4(file);
  if (signal?.aborted) throw abortErr();
  if (!dm) return skip('arquivo não é MP4/MOV legível');
  const vt = dm.video;
  if (!vt || !vt.samples.length) return skip('sem trilha de vídeo');
  const at = dm.audio;
  if (at && !at.codec.startsWith('mp4a')) return skip(`áudio ${at.codec} (só AAC é copiado)`);
  const vSamples = vt.samples;
  const aSamples = at?.samples ?? [];
  const decCfg = await decoderConfigFor(vt);
  if (!decCfg) return skip(`decoder ${vt.codec} não suportado`);

  /* ---------- saída (rotação aplicada: o proxy já sai "em pé") ---------- */
  const rot = vt.rotation;
  const dispW = rot % 180 ? vt.height : vt.width;
  const dispH = rot % 180 ? vt.width : vt.height;
  const out = proxySize(dispW, dispH, maxShort);
  const durSec = vt.duration || vSamples[vSamples.length - 1].cts;
  const fps = Math.min(60, Math.max(10, Math.round(vSamples.length / Math.max(0.1, durSec))));
  const encCfg: VideoEncoderConfig = {
    codec: avcCodecFor(out.w, out.h), width: out.w, height: out.h,
    bitrate: maxShort >= 720 ? 4_000_000 : 2_500_000, framerate: fps,
    avc: { format: 'avc' }, latencyMode: 'quality',
  };
  if (!(await VideoEncoder.isConfigSupported(encCfg).catch(() => ({ supported: false }))).supported) return skip('encoder H.264 não suportado');

  const audioCfg = at ? { codec: at.codec, numberOfChannels: at.channels, sampleRate: at.sampleRate, description: at.description } : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: out.w, height: out.h, frameRate: fps },
    ...(audioCfg ? { audio: { codec: 'aac' as const, numberOfChannels: audioCfg.numberOfChannels, sampleRate: audioCfg.sampleRate } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const cv = new OffscreenCanvas(out.w, out.h);
  const cx = cv.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
  cx.imageSmoothingQuality = 'high';

  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(encCfg);
  const gop = Math.max(1, Math.round(fps / 2));
  let encoded = 0;
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        cx.save();
        cx.translate(out.w / 2, out.h / 2);
        cx.rotate((rot * Math.PI) / 180);
        const dw = rot % 180 ? out.h : out.w;
        const dh = rot % 180 ? out.w : out.h;
        cx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
        cx.restore();
        const vf = new VideoFrame(cv, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
        encoder.encode(vf, { keyFrame: encoded % gop === 0 });
        vf.close();
        encoded++;
      } catch (e) {
        failure = e;
      } finally {
        frame.close();
      }
    },
    error: (e) => { failure = e; },
  });
  decoder.configure(decCfg);

  try {
    for (let i = 0; i < vSamples.length; i++) {
      if (signal?.aborted) throw abortErr();
      if (failure) throw failure;
      const s = vSamples[i];
      decoder.decode(new EncodedVideoChunk({
        type: s.sync ? 'key' : 'delta', timestamp: Math.round(s.cts * 1e6), duration: Math.round(s.duration * 1e6), data: s.data,
      }));
      // contrapressão: não enfileira o arquivo inteiro na memória da GPU
      while (decoder.decodeQueueSize > 6 || encoder.encodeQueueSize > 6) {
        if (failure) throw failure;
        await tick();
      }
      if (i % 15 === 0) onProgress?.(Math.min(0.97, i / vSamples.length));
    }
    await decoder.flush();
    await encoder.flush();
    if (failure) throw failure;
    if (audioCfg) {
      let last = -1;
      for (const s of aSamples) {
        // priming do AAC (edit list) deixa as 1ªs amostras antes do 0: descarta / encosta no 0
        if (s.cts + s.duration <= 0) continue;
        const ts = Math.max(0, Math.round(s.cts * 1e6));
        if (ts <= last) continue;
        last = ts;
        muxer.addAudioChunkRaw(s.data, 'key', ts, Math.round(s.duration * 1e6), {
          decoderConfig: { codec: audioCfg.codec, numberOfChannels: audioCfg.numberOfChannels, sampleRate: audioCfg.sampleRate, description: audioCfg.description },
        });
      }
    }
    muxer.finalize();
    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    console.warn('[proxy] não foi possível gerar o proxy', e);
    return null;
  } finally {
    try { decoder.close(); } catch { /* já fechado */ }
    try { encoder.close(); } catch { /* já fechado */ }
  }
}

export interface VideoInfo { fps: number; codec: string; width: number; height: number; rotation: 0 | 90 | 180 | 270; duration: number }

/** lê só o cabeçalho (moov) de um MP4/MOV: fps médio, codec, tamanho e rotação. null se não for MP4 legível */
export async function probeVideoInfo(file: Blob): Promise<VideoInfo | null> {
  try {
    const MP4Box: Any = await import('mp4box');
    const mp4 = MP4Box.createFile(false);
    const info: Any = await new Promise((resolve, reject) => {
      mp4.onError = (e: unknown) => reject(new Error(String(e)));
      mp4.onReady = (i: Any) => resolve(i);
      // lê em pedaços até achar o moov (pode estar no fim do arquivo)
      void (async () => {
        const CH = 4 << 20;
        for (let off = 0; off < file.size; off += CH) {
          const ab = await file.slice(off, off + CH).arrayBuffer();
          const b = MP4Box.MP4BoxBuffer ? MP4Box.MP4BoxBuffer.fromArrayBuffer(ab, off) : Object.assign(ab, { fileStart: off });
          mp4.appendBuffer(b);
          if (mp4.readySent) return;
        }
        mp4.flush();
        resolve(null);
      })().catch(reject);
    });
    const vt = info?.videoTracks?.[0];
    if (!vt) return null;
    const dur = vt.duration && vt.timescale ? vt.duration / vt.timescale : 0;
    const rot = matrixRotation(vt.matrix);
    const w = vt.video?.width ?? 0, h = vt.video?.height ?? 0;
    return {
      fps: dur > 0 ? Math.round((vt.nb_samples / dur) * 100) / 100 : 0,
      codec: String(vt.codec), width: rot % 180 ? h : w, height: rot % 180 ? w : h, rotation: rot, duration: dur,
    };
  } catch {
    return null;
  }
}
