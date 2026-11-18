/* elementos de mídia para o export: imagens carregadas uma vez; vídeos por clipe com seek preciso */
import type { Clip, MediaAsset } from '../types';
import type { MediaElement, MediaSources } from '../engine';

const SEEK_TIMEOUT = 4000;

function waitEvent(el: HTMLMediaElement, ev: string, timeout = SEEK_TIMEOUT): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); el.removeEventListener(ev, done); el.removeEventListener('error', done); resolve(); };
    const timer = setTimeout(done, timeout);
    el.addEventListener(ev, done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = url;
  });
}

export class OfflineMediaPool implements MediaSources {
  private images = new Map<string, HTMLImageElement>();
  private byClip = new Map<string, HTMLVideoElement>();
  private idle = new Map<string, HTMLVideoElement[]>();
  constructor(private assets: Record<string, MediaAsset>) {}

  async preloadImages(): Promise<void> {
    await Promise.all(
      Object.values(this.assets)
        .filter((a) => a.kind === 'image' && a.url)
        .map(async (a) => { this.images.set(a.id, await loadImage(a.url!)); }),
    );
  }

  get(assetId: string): MediaElement | undefined {
    return this.images.get(assetId);
  }

  getForClip(clip: Clip): MediaElement | undefined {
    if (clip.type === 'image') return this.images.get(clip.assetId);
    return this.byClip.get(clip.id);
  }

  private async create(asset: MediaAsset): Promise<HTMLVideoElement> {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = asset.url ?? '';
    if (v.readyState < 1) await waitEvent(v, 'loadedmetadata');
    return v;
  }

  /** garante elementos para os clipes de vídeo dados (libera os outros) e busca o tempo de origem exato */
  async prepare(clips: { clip: Clip; time: number }[]): Promise<void> {
    const wanted = new Set(clips.map((c) => c.clip.id));
    for (const [id, el] of this.byClip) {
      if (!wanted.has(id)) {
        this.byClip.delete(id);
        const assetId = el.dataset.asset!;
        (this.idle.get(assetId) ?? this.idle.set(assetId, []).get(assetId)!).push(el);
      }
    }
    await Promise.all(
      clips.map(async ({ clip, time }) => {
        if (clip.type !== 'video') return;
        const asset = this.assets[clip.assetId];
        if (!asset?.url) return;
        let el = this.byClip.get(clip.id);
        if (!el) {
          el = this.idle.get(asset.id)?.pop() ?? (await this.create(asset));
          el.dataset.asset = asset.id;
          this.byClip.set(clip.id, el);
        }
        const dur = Number.isFinite(el.duration) ? el.duration : asset.duration;
        const target = Math.max(0, Math.min(time, Math.max(0, dur - 0.001)));
        if (Math.abs(el.currentTime - target) > 0.0005 || el.readyState < 2) {
          const seeked = waitEvent(el, 'seeked');
          el.currentTime = target;
          await seeked;
        }
        if (el.readyState < 2) await waitEvent(el, 'loadeddata', 1500);
      }),
    );
  }

  dispose(): void {
    const all = [...this.byClip.values(), ...[...this.idle.values()].flat()];
    for (const v of all) { v.removeAttribute('src'); v.load(); }
    this.byClip.clear();
    this.idle.clear();
    this.images.clear();
  }
}
