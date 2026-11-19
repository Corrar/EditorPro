/* export de só áudio (WAV / M4A) e do quadro atual (PNG) */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { MediaAsset, Project, Seconds } from '../types';
import { renderFrame } from '../engine';
import { visualLayers, sourceTime } from '../engine/timing';
import { ensureProjectFonts } from '../engine/fonts';
import { mixProjectAudio, MIX_RATE } from './audioMix';
import { OfflineMediaPool } from './mediaPool';
import { exportSize, type ExportQuality } from './options';
import { encodeWAV } from './wav';

export interface AudioExportOptions {
  format: 'wav' | 'm4a';
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

/** M4A (AAC) é possível neste navegador? */
export async function canExportM4A(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    return !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: 192_000 })).supported;
  } catch { return false; }
}

export async function exportAudio(p: Project, assets: Record<string, MediaAsset>, opts: AudioExportOptions): Promise<Blob> {
  opts.onProgress?.(0, 'Mixando áudio');
  const buf = await mixProjectAudio(p, assets, { signal: opts.signal, onProgress: (f) => opts.onProgress?.(f * 0.7, 'Mixando áudio') });
  if (!buf) throw new Error('O projeto não tem áudio para exportar.');
  const chans = [buf.getChannelData(0), buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0)];
  if (opts.format === 'm4a' && (await canExportM4A())) {
    opts.onProgress?.(0.75, 'Codificando AAC');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'aac', numberOfChannels: 2, sampleRate: MIX_RATE }, fastStart: 'in-memory' });
    let failure: unknown = null;
    const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: 192_000 });
    const BLOCK = 4096;
    for (let pos = 0; pos < buf.length; pos += BLOCK) {
      if (opts.signal?.aborted) { enc.close(); throw new DOMException('Exportação cancelada', 'AbortError'); }
      const n = Math.min(BLOCK, buf.length - pos);
      const data = new Float32Array(n * 2);
      data.set(chans[0].subarray(pos, pos + n), 0);
      data.set(chans[1].subarray(pos, pos + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: MIX_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((pos / MIX_RATE) * 1e6), data });
      enc.encode(ad);
      ad.close();
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    muxer.finalize();
    opts.onProgress?.(1, 'Pronto');
    return new Blob([muxer.target.buffer], { type: 'audio/mp4' });
  }
  opts.onProgress?.(0.85, 'Gerando WAV');
  const wav = encodeWAV(chans, buf.sampleRate);
  opts.onProgress?.(1, 'Pronto');
  return new Blob([wav], { type: 'audio/wav' });
}

/** quadro do tempo t como PNG, na qualidade pedida */
export async function exportFrame(p: Project, assets: Record<string, MediaAsset>, t: Seconds, quality: ExportQuality = 'full'): Promise<Blob> {
  const { width, height } = exportSize(p, quality);
  const pool = new OfflineMediaPool(assets);
  try {
    try { await Promise.race([ensureProjectFonts(p), new Promise((r) => setTimeout(r, 8000))]); await document.fonts?.ready; } catch { /* ok */ }
    await pool.preloadImages();
    await pool.prepare(visualLayers(p, t)
      .filter((l) => l.clip.type === 'video' || (l.clip.type === 'image' && l.clip.removeBackground))
      .map((l) => ({ clip: l.clip, time: sourceTime(l.clip, t) })));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    renderFrame(canvas.getContext('2d')!, p, t, pool);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar PNG'))), 'image/png'));
  } finally {
    pool.dispose();
  }
}
