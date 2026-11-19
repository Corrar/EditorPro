/* elementos de mídia para o export: imagens carregadas uma vez; vídeos por clipe com seek preciso.
   Android (Chrome/PWA): <video> fora do DOM é suspenso/não decodifica e o 'seeked' chega antes do
   quadro estar na superfície (MediaCodec) → drawImage sai preto. Por isso os elementos ficam num
   host fixo no DOM (1×1 px, quase transparente) e, depois do seek, espera-se o
   requestVideoFrameCallback (com timeout) antes de desenhar. */
import type { Clip, MediaAsset } from '../types';
import type { MediaElement, MediaSources } from '../engine';
import { ensureSegMask, getSegMask } from '../engine/segment';
import { shouldCheck, sourceIsBlack } from './blackCheck';

const SEEK_TIMEOUT = 4000;

function waitEvent(el: HTMLMediaElement, ev: string, timeout = SEEK_TIMEOUT): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); el.removeEventListener(ev, done); el.removeEventListener('error', done); resolve(); };
    const timer = setTimeout(done, timeout);
    el.addEventListener(ev, done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}

/** host fixo no DOM p/ os <video> do export (nunca display:none: o Chrome Android deixa de decodificar) */
let host: HTMLDivElement | null = null;
let hostUsers = 0;
export function acquireMediaHost(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.epExportHost = '';
    host.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1;contain:strict;';
    document.body.appendChild(host);
  }
  hostUsers++;
  return host;
}
export function releaseMediaHost(): void {
  hostUsers = Math.max(0, hostUsers - 1);
  if (!hostUsers && host) { host.remove(); host = null; }
}

type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };

/** promessa resolvida quando o próximo quadro do <video> for apresentado (rVFC), ou no timeout; false se não veio */
export function nextVideoFrame(el: HTMLVideoElement, timeout = 400): Promise<boolean> {
  const v = el as RVFCVideo;
  if (!v.requestVideoFrameCallback) return Promise.resolve(false);
  return new Promise((resolve) => {
    let handle = 0;
    const timer = setTimeout(() => { try { v.cancelVideoFrameCallback?.(handle); } catch { /* ok */ } resolve(false); }, timeout);
    handle = v.requestVideoFrameCallback!(() => { clearTimeout(timer); resolve(true); });
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

/** nenhum caminho consegue decodificar o vídeo neste aparelho: melhor avisar do que entregar MP4 preto */
export class UndecodableVideoError extends Error {
  constructor(name: string, code?: number) {
    super(`Este aparelho não consegue decodificar o vídeo "${name}"${code ? ` (erro ${code})` : ''} — o resultado sairia preto. `
      + 'Provável formato HEVC/H.265 ou 10-bit/HDR. Grave em H.264 ("Mais compatível" na câmera) ou converta o arquivo e tente de novo.');
    this.name = 'UndecodableVideoError';
  }
}

export class OfflineMediaPool implements MediaSources {
  private images = new Map<string, HTMLImageElement>();
  private byClip = new Map<string, HTMLVideoElement>();
  private idle = new Map<string, HTMLVideoElement[]>();
  /** máscaras de segmentação calculadas de forma exata antes de cada quadro */
  readonly offline = true;
  private host: HTMLDivElement | null = null;
  /** rVFC confiável neste navegador? (desliga após 3 timeouts seguidos p/ não travar 400 ms por quadro) */
  private rvfcMisses = 0;
  private rvfcOk = true;
  private nth = new Map<string, number>();
  private trulyBlack = new Map<string, number>();
  /** aviso p/ o progresso */
  onNotice?: (msg: string) => void;
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
    v.disablePictureInPicture = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.width = 1;
    v.height = 1;
    if (!this.host) this.host = acquireMediaHost();
    this.host?.appendChild(v);
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
        if (clip.type === 'image') {
          const img = this.images.get(clip.assetId);
          if (clip.removeBackground && img?.naturalWidth && !getSegMask(clip.id)) await ensureSegMask(clip.id, img, img.naturalWidth, img.naturalHeight, 0);
          return;
        }
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
          await this.seek(el, target);
        }
        if (el.readyState < 2) await waitEvent(el, 'loadeddata', 1500);
        if (el.error || !el.videoWidth) throw new UndecodableVideoError(asset.name, el.error?.code);
        await this.blackRetry(clip, time, el);
        if (clip.removeBackground && el.videoWidth) await ensureSegMask(clip.id, el, el.videoWidth, el.videoHeight, time);
      }),
    );
  }

  /** seek + espera o quadro chegar à superfície (rVFC) — o 'seeked' sozinho não basta no Android */
  private async seek(el: HTMLVideoElement, target: number, extraWait = false): Promise<void> {
    const frame = this.rvfcOk ? nextVideoFrame(el, extraWait ? 1200 : 400) : null;
    const seeked = waitEvent(el, 'seeked');
    el.currentTime = target;
    await seeked;
    if (frame) {
      const got = await frame;
      if (got) this.rvfcMisses = 0;
      else if (++this.rvfcMisses >= 3 && !extraWait) { this.rvfcOk = false; console.warn('[export] requestVideoFrameCallback não responde após seek; seguindo só com seeked'); }
    }
    if (extraWait) await new Promise((r) => setTimeout(r, 60));
  }

  /** detector de preto (amostrado): quadro todo preto → re-busca com espera longa; persiste → aviso */
  private async blackRetry(clip: Clip, time: number, el: HTMLVideoElement): Promise<void> {
    const n = this.nth.get(clip.id) ?? 0;
    this.nth.set(clip.id, n + 1);
    if ((this.trulyBlack.get(clip.id) ?? 0) >= 3 || !shouldCheck(n)) return;
    if (sourceIsBlack(el) !== true) return;
    await this.reseek(clip, time);
    if (sourceIsBlack(el) === true) {
      this.trulyBlack.set(clip.id, (this.trulyBlack.get(clip.id) ?? 0) + 1);
    } else {
      console.warn(`[export] <video> entregou quadro preto após o seek (clipe ${clip.id}); re-busca com espera resolveu`);
      this.onNotice?.('Aguardando o decodificador do aparelho');
    }
  }

  /** re-busca o quadro do clipe com espera longa (usado quando o quadro saiu preto) */
  async reseek(clip: Clip, time: number): Promise<void> {
    const el = this.byClip.get(clip.id);
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : time;
    const target = Math.max(0, Math.min(time, Math.max(0, dur - 0.001)));
    // pequeno desvio força um seek de verdade mesmo no mesmo tempo
    el.currentTime = Math.max(0, target - 0.05);
    await waitEvent(el, 'seeked', 1500);
    const was = this.rvfcOk;
    this.rvfcOk = true;
    await this.seek(el, target, true);
    this.rvfcOk = was;
  }

  dispose(): void {
    const all = [...this.byClip.values(), ...[...this.idle.values()].flat()];
    for (const v of all) { v.removeAttribute('src'); v.load(); v.remove(); }
    if (this.host) { releaseMediaHost(); this.host = null; }
    this.byClip.clear();
    this.idle.clear();
    this.images.clear();
  }
}
