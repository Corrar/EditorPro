/* mixagem offline do áudio do projeto (OfflineAudioContext), respeitando cortes/in/speed/volume/fades/ducking */
import type { MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import { audibleClips, gainEnvelope } from '../engine/audio';
import { buildAudioChain, noiseGate, peakGain } from '../engine/audioFx';
import { curveOf, sourceOffset, sourceSpan } from '../engine/speed';
import { wsola } from './timeStretch';
import { decodeAudioRange, type FullDecodeCache } from './audioDecode';

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

type Speedy = Parameters<typeof sourceOffset>[0];

/** o clipe toca fora de 1x (constante ou curva)? */
export function needsStretch(clip: Speedy & { speed?: number }): boolean {
  if (curveOf(clip)) return true;
  const v = clip.speed ?? 1;
  return v > 0 && Math.abs(v - 1) > 1e-3;
}

/** estica o trecho até clip.duration seguindo o mapeamento de velocidade do motor (mesmo do vídeo) */
function stretchToClip(ctx: BaseAudioContext, seg: AudioBuffer, clip: Speedy & { duration: number }): AudioBuffer {
  const sr = seg.sampleRate;
  const outLen = Math.max(2, Math.round(clip.duration * sr));
  const ins = Array.from({ length: seg.numberOfChannels }, (_, c) => seg.getChannelData(c));
  const outs = wsola(ins, sr, outLen, (t) => sourceOffset(clip, t));
  const buf = ctx.createBuffer(outs.length, outLen, sr);
  outs.forEach((ch, c) => buf.copyToChannel(ch, c));
  return buf;
}

/** renderiza o mix estéreo 48 kHz do projeto inteiro; null se não houver nenhum som */
export async function mixProjectAudio(
  p: Project,
  assets: Record<string, MediaAsset>,
  opts: { signal?: AbortSignal; onProgress?: (f: number) => void; onWarning?: (msg: string) => void } = {},
): Promise<AudioBuffer | null> {
  const duration = projectDuration(p);
  const items = audibleClips(p, assets);
  if (!items.length || duration <= 0) return null;
  const length = Math.max(1, Math.ceil(duration * MIX_RATE));
  const ctx = new OfflineAudioContext(2, length, MIX_RATE);
  let any = false;
  let done = 0;
  // só o Blob (handle barato, o arquivo fica no disco) por asset; o áudio é decodificado por clipe, só o trecho usado
  const blobs = new Map<string, Promise<Blob | null>>();
  // MP3/WAV inteiros: 1 decodificação por asset, liberada depois do último clipe dele
  const full: FullDecodeCache = new Map();
  const left = new Map<string, number>();
  for (const it of items) left.set(it.asset.id, (left.get(it.asset.id) ?? 0) + 1);
  const warned = new Set<string>();
  for (const { clip, track, asset } of items) {
    if (opts.signal?.aborted) throw new DOMException('Exportação cancelada', 'AbortError');
    const n = (left.get(asset.id) ?? 1) - 1;
    left.set(asset.id, n);
    let bp = blobs.get(asset.id);
    if (!bp) { bp = asset.url ? fetch(asset.url).then((r) => r.blob()).catch(() => null) : Promise.resolve(null); blobs.set(asset.id, bp); }
    const blob = await bp;
    const want = sourceSpan(clip);
    const res = blob
      ? await decodeAudioRange(ctx, asset, blob, Math.max(0, clip.in - 0.05), clip.in + want + 0.05, full)
      : { range: null, warning: `O áudio de "${asset.name}" não pôde ser incluído (arquivo indisponível).` };
    if (n <= 0) { full.delete(asset.id); blobs.delete(asset.id); }
    done++;
    opts.onProgress?.(done / items.length);
    if (res.warning && !warned.has(asset.id)) { warned.add(asset.id); console.warn('[export]', res.warning); opts.onWarning?.(res.warning); }
    if (!res.range) continue;
    const { buffer: buf, t0 } = res.range;
    const from = clip.in - t0; // posição do clipe dentro do trecho decodificado
    if (from >= buf.duration) continue;
    const span = Math.min(want, buf.duration - Math.max(0, from));
    const fx = clip.audioEffects ?? [];
    const amount = (k: string) => fx.find((e) => e.kind === k)?.amount;
    const seg = segment(ctx, buf, Math.max(0, from), span, {
      reverse: !!clip.reverse,
      gate: amount('noise-reduction'),
      normalize: amount('normalize'),
    });
    if (!seg) continue;
    const src = ctx.createBufferSource();
    // velocidade/curva SEM mudar o tom (o preview usa preservesPitch): time-stretch offline até a
    // duração do clipe na timeline e toca a 1x. Antes: playbackRate reamostrava e subia o tom (2x = +1 oitava).
    src.buffer = needsStretch(clip) ? stretchToClip(ctx, seg, clip) : seg;
    src.playbackRate.value = 1;
    const start = Math.max(0, clip.start);
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
