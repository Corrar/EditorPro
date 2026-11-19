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

/* ---------- índice sob demanda (export: não carrega o arquivo inteiro na memória) ---------- */

/** amostra só com posição no arquivo; os bytes são lidos sob demanda (Blob.slice) */
export interface SampleRef {
  cts: number;
  dts: number;
  duration: number;
  sync: boolean;
  offset: number;
  size: number;
  /** bytes já carregados (índice completo, ex.: fallback do demux em memória) */
  data?: Uint8Array;
}

export interface VideoIndex {
  codec: string;
  width: number;
  height: number;
  duration: number;
  rotation: 0 | 90 | 180 | 270;
  description?: Uint8Array;
  samples: SampleRef[];
}

function boxDescription(MP4Box: Any, entry: Any): Uint8Array | undefined {
  const box = entry?.avcC ?? entry?.hvcC ?? entry?.vpcC ?? entry?.av1C;
  if (!box) return undefined;
  const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN ?? 1);
  box.write(ds);
  return new Uint8Array(ds.buffer, 8);
}

/**
 * Lê só as caixas de cabeçalho (moov) do MP4/MOV em blocos de 4 MB — pulando o mdat
 * (celulares gravam o moov no fim) — e devolve a tabela de amostras de vídeo com
 * offset/tamanho. Arquivo de 500 MB = poucos MB de memória. null se não indexável
 * (sem moov, MP4 fragmentado sem amostras no moov, sem vídeo).
 */
export interface AudioIndex {
  codec: string;
  sampleRate: number;
  channels: number;
  duration: number;
  /** AudioSpecificConfig (AAC) */
  description?: Uint8Array;
  samples: SampleRef[];
}

export interface Mp4Index {
  video: VideoIndex | null;
  audio: AudioIndex | null;
  /** o arquivo declara trilha de áudio (mesmo que não indexável) */
  hasAudioTrack: boolean;
}

function refsOf(mp4: Any, track: Any, movieTs: number, fileSize: number): SampleRef[] | null {
  const trak = mp4.getTrackById(track.id);
  const raw: Any[] = mp4.getTrackSamplesInfo?.(track.id) ?? trak?.samples ?? [];
  if (!raw.length) return null;
  const ts: number = track.timescale;
  const shift = editListShift(trak?.edts?.elst?.entries, ts, movieTs);
  const samples: SampleRef[] = raw.map((x) => ({
    cts: x.cts / ts + shift, dts: x.dts / ts + shift, duration: x.duration / ts, sync: !!x.is_sync, offset: x.offset, size: x.size,
  }));
  if (samples.some((x) => !(x.size > 0) || !(x.offset >= 0) || x.offset + x.size > fileSize)) return null;
  return samples;
}

/**
 * Lê só as caixas de cabeçalho (moov) do MP4/MOV em blocos de 4 MB — pulando o mdat
 * (celulares gravam o moov no fim) — e devolve as tabelas de amostras (vídeo e áudio) com
 * offset/tamanho. Arquivo de 500 MB = poucos MB de memória. null se não for MP4 legível.
 */
export async function indexMp4(file: Blob, chunk = 4 << 20): Promise<Mp4Index | null> {
  const MP4Box: Any = await import('mp4box');
  const mp4 = MP4Box.createFile();
  let info: Any = null;
  let failed = false;
  mp4.onReady = (i: Any) => { info = i; };
  mp4.onError = () => { failed = true; };
  let pos = 0;
  let guard = 0;
  try {
    while (!info && !failed && pos < file.size && guard++ < 4096) {
      const end = Math.min(file.size, pos + chunk);
      const ab = await file.slice(pos, end).arrayBuffer();
      const buf = MP4Box.MP4BoxBuffer ? MP4Box.MP4BoxBuffer.fromArrayBuffer(ab, pos) : Object.assign(ab, { fileStart: pos });
      const next = mp4.appendBuffer(buf, end >= file.size);
      pos = typeof next === 'number' && next > pos ? next : end;
    }
    if (!info && !failed) mp4.flush();
  } catch { return null; }
  if (!info || failed) return null;
  let video: VideoIndex | null = null;
  const vt = info.videoTracks?.[0];
  if (vt) {
    const samples = refsOf(mp4, vt, info.timescale, file.size);
    const trak = mp4.getTrackById(vt.id);
    const entry: Any = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (samples) video = {
      codec: String(vt.codec), width: vt.video?.width ?? entry?.width, height: vt.video?.height ?? entry?.height,
      duration: vt.duration ? vt.duration / vt.timescale : 0, rotation: matrixRotation(vt.matrix ?? trak?.tkhd?.matrix),
      description: boxDescription(MP4Box, entry), samples,
    };
  }
  let audio: AudioIndex | null = null;
  const at = info.audioTracks?.[0];
  if (at) {
    const samples = refsOf(mp4, at, info.timescale, file.size);
    const entry: Any = mp4.getTrackById(at.id)?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (samples) audio = {
      codec: String(at.codec), sampleRate: at.audio?.sample_rate ?? 44100, channels: at.audio?.channel_count ?? 2,
      duration: at.duration ? at.duration / at.timescale : 0, description: entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data, samples,
    };
  }
  mp4.stop?.();
  return { video, audio, hasAudioTrack: !!at };
}

/** demux em memória → mesmo formato do índice (bytes já carregados); fallback p/ MP4 fragmentado */
export function demuxedToIndex(dm: Demuxed): Mp4Index {
  const ref = (x: DemuxSample): SampleRef => ({ cts: x.cts, dts: x.dts, duration: x.duration, sync: x.sync, offset: 0, size: x.data.byteLength, data: x.data });
  return {
    video: dm.video ? { codec: dm.video.codec, width: dm.video.width, height: dm.video.height, duration: dm.video.duration, rotation: dm.video.rotation, description: dm.video.description, samples: dm.video.samples.map(ref) } : null,
    audio: dm.audio ? { codec: dm.audio.codec, sampleRate: dm.audio.sampleRate, channels: dm.audio.channels, duration: dm.audio.duration, description: dm.audio.description, samples: dm.audio.samples.map(ref) } : null,
    hasAudioTrack: !!dm.audio,
  };
}

/** só a trilha de vídeo (export) */
export async function indexMp4Video(file: Blob, chunk = 4 << 20): Promise<VideoIndex | null> {
  return (await indexMp4(file, chunk))?.video ?? null;
}

/**
 * Bytes das amostras lidos sob demanda do Blob (janela de ~48 amostras por vez) e
 * liberados assim que são consumidos: memória ~constante mesmo com arquivo de 500 MB.
 */
export class SampleReader {
  private data = new Map<number, Uint8Array>();
  private loading: Promise<void> | null = null;
  failure: unknown = null;
  constructor(private blob: Blob, private samples: SampleRef[]) {}

  has(i: number) { return !!this.samples[i]?.data || this.data.has(i); }

  /** bytes da amostra i (e libera a memória dela) */
  take(i: number): Uint8Array {
    const pre = this.samples[i].data;
    if (pre) return pre;
    const d = this.data.get(i)!;
    this.data.delete(i);
    return d;
  }

  /** carrega a janela a partir de i (se ainda não estiver carregando) */
  load(i: number): Promise<void> {
    if (this.loading) return this.loading;
    let from = i;
    while (from < this.samples.length && this.has(from)) from++;
    const plan = readPlan(this.samples, from);
    if (!plan) return Promise.resolve();
    this.loading = (async () => {
      const buf = new Uint8Array(await this.blob.slice(plan.start, plan.end).arrayBuffer());
      for (let k = plan.from; k < plan.to; k++) {
        const s = this.samples[k];
        // cópia própria: libera o trecho inteiro (com o outro fluxo intercalado) quando a janela acaba
        this.data.set(k, buf.slice(s.offset - plan.start, s.offset - plan.start + s.size));
      }
    })().catch((e) => { this.failure = e; }).finally(() => { this.loading = null; });
    return this.loading;
  }

  /** lê (se preciso) e entrega a amostra i */
  async get(i: number): Promise<Uint8Array> {
    while (!this.has(i)) {
      await this.load(i);
      if (this.failure) throw this.failure;
    }
    return this.take(i);
  }

  /** descarta o que foi carregado (seek p/ outro ponto) */
  reset() { this.data.clear(); }
}

/**
 * Plano de leitura sob demanda: a partir da amostra `from`, até `max` amostras cujos bytes caibam
 * num único trecho contíguo de até `maxBytes` (o vídeo vem intercalado com o áudio no mdat; o trecho
 * inclui esses bytes, tudo bem). Devolve [início, fim) em índices e o intervalo de bytes.
 */
export function readPlan(samples: Pick<SampleRef, 'offset' | 'size' | 'data'>[], from: number, max = 48, maxBytes = 16 << 20): { from: number; to: number; start: number; end: number } | null {
  if (from >= samples.length) return null;
  let start = Infinity, end = -Infinity, to = from;
  for (let i = from; i < samples.length && i - from < max; i++) {
    const s = samples[i];
    if (s.data) break; // já carregada (from é sempre uma não carregada)
    const ns = Math.min(start, s.offset), ne = Math.max(end, s.offset + s.size);
    if (i > from && ne - ns > maxBytes) break;
    start = ns; end = ne; to = i + 1;
  }
  if (!(end > start)) return null;
  return { from, to, start, end };
}

/** config do VideoDecoder p/ a trilha (tenta hardware; null se o navegador não decodifica) */
export async function decoderConfigFor(v: Pick<DemuxVideo, 'codec' | 'width' | 'height' | 'description'>): Promise<VideoDecoderConfig | null> {
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
