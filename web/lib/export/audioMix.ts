/* mixagem offline do áudio do projeto (OfflineAudioContext), respeitando cortes/in/speed/volume/fades/ducking */
import type { MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import { audibleClips, gainEnvelope } from '../engine/audio';
import { buildAudioChain, noiseGate, peakGain } from '../engine/audioFx';
import { curveOf, rateEnvelope, sourceSpan } from '../engine/speed';

/** recorta [from, from+dur) de um buffer (com reverso, portão de ruído e normalização opcionais) */
function segment(ctx: BaseAudioContext, buf: AudioBuffer, from: number, dur: number, opts: { reverse?: boolean; gate?: number; normalize?: number }): AudioBuffer | null {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(buf.length, Math.ceil((from + dur) * sr));
  if (b - a < 2) return null;
  const out = ctx.createBuffer(buf.numberOfChannels, b - a, sr);
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch).subarray(a, b);
    const dst = out.getChannelData(ch);
    if (opts.reverse) for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    else dst.set(src);
    chans.push(dst);
  }
  if (opts.gate) noiseGate(chans, sr, opts.gate);
  if (opts.normalize) {
    const g = peakGain(chans, opts.normalize);
    if (g !== 1) for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  return out;
}

export const MIX_RATE = 48000;

const bufferCache = new Map<string, Promise<AudioBuffer | null>>();

async function decodeAsset(asset: MediaAsset, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  const key = `${asset.id}:${asset.url}`;
  let p = bufferCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        if (!asset.url) return null;
        const res = await fetch(asset.url);
        const data = await res.arrayBuffer();
        return await ctx.decodeAudioData(data);
      } catch (e) {
        // vídeo sem trilha de áudio ou codec não suportado pelo navegador
        console.warn('[export] sem áudio decodificável em', asset.name, e);
        return null;
      }
    })();
    bufferCache.set(key, p);
  }
  return p;
}

/** renderiza o mix estéreo 48 kHz do projeto inteiro; null se não houver nenhum som */
export async function mixProjectAudio(
  p: Project,
  assets: Record<string, MediaAsset>,
  opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {},
): Promise<AudioBuffer | null> {
  const duration = projectDuration(p);
  const items = audibleClips(p, assets);
  if (!items.length || duration <= 0) return null;
  const length = Math.max(1, Math.ceil(duration * MIX_RATE));
  const ctx = new OfflineAudioContext(2, length, MIX_RATE);
  let any = false;
  let done = 0;
  for (const { clip, track, asset } of items) {
    if (opts.signal?.aborted) throw new DOMException('Exportação cancelada', 'AbortError');
    const buf = await decodeAsset(asset, ctx);
    done++;
    opts.onProgress?.(done / items.length);
    if (!buf) continue;
    if (clip.in >= buf.duration) continue;
    const span = Math.min(sourceSpan(clip), buf.duration - clip.in);
    const fx = clip.audioEffects ?? [];
    const amount = (k: string) => fx.find((e) => e.kind === k)?.amount;
    const seg = segment(ctx, buf, clip.in, span, {
      reverse: !!clip.reverse,
      gate: amount('noise-reduction'),
      normalize: amount('normalize'),
    });
    if (!seg) continue;
    const src = ctx.createBufferSource();
    src.buffer = seg;
    const start = Math.max(0, clip.start);
    if (curveOf(clip)) {
      const env = rateEnvelope(clip, 1 / 60);
      src.playbackRate.setValueAtTime(env[0].rate, start);
      for (const pt of env.slice(1)) src.playbackRate.linearRampToValueAtTime(pt.rate, Math.max(0, pt.t));
    } else src.playbackRate.value = clip.speed > 0 ? clip.speed : 1;
    const gain = ctx.createGain();
    const env = gainEnvelope(p, track, clip, 1 / 60);
    gain.gain.setValueAtTime(env[0]?.g ?? 0, start);
    for (const pt of env.slice(1)) gain.gain.linearRampToValueAtTime(pt.g, Math.max(0, pt.t));
    const chain = buildAudioChain(ctx, fx, clip.pitch, start);
    if (chain) { src.connect(chain.input); chain.output.connect(gain); } else src.connect(gain);
    gain.connect(ctx.destination);
    src.start(start, 0);
    src.stop(start + clip.duration);
    any = true;
  }
  if (!any) return null;
  return ctx.startRendering();
}
