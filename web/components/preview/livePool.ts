/* =====================================================================
   Pool de elementos <video>/<audio>/<img> para o preview em tempo real.
   - vídeo/áudio: um elemento por CLIPE ativo (dois clipes do mesmo asset
     podem tocar juntos numa transição); elementos livres são reaproveitados
     por asset (após um split, a metade seguinte herda o elemento já no ponto).
   - imagem: uma por asset.
   Sincroniza tempo (seek se desvio > 0,15 s), play/pause, playbackRate e volume.
   ===================================================================== */
import type { Clip, MediaAsset, Project, Seconds, Track } from '@/lib/types';
import type { MediaElement, MediaSources } from '@/lib/engine';
import { sourceTime, clipSpeed, trackLayers } from '@/lib/engine/timing';
import { clipGainAt } from '@/lib/engine/audio';

const DRIFT = 0.15;
const PREROLL = 1.0;
const MAX_IDLE_PER_ASSET = 2;

type AV = HTMLVideoElement | HTMLAudioElement;

export class LiveMediaPool implements MediaSources {
  private images = new Map<string, HTMLImageElement>();
  private byClip = new Map<string, AV>();
  private idle = new Map<string, AV[]>();
  private host: HTMLDivElement | null = null;
  /** chamado quando um quadro novo fica disponível (seek terminou / dados carregaram) */
  onFrame: () => void = () => {};

  attach(host: HTMLDivElement) {
    this.host = host;
  }

  get(assetId: string): MediaElement | undefined {
    return this.images.get(assetId);
  }

  getForClip(clip: Clip): MediaElement | undefined {
    if (clip.type === 'image') return this.images.get(clip.assetId);
    return this.byClip.get(clip.id);
  }

  private create(asset: MediaAsset, kind: 'video' | 'audio'): AV {
    const el = document.createElement(kind);
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.disablePictureInPicture = true;
    }
    (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = true;
    el.dataset.asset = asset.id;
    el.dataset.url = asset.url ?? '';
    el.src = asset.url ?? '';
    const ping = () => this.onFrame();
    el.addEventListener('seeked', ping);
    el.addEventListener('loadeddata', ping);
    this.host?.appendChild(el);
    return el;
  }

  private acquire(clip: Clip, asset: MediaAsset): AV {
    const kind: 'video' | 'audio' = clip.type === 'video' && asset.kind !== 'audio' ? 'video' : 'audio';
    let el = this.byClip.get(clip.id);
    if (el && (el.dataset.url !== (asset.url ?? '') || el.tagName.toLowerCase() !== kind)) {
      this.destroy(el);
      this.byClip.delete(clip.id);
      el = undefined;
    }
    if (!el) {
      const list = this.idle.get(asset.id) ?? [];
      // prefere um elemento livre já perto do ponto de entrada do clipe
      const want = clip.type === 'video' || clip.type === 'audio' ? clip.in : 0;
      let best = -1;
      let bestD = Infinity;
      list.forEach((e, i) => {
        if (e.tagName.toLowerCase() !== kind || e.dataset.url !== (asset.url ?? '')) return;
        const d = Math.abs(e.currentTime - want);
        if (d < bestD) { bestD = d; best = i; }
      });
      el = best >= 0 ? list.splice(best, 1)[0] : this.create(asset, kind);
      this.byClip.set(clip.id, el);
    }
    return el;
  }

  private release(id: string, el: AV) {
    this.byClip.delete(id);
    el.pause();
    const assetId = el.dataset.asset!;
    const list = this.idle.get(assetId) ?? [];
    list.push(el);
    while (list.length > MAX_IDLE_PER_ASSET) this.destroy(list.shift()!);
    this.idle.set(assetId, list);
  }

  private destroy(el: AV) {
    el.pause();
    el.removeAttribute('src');
    try { el.load(); } catch { /* ok */ }
    el.remove();
  }

  private ensureImage(asset: MediaAsset) {
    const cur = this.images.get(asset.id);
    if (cur && cur.dataset.url === asset.url) return;
    const img = new Image();
    img.decoding = 'async';
    img.dataset.url = asset.url ?? '';
    img.onload = () => this.onFrame();
    img.src = asset.url ?? '';
    this.images.set(asset.id, img);
  }

  /** sincroniza todos os elementos com o tempo t */
  sync(p: Project, assets: Record<string, MediaAsset>, t: Seconds, playing: boolean, fps = 30) {
    const active: { clip: Clip; track: Track }[] = [];
    const preroll: { clip: Clip; track: Track }[] = [];
    for (const track of p.tracks) {
      if (track.kind === 'video') {
        if (!track.hidden) for (const l of trackLayers(track, t)) active.push({ clip: l.clip, track });
        for (const c of track.clips) {
          if (c.type === 'image') { const a = assets[c.assetId]; if (a?.url) this.ensureImage(a); }
          if (playing && !track.hidden && c.type === 'video' && c.start > t && c.start - t <= PREROLL) preroll.push({ clip: c, track });
        }
      } else if (track.kind === 'audio') {
        for (const c of track.clips) {
          if (c.type !== 'audio') continue;
          if (t >= c.start && t < c.start + c.duration) active.push({ clip: c, track });
          else if (playing && c.start > t && c.start - t <= PREROLL) preroll.push({ clip: c, track });
        }
      }
    }
    const keep = new Set<string>();
    for (const { clip, track } of active) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const asset = assets[clip.assetId];
      if (!asset?.url || asset.kind === 'image') continue;
      keep.add(clip.id);
      const el = this.acquire(clip, asset);
      const target = sourceTime(clip, t);
      const gain = clipGainAt(p, track, clip, t);
      el.volume = Math.min(1, Math.max(0, gain));
      el.muted = gain <= 0.0001;
      const rate = Math.min(16, Math.max(0.0625, clipSpeed(clip)));
      if (playing) {
        if (el.playbackRate !== rate) el.playbackRate = rate;
        const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
        if (target < dur - 0.05) {
          if (Math.abs(el.currentTime - target) > DRIFT && !el.seeking) el.currentTime = target;
          if (el.paused) el.play().catch(() => { /* autoplay bloqueado: segue mudo */ });
        } else if (!el.paused) el.pause();
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target;
      }
    }
    for (const { clip } of preroll) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const asset = assets[clip.assetId];
      if (!asset?.url || asset.kind === 'image' || keep.has(clip.id)) continue;
      keep.add(clip.id);
      const el = this.acquire(clip, asset);
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - clip.in) > 0.05 && !el.seeking) el.currentTime = clip.in;
    }
    for (const [id, el] of [...this.byClip]) if (!keep.has(id)) this.release(id, el);
  }

  pauseAll() {
    for (const el of this.byClip.values()) el.pause();
  }

  dispose() {
    for (const el of this.byClip.values()) this.destroy(el);
    for (const list of this.idle.values()) list.forEach((e) => this.destroy(e));
    this.byClip.clear();
    this.idle.clear();
    this.images.clear();
  }
}
