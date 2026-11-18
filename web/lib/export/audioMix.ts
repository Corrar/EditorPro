/* mixagem offline do áudio do projeto (OfflineAudioContext), respeitando cortes/in/speed/volume/fades/ducking */
import type { MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import { audibleClips, gainEnvelope } from '../engine/audio';

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
    const speed = clip.speed > 0 ? clip.speed : 1;
    const srcDur = clip.duration * speed;
    if (clip.in >= buf.duration) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const gain = ctx.createGain();
    const env = gainEnvelope(p, track, clip, 1 / 60);
    gain.gain.setValueAtTime(env[0]?.g ?? 0, Math.max(0, clip.start));
    for (const pt of env.slice(1)) gain.gain.linearRampToValueAtTime(pt.g, Math.max(0, pt.t));
    src.connect(gain).connect(ctx.destination);
    src.start(Math.max(0, clip.start), clip.in, Math.min(srcDur, buf.duration - clip.in));
    any = true;
  }
  if (!any) return null;
  return ctx.startRendering();
}
