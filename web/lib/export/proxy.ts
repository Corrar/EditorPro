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

export interface ProxyOptions {
  /** lado MENOR do proxy em px ("540p"/"720p"); nunca amplia */
  maxHeight?: 540 | 720;
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

/** rotação (0/90/180/270) da matriz do tkhd (16.16) */
export function matrixRotation(m: ArrayLike<number> | undefined): 0 | 90 | 180 | 270 {
  if (!m || m.length < 4) return 0;
  const deg = (Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) + 360) % 360;
  const snapped = (Math.round(deg / 90) * 90) % 360;
  return snapped as 0 | 90 | 180 | 270;
}

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
  const maxShort = opts.maxHeight ?? 540;
  const MP4Box: Any = await import('mp4box');

  /* ---------- demux ---------- */
  const buf = await file.arrayBuffer();
  if (signal?.aborted) throw abortErr();
  const mp4 = MP4Box.createFile();
  const vSamples: Any[] = [];
  const aSamples: Any[] = [];
  let vId = -1;
  // a extração precisa ser configurada DENTRO do onReady (antes do mdat ser processado)
  const info: Any = await new Promise((resolve, reject) => {
    mp4.onError = (e: unknown) => reject(new Error(String(e)));
    mp4.onReady = (i: Any) => {
      const v = i.videoTracks?.[0];
      const a = i.audioTracks?.[0];
      if (v) { vId = v.id; mp4.setExtractionOptions(v.id, null, { nbSamples: 500 }); }
      if (a && String(a.codec).startsWith('mp4a')) mp4.setExtractionOptions(a.id, null, { nbSamples: 500 });
      mp4.onSamples = (id: number, _u: unknown, samples: Any[]) => { (id === vId ? vSamples : aSamples).push(...samples); };
      mp4.start();
      resolve(i);
    };
    const ab = MP4Box.MP4BoxBuffer ? MP4Box.MP4BoxBuffer.fromArrayBuffer(buf, 0) : Object.assign(buf, { fileStart: 0 });
    mp4.appendBuffer(ab);
    mp4.flush();
  }).catch((e) => { console.info('[proxy]', e); return null; });
  if (!info) return skip('arquivo não é MP4/MOV legível');
  const vt = info.videoTracks?.[0];
  if (!vt) return skip('sem trilha de vídeo');
  const at = info.audioTracks?.[0];
  if (at && !String(at.codec).startsWith('mp4a')) return skip(`áudio ${at.codec} (só AAC é copiado)`);
  if (!vSamples.length) return skip('sem amostras de vídeo');

  /* ---------- config do decoder ---------- */
  const trak = mp4.getTrackById(vt.id);
  const entry: Any = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  const box = entry?.avcC ?? entry?.hvcC ?? entry?.vpcC ?? entry?.av1C;
  let description: Uint8Array | undefined;
  if (box) {
    const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN ?? 1);
    box.write(ds);
    description = new Uint8Array(ds.buffer, 8); // pula o cabeçalho da caixa
  }
  const srcW: number = vt.video?.width ?? entry?.width;
  const srcH: number = vt.video?.height ?? entry?.height;
  const decCfg: VideoDecoderConfig = { codec: vt.codec, codedWidth: srcW, codedHeight: srcH, description, hardwareAcceleration: 'prefer-hardware' };
  if (!(await VideoDecoder.isConfigSupported(decCfg).catch(() => ({ supported: false }))).supported) {
    delete decCfg.hardwareAcceleration;
    if (!(await VideoDecoder.isConfigSupported(decCfg).catch(() => ({ supported: false }))).supported) return skip(`decoder ${vt.codec} não suportado`);
  }

  /* ---------- saída (rotação aplicada: o proxy já sai "em pé") ---------- */
  const rot = matrixRotation(vt.matrix ?? trak?.tkhd?.matrix);
  const dispW = rot % 180 ? srcH : srcW;
  const dispH = rot % 180 ? srcW : srcH;
  const out = proxySize(dispW, dispH, maxShort);
  const timescale: number = vt.timescale;
  const durSec = vt.duration && timescale ? vt.duration / timescale : vSamples.at(-1).cts / timescale;
  const fps = Math.min(60, Math.max(10, Math.round(vSamples.length / Math.max(0.1, durSec))));
  const encCfg: VideoEncoderConfig = {
    codec: avcCodecFor(out.w, out.h), width: out.w, height: out.h,
    bitrate: maxShort >= 720 ? 4_000_000 : 2_500_000, framerate: fps,
    avc: { format: 'avc' }, latencyMode: 'quality',
  };
  if (!(await VideoEncoder.isConfigSupported(encCfg).catch(() => ({ supported: false }))).supported) return skip('encoder H.264 não suportado');

  let audioCfg: { codec: string; numberOfChannels: number; sampleRate: number; description?: Uint8Array } | null = null;
  if (at) {
    const aTrak = mp4.getTrackById(at.id);
    const aEntry: Any = aTrak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const asc: Uint8Array | undefined = aEntry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
    audioCfg = { codec: at.codec, numberOfChannels: at.audio?.channel_count ?? 2, sampleRate: at.audio?.sample_rate ?? 44100, description: asc };
  }

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
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round((s.cts * 1e6) / timescale),
        duration: Math.round((s.duration * 1e6) / timescale),
        data: s.data,
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
      const ats: number = at.timescale;
      for (const s of aSamples) {
        muxer.addAudioChunkRaw(s.data, 'key', Math.round((s.cts * 1e6) / ats), Math.round((s.duration * 1e6) / ats), {
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
    mp4.stop?.();
  }
}
