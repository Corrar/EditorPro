/* =====================================================================
   Pool de mídia do EXPORT RÁPIDO: em vez de buscar (seek) um <video> a cada
   quadro — 20–100 ms por quadro no celular —, decodifica cada clipe em
   sequência com WebCodecs (demux mp4box → VideoDecoder) e entrega o quadro
   de timestamp mais próximo ≤ t. Seek de verdade só no começo do clipe
   (chave anterior ao ponto de entrada) ou num salto grande.
   O que não dá para decodificar assim (WebM, codec sem suporte, reverso,
   remover fundo) cai automaticamente no pool de <video> (OfflineMediaPool).
   ===================================================================== */
import type { Clip, MediaAsset, VideoClip } from '../types';
import type { MediaElement, MediaSources } from '../engine';
import { OfflineMediaPool } from './mediaPool';
import { demuxMp4, decoderConfigFor, keyIndexFor, type DemuxVideo } from './demux';

/** salto à frente maior que isto reinicia na chave mais próxima em vez de decodificar tudo */
const JUMP_RESEEK = 3;

/** o clipe pode ir pelo decodificador sequencial? (null = sim; senão, o motivo do fallback) */
export function decodeFallbackReason(clip: Clip, asset: MediaAsset | undefined): string | null {
  if (clip.type !== 'video') return 'não é vídeo';
  if (!asset?.url) return 'sem mídia';
  if (clip.reverse) return 'reverso';
  if (clip.removeBackground) return 'remover fundo';
  const mime = (asset.mime || '').toLowerCase();
  if (mime && !/mp4|quicktime|mov|m4v|3gp/.test(mime)) return 'contêiner não-MP4';
  return null;
}

interface Track { v: DemuxVideo; cfg: VideoDecoderConfig }

/** decodificador sequencial de UM clipe */
class ClipDecoder {
  private dec: VideoDecoder | null = null;
  private next = 0; // próxima amostra (ordem de decodificação) a enviar
  private queue: VideoFrame[] = [];
  private current: VideoFrame | null = null;
  private flushed = false;
  private failure: unknown = null;
  private wake: (() => void) | null = null;
  constructor(private track: Track) {}

  private start(t: number) {
    this.close(false);
    this.dec = new VideoDecoder({
      output: (f) => {
        // mantém em ordem de apresentação
        let i = this.queue.length;
        while (i > 0 && this.queue[i - 1].timestamp > f.timestamp) i--;
        this.queue.splice(i, 0, f);
        this.wake?.();
      },
      error: (e) => { this.failure = e; this.wake?.(); },
    });
    this.dec.configure(this.track.cfg);
    this.next = keyIndexFor(this.track.v.samples, t);
    this.flushed = false;
  }

  private waitOutput(): Promise<void> {
    return new Promise((r) => {
      const dec = this.dec;
      const done = () => { this.wake = null; clearTimeout(timer); dec?.removeEventListener?.('dequeue', done); r(); };
      this.wake = done;
      const timer = setTimeout(done, 50);
      dec?.addEventListener?.('dequeue', done);
    });
  }

  /** quadro exibido no tempo de origem t (segundos) — válido até a próxima chamada */
  async frameAt(t: number): Promise<VideoFrame | null> {
    const us = t * 1e6 + 1; // tolerância de 1 µs
    const samples = this.track.v.samples;
    const fed = samples[Math.max(0, this.next - 1)]?.cts ?? 0;
    const back = this.current && us < this.current.timestamp - 1 && this.current.timestamp > samples[keyIndexFor(samples, t)].cts * 1e6;
    if (!this.dec || back || t - fed > JUMP_RESEEK) this.start(t);
    const dec = this.dec!;
    for (;;) {
      if (this.failure) throw this.failure;
      // avança: o quadro atual passa a ser o último decodificado com timestamp ≤ t
      while (this.queue.length && this.queue[0].timestamp <= us) {
        const f = this.queue.shift()!;
        this.current?.close();
        this.current = f;
      }
      // decidido quando já existe quadro posterior a t (ou o vídeo acabou)
      if (this.queue.length || (this.flushed && dec.decodeQueueSize === 0)) break;
      if (this.next < samples.length && dec.decodeQueueSize < 6) {
        const s = samples[this.next++];
        dec.decode(new EncodedVideoChunk({ type: s.sync ? 'key' : 'delta', timestamp: Math.round(s.cts * 1e6), duration: Math.round(s.duration * 1e6), data: s.data }));
        continue;
      }
      if (this.next >= samples.length && !this.flushed) {
        this.flushed = true;
        await dec.flush().catch((e) => { this.failure = e; });
        continue;
      }
      await this.waitOutput();
    }
    // antes do 1º quadro: mostra o 1º (como o <video>)
    if (!this.current && this.queue.length) this.current = this.queue.shift()!;
    return this.current;
  }

  close(_all = true) {
    for (const f of this.queue) f.close();
    this.queue = [];
    this.current?.close();
    this.current = null;
    try { if (this.dec && this.dec.state !== 'closed') this.dec.close(); } catch { /* já fechado */ }
    this.dec = null;
  }
}

/** quadro decodificado + rotação, pronto p/ desenhar (canvas só quando há rotação) */
class FrameSurface {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  source(frame: VideoFrame, rot: number): MediaElement {
    if (!rot) return frame;
    const w = rot % 180 ? frame.displayHeight : frame.displayWidth;
    const h = rot % 180 ? frame.displayWidth : frame.displayHeight;
    if (!this.canvas) this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const cx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    cx.save();
    cx.translate(w / 2, h / 2);
    cx.rotate((rot * Math.PI) / 180);
    cx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2);
    cx.restore();
    return this.canvas;
  }
}

export interface DecodeStats { decodedClips: number; fallbackClips: number; reasons: Record<string, number> }

export class DecodedMediaPool implements MediaSources {
  readonly offline = true;
  private fallback: OfflineMediaPool;
  private tracks = new Map<string, Promise<Track | null>>();
  private decoders = new Map<string, ClipDecoder>();
  private surfaces = new Map<string, FrameSurface>();
  private frames = new Map<string, MediaElement>();
  private rotations = new Map<string, number>();
  private useFallback = new Set<string>();
  readonly stats: DecodeStats = { decodedClips: 0, fallbackClips: 0, reasons: {} };
  constructor(private assets: Record<string, MediaAsset>) {
    this.fallback = new OfflineMediaPool(assets);
  }

  preloadImages() { return this.fallback.preloadImages(); }

  get(assetId: string) { return this.fallback.get(assetId); }

  getForClip(clip: Clip): MediaElement | undefined {
    return this.frames.get(clip.id) ?? this.fallback.getForClip(clip);
  }

  /** demux + config do decoder por asset (uma vez); null = não decodificável aqui */
  private track(asset: MediaAsset): Promise<Track | null> {
    let p = this.tracks.get(asset.id);
    if (!p) {
      p = (async () => {
        try {
          const blob = await (await fetch(asset.url!)).blob();
          const dm = await demuxMp4(blob, { audio: false });
          if (!dm?.video?.samples.length) return null;
          const cfg = await decoderConfigFor(dm.video);
          return cfg ? { v: dm.video, cfg } : null;
        } catch { return null; }
      })();
      this.tracks.set(asset.id, p);
    }
    return p;
  }

  private fall(clip: Clip, reason: string) {
    if (!this.useFallback.has(clip.id)) {
      this.useFallback.add(clip.id);
      this.stats.fallbackClips++;
      this.stats.reasons[reason] = (this.stats.reasons[reason] ?? 0) + 1;
    }
  }

  async prepare(items: { clip: Clip; time: number }[]): Promise<void> {
    const wanted = new Set(items.map((x) => x.clip.id));
    for (const [id, d] of this.decoders) if (!wanted.has(id)) { d.close(); this.decoders.delete(id); this.frames.delete(id); }
    const toFallback: { clip: Clip; time: number }[] = [];
    await Promise.all(items.map(async (it) => {
      const clip = it.clip;
      if (clip.type !== 'video' || this.useFallback.has(clip.id)) { toFallback.push(it); return; }
      const asset = this.assets[clip.assetId];
      const why = decodeFallbackReason(clip, asset);
      if (why) { this.fall(clip, why); toFallback.push(it); return; }
      const tr = await this.track(asset!);
      if (!tr) { this.fall(clip, 'demux/codec'); toFallback.push(it); return; }
      let d = this.decoders.get(clip.id);
      if (!d) { d = new ClipDecoder(tr); this.decoders.set(clip.id, d); this.rotations.set(clip.id, tr.v.rotation); this.stats.decodedClips++; }
      try {
        const dur = tr.v.duration || asset!.duration;
        const f = await d.frameAt(Math.max(0, Math.min(it.time, Math.max(0, dur - 0.001))));
        if (f) {
          let s = this.surfaces.get(clip.id);
          if (!s) { s = new FrameSurface(); this.surfaces.set(clip.id, s); }
          this.frames.set(clip.id, s.source(f, this.rotations.get(clip.id) ?? 0));
        }
      } catch (e) {
        console.warn('[export] decodificador falhou, usando <video>', e);
        d.close();
        this.decoders.delete(clip.id);
        this.frames.delete(clip.id);
        this.fall(clip as VideoClip, 'erro no decoder');
        toFallback.push(it);
      }
    }));
    await this.fallback.prepare(toFallback);
  }

  dispose() {
    for (const d of this.decoders.values()) d.close();
    this.decoders.clear();
    this.frames.clear();
    this.fallback.dispose();
  }
}
