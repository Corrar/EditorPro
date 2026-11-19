/* =====================================================================
   Demux MP4/MOV (mp4box) compartilhado pelo proxy de preview e pelo export
   rápido: trilha de vídeo (config do VideoDecoder + amostras em ordem de
   decodificação) e trilha de áudio AAC (p/ cópia sem reencode).
   ===================================================================== */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface DemuxSample {
  /** tempos em segundos */
  cts: number;
  dts: number;
  duration: number;
  sync: boolean;
  data: Uint8Array;
  /** tempos crus na escala da trilha (p/ timestamps exatos) */
  rawCts: number;
  rawDuration: number;
}

export interface DemuxTrack {
  id: number;
  codec: string;
  timescale: number;
  duration: number;
  samples: DemuxSample[];
}

export interface DemuxVideo extends DemuxTrack {
  width: number;
  height: number;
  /** rotação de exibição (matriz do tkhd), como o <video> aplica */
  rotation: 0 | 90 | 180 | 270;
  description?: Uint8Array;
}

export interface DemuxAudio extends DemuxTrack {
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig (AAC) */
  description?: Uint8Array;
}

export interface Demuxed { video: DemuxVideo | null; audio: DemuxAudio | null }

/** rotação (0/90/180/270) da matriz do tkhd (16.16) */
export function matrixRotation(m: ArrayLike<number> | undefined): 0 | 90 | 180 | 270 {
  if (!m || m.length < 4) return 0;
  const deg = (Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) + 360) % 360;
  return ((Math.round(deg / 90) * 90) % 360) as 0 | 90 | 180 | 270;
}

const toSample = (s: Any, ts: number, shift: number): DemuxSample => ({
  cts: s.cts / ts + shift, dts: s.dts / ts + shift, duration: s.duration / ts, sync: !!s.is_sync, data: s.data, rawCts: s.cts, rawDuration: s.duration,
});

/**
 * Deslocamento (s) do edit list (elst) da trilha, como o <video> aplica: vídeo com
 * B-frames costuma ter media_time = 2 quadros (o 1º quadro exibido tem cts > 0);
 * edição vazia inicial atrasa a trilha.
 */
export function editListShift(entries: { segment_duration: number; media_time: number }[] | undefined, trackTimescale: number, movieTimescale: number): number {
  if (!entries?.length) return 0;
  let delay = 0;
  for (const e of entries) {
    if (e.media_time === -1 || e.media_time === 0xffffffff) { delay += e.segment_duration / (movieTimescale || 1); continue; }
    return delay - e.media_time / (trackTimescale || 1);
  }
  return delay;
}

/** demux completo de um MP4/MOV; null se não for legível */
export async function demuxMp4(file: Blob, opts: { audio?: boolean } = {}): Promise<Demuxed | null> {
  const MP4Box: Any = await import('mp4box');
  const buf = await file.arrayBuffer();
  const mp4 = MP4Box.createFile();
  const vRaw: Any[] = [];
  const aRaw: Any[] = [];
  let vId = -1, aId = -1;
  const info: Any = await new Promise((resolve, reject) => {
    mp4.onError = (e: unknown) => reject(new Error(String(e)));
    // a extração precisa ser configurada DENTRO do onReady (antes do mdat ser processado)
    mp4.onReady = (i: Any) => {
      const v = i.videoTracks?.[0];
      const a = opts.audio !== false ? i.audioTracks?.[0] : undefined;
      if (v) { vId = v.id; mp4.setExtractionOptions(v.id, null, { nbSamples: 1000 }); }
      if (a) { aId = a.id; mp4.setExtractionOptions(a.id, null, { nbSamples: 1000 }); }
      mp4.onSamples = (id: number, _u: unknown, samples: Any[]) => { (id === vId ? vRaw : aRaw).push(...samples); };
      mp4.start();
      resolve(i);
    };
    const ab = MP4Box.MP4BoxBuffer ? MP4Box.MP4BoxBuffer.fromArrayBuffer(buf, 0) : Object.assign(buf, { fileStart: 0 });
    mp4.appendBuffer(ab);
    mp4.flush();
    // arquivo sem moov legível: onReady nunca vem
    setTimeout(() => resolve(null), 0);
  }).catch(() => null);
  if (!info) return null;

  let video: DemuxVideo | null = null;
  const vt = info.videoTracks?.[0];
  if (vt && vRaw.length) {
    const trak = mp4.getTrackById(vt.id);
    const entry: Any = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const box = entry?.avcC ?? entry?.hvcC ?? entry?.vpcC ?? entry?.av1C;
    let description: Uint8Array | undefined;
    if (box) {
      const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN ?? 1);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8); // pula o cabeçalho da caixa
    }
    const ts: number = vt.timescale;
    const shift = editListShift(trak?.edts?.elst?.entries, ts, info.timescale);
    video = {
      id: vt.id, codec: String(vt.codec), timescale: ts, duration: vt.duration ? vt.duration / ts : 0,
      width: vt.video?.width ?? entry?.width, height: vt.video?.height ?? entry?.height,
      rotation: matrixRotation(vt.matrix ?? trak?.tkhd?.matrix), description,
      samples: vRaw.map((s) => toSample(s, ts, shift)),
    };
  }
  let audio: DemuxAudio | null = null;
  const at = info.audioTracks?.find((x: Any) => x.id === aId);
  if (at && aRaw.length) {
    const aTrak = mp4.getTrackById(at.id);
    const aEntry: Any = aTrak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const ts: number = at.timescale;
    const shift = editListShift(aTrak?.edts?.elst?.entries, ts, info.timescale);
    audio = {
      id: at.id, codec: String(at.codec), timescale: ts, duration: at.duration ? at.duration / ts : 0,
      sampleRate: at.audio?.sample_rate ?? 44100, channels: at.audio?.channel_count ?? 2,
      description: aEntry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data,
      samples: aRaw.map((s) => toSample(s, ts, shift)),
    };
  }
  mp4.stop?.();
  return { video, audio };
}

/** config do VideoDecoder p/ a trilha (tenta hardware; null se o navegador não decodifica) */
export async function decoderConfigFor(v: DemuxVideo): Promise<VideoDecoderConfig | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  const cfg: VideoDecoderConfig = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description, hardwareAcceleration: 'prefer-hardware' };
  const ok = async (c: VideoDecoderConfig) => (await VideoDecoder.isConfigSupported(c).catch(() => ({ supported: false }))).supported;
  if (await ok(cfg)) return cfg;
  delete cfg.hardwareAcceleration;
  return (await ok(cfg)) ? cfg : null;
}

/* ---------- lógica pura de busca (testada) ---------- */

/**
 * Índice (ordem de decodificação) da amostra-chave a partir da qual decodificar p/ mostrar
 * o tempo t: a última chave com cts ≤ t (vídeos com B-frames: chaves também são as primeiras
 * na ordem de apresentação do seu GOP).
 */
export function keyIndexFor(samples: Pick<DemuxSample, 'cts' | 'sync'>[], t: number): number {
  let best = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].sync) continue;
    if (samples[i].cts <= t + 1e-6) best = i;
    else break;
  }
  return best;
}

/**
 * Quadro mostrado no tempo t (mesma regra do seek do <video>): o de maior timestamp ≤ t.
 * `ts` em ordem crescente. Antes do 1º quadro → 0. -1 se vazio.
 */
export function frameIndexAt(ts: number[], t: number): number {
  if (!ts.length) return -1;
  let lo = 0, hi = ts.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
