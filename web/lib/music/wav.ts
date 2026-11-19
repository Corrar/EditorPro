/* Música · PCM → WAV (puro). Reaproveita o codificador do projeto. */
import { encodeWav } from '../media/wav';
import { renderMusicPCM, type RenderOptions } from './engine';
import type { MusicTrack } from './catalog';

/** WAV 16-bit estéreo da faixa (síncrono — use num worker ou em testes) */
export function musicWav(track: string | MusicTrack, opts: RenderOptions): ArrayBuffer {
  const sr = opts.sampleRate ?? 44100;
  return encodeWav(renderMusicPCM(track, { ...opts, sampleRate: sr }), sr);
}
