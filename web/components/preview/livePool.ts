/* =====================================================================
   Pool de elementos <video>/<audio>/<img> para o preview em tempo real.
   - vídeo/áudio: um elemento por CLIPE (dois clipes do mesmo asset — ex.: cortes
     de um ripple_delete — nunca dividem o mesmo elemento, então o corte não
     custa um seek). O próximo clipe é PRÉ-POSICIONADO (pausado no ponto de
     entrada) ~1 s antes do corte; no corte só troca de elemento.
   - imagem: uma por asset.
   - sincronização: o relógio do Preview segue o vídeo principal (lead); os
     demais corrigem desvio com playbackRate e só fazem seek com desvio grande
     (ver syncPolicy.ts).
   ===================================================================== */
import type { Clip, MediaAsset, Project, Seconds, Track } from '@/lib/types';
import type { MediaElement, MediaSources } from '@/lib/engine';
import { sourceTime, clipSpeed, trackLayers } from '@/lib/engine/timing';
import { clipGainAt } from '@/lib/engine/audio';
import { hasVolumeKeyframes } from '@/lib/engine/animate';
import { buildAudioChain, chainKey, needsAudioChain, type FxChain } from '@/lib/engine/audioFx';
import { nativeGeometry, geometryTransform, geometryClip, layerFilter, type NativePlan } from './hybrid';
import { driftDecision, neighborPlan, staleIdle, frameReady, prerollPlan, warmPosition, type FrameProof, type LeadState } from './syncPolicy';

/** roteamento de um elemento pelo grafo WebAudio (efeitos de voz / tom) */
interface Route { source: MediaElementAudioSourceNode; gain: GainNode; chain: FxChain | null; key: string }

/** resultado de um sync: estado do vídeo principal e se falta quadro p/ desenhar */
export interface SyncState {
  lead: LeadState | null;
  /** algum vídeo visível ainda não tem o quadro do alvo (não desenhe: mantenha o último quadro) */
  pending: boolean;
}

/** elementos livres guardados por asset (prontos p/ pré-carga sem criar/decodificar de novo) */
const MAX_IDLE_PER_ASSET = 3;

type AV = HTMLVideoElement | HTMLAudioElement;

/** opacidade de um <video> fora de cena (imperceptível, mas ainda composto) */
const HIDDEN = '0.001';

/** URL usada no PREVIEW: o proxy leve (MediaAsset.proxyUrl) quando existe; o export usa a original */
export function mediaUrl(asset: MediaAsset): string {
  return (asset as MediaAsset & { proxyUrl?: string }).proxyUrl || asset.url || '';
}

/**
 * iOS/iPadOS: `volume` de <video>/<audio> é só leitura (sempre 1) — volume, fades e ducking só
 * funcionam pelo GainNode. Detecção por recurso: escreve 0.5 e lê de volta (r2 #5).
 */
let volumeRO: boolean | null = null;
export function volumeIsReadOnly(): boolean {
  if (volumeRO !== null) return volumeRO;
  try { const a = document.createElement('audio'); a.volume = 0.5; volumeRO = Math.abs(a.volume - 0.5) > 0.01; }
  catch { volumeRO = false; }
  return volumeRO;
}
/**
 * WebKit (Safari e todo navegador no iOS) libera som por ELEMENTO, só para play() dentro de um gesto;
 * Chrome/Firefox liberam a página inteira depois do 1º gesto.
 */
export function perElementGesture(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  if (/iP(hone|ad|od)/.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)) return true;
  return /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Android|OPR/.test(ua);
}
/** o elemento pode tocar COM som agora? (mudo enquanto não destravado/abençoado — senão o play falha e trava) */
export function canSound(o: { unlocked: boolean; blessed: boolean; perElement: boolean; refused: boolean }): boolean {
  return o.unlocked && !o.refused && (o.blessed || !o.perElement);
}
/** o som do elemento precisa passar pelo GainNode? */
export function wantsRoute(o: { hasCtx: boolean; routed: boolean; chain: boolean; volumeKf: boolean; gain: number; volumeReadOnly: boolean }): boolean {
  if (o.routed) return true;
  if (!o.hasCtx) return false;
  return o.chain || o.volumeKf || (o.volumeReadOnly && Math.abs(o.gain - 1) > 0.001);
}

export class LiveMediaPool implements MediaSources {
  private images = new Map<string, HTMLImageElement>();
  private byClip = new Map<string, AV>();
  private idle = new Map<string, AV[]>();
  private host: HTMLDivElement | null = null;
  /** áudio destravado por gesto do usuário (iOS/Android só tocam mídia com som após um toque) */
  private unlocked = false;
  private actx: AudioContext | null = null;
  private lastPlaying = false;
  private routes = new WeakMap<AV, Route>();
  /** último play()/seek de cada elemento (ms) — carência antes de corrigir desvio com seek */
  private kicks = new WeakMap<AV, number>();
  /** reverso: o quadro buscado já foi desenhado? / elemento já mostrou algum quadro */
  private revDrawn = new WeakMap<AV, boolean>();
  private everShown = new WeakSet<AV>();
  /** iOS: elementos que tocaram (play) dentro de um gesto / que tiveram o play com som recusado */
  private blessed = new WeakSet<AV>();
  private refused = new WeakSet<AV>();
  private readonly perElement = perElementGesture();
  private resumeTry = -Infinity;
  private soundOk(el: AV) {
    return canSound({ unlocked: this.unlocked, blessed: this.blessed.has(el), perElement: this.perElement, refused: this.refused.has(el) });
  }
  /** fonte que nunca vai ter quadro (erro, sem fonte, formato não suportado) */
  isBroken(el: AV): boolean {
    return !!el.error || el.networkState === 3 /* NETWORK_NO_SOURCE */ || this.unplayable.has(el.dataset.url ?? '');
  }
  /** contadores p/ o painel "Mostrar desempenho" */
  readonly stats = { waiting: 0, seeks: 0, errors: 0 };
  /** fontes que este aparelho não decodifica (ex.: HEVC/HDR em Android sem suporte) */
  readonly unplayable = new Set<string>();
  /** avisado quando uma fonte falha (o Preview mostra um aviso uma vez por asset) */
  onUnplayable: (assetId: string, usingProxy: boolean) => void = () => {};
  /** último quadro apresentado (requestVideoFrameCallback) e último seeked/loadeddata, por elemento */
  private presented = new WeakMap<AV, number>();
  private settledAt = new WeakMap<AV, number>();
  /** prova de quadro p/ frameReady (undefined = navegador sem rVFC: confia no readyState) */
  private proof(el: AV): FrameProof | undefined {
    if (!(el instanceof HTMLVideoElement) || !('requestVideoFrameCallback' in el)) return undefined;
    return { presented: this.presented.get(el), sinceSettleMs: performance.now() - (this.settledAt.get(el) ?? 0) };
  }
  /** o quadro do alvo já pode ir para a tela/canvas? */
  ready(el: AV, target: Seconds): boolean {
    return frameReady(el, target, this.proof(el));
  }
  /** elementos de uma fonte antiga, mantidos visíveis até o substituto apresentar */
  private retiring: AV[] = [];
  private retire(el: AV) {
    const i = this.retiring.indexOf(el);
    if (i < 0) return;
    this.retiring.splice(i, 1);
    this.destroy(el);
  }
  /** elemento exibido no modo nativo */
  private shown: HTMLVideoElement | null = null;
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
    // mudo até o 1º gesto: autoplay mudo é sempre permitido (iOS/Android)
    el.muted = !this.unlocked;
    el.defaultMuted = !this.unlocked;
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.disablePictureInPicture = true;
    }
    (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = true;
    el.dataset.asset = asset.id;
    el.dataset.url = mediaUrl(asset);
    el.src = mediaUrl(asset);
    const ping = () => { this.settledAt.set(el, performance.now()); this.onFrame(); };
    // Android: 'seeked' pode vir antes do quadro estar disponível; o rVFC confirma o quadro real
    if (el instanceof HTMLVideoElement && 'requestVideoFrameCallback' in el) {
      const v = el as HTMLVideoElement;
      const onVf = (_now: number, md: VideoFrameCallbackMetadata) => {
        const first = !this.presented.has(v);
        this.presented.set(v, md.mediaTime);
        if (first || v.paused) this.onFrame(); // pausado: redesenha com o quadro de verdade
        if (v.isConnected) v.requestVideoFrameCallback(onVf);
      };
      v.requestVideoFrameCallback(onVf);
    }
    el.addEventListener('seeked', ping);
    el.addEventListener('waiting', () => { this.stats.waiting++; });
    el.addEventListener('error', () => {
      const err = el.error;
      // só "formato não suportado"/decodificação; aborto por troca de src não conta
      if (!err || (err.code !== 3 && err.code !== 4) || !el.getAttribute('src')) return;
      this.stats.errors++;
      const url = el.dataset.url ?? '';
      if (this.unplayable.has(url)) return;
      this.unplayable.add(url);
      this.onUnplayable(asset.id, !!(asset as MediaAsset & { proxyUrl?: string }).proxyUrl && url === (asset as MediaAsset & { proxyUrl?: string }).proxyUrl);
    });
    el.addEventListener('seeking', () => { this.stats.seeks++; });
    el.addEventListener('loadeddata', ping);
    this.host?.appendChild(el);
    return el;
  }

  private acquire(clip: Clip, asset: MediaAsset): AV {
    const kind: 'video' | 'audio' = clip.type === 'video' && asset.kind !== 'audio' ? 'video' : 'audio';
    let el = this.byClip.get(clip.id);
    if (el && (el.dataset.url !== mediaUrl(asset) || el.tagName.toLowerCase() !== kind)) {
      // fonte trocou (ex.: proxy ficou pronto): o elemento antigo fica na tela, parado no
      // último quadro, até o novo apresentar — sem piscar nem pular o playhead
      el.pause();
      this.retiring.push(el);
      window.setTimeout(() => this.retire(el!), 4000);
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
        if (e.tagName.toLowerCase() !== kind || e.dataset.url !== mediaUrl(asset)) return;
        const d = Math.abs(e.currentTime - want);
        if (d < bestD) { bestD = d; best = i; }
      });
      el = best >= 0 ? list.splice(best, 1)[0] : this.create(asset, kind);
      this.byClip.set(clip.id, el);
    }
    return el;
  }

  private release(id: string, el: AV, pause = true) {
    this.byClip.delete(id);
    if (pause) el.pause();
    const assetId = el.dataset.asset!;
    const list = this.idle.get(assetId) ?? [];
    list.push(el);
    while (list.length > MAX_IDLE_PER_ASSET) this.destroy(list.shift()!);
    this.idle.set(assetId, list);
  }

  private destroy(el: AV) {
    // desmonta a rota WebAudio (pitch/efeitos em loop seguiriam rodando e prendendo o elemento — r2 #7)
    const r = this.routes.get(el);
    if (r) {
      try { r.source.disconnect(); } catch { /* ok */ }
      if (r.chain) { try { r.chain.output.disconnect(); } catch { /* ok */ } try { r.chain.stop(); } catch { /* ok */ } }
      try { r.gain.disconnect(); } catch { /* ok */ }
      this.routes.delete(el);
    }
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

  private seek(el: AV, to: Seconds, now: number) {
    el.currentTime = to;
    this.kicks.set(el, now);
    // até o 'seeked' (se ele nunca vier, a carência vence em ~2,4 s e não trava o preview)
    this.settledAt.set(el, now + 2000);
    this.presented.delete(el);
  }

  private play(el: AV, now: number) {
    this.kicks.set(el, now);
    el.play().catch((e: unknown) => {
      // play com som recusado (elemento criado fora de um gesto no iOS): toca MUDO para não travar
      // a imagem e espera o próximo toque para abençoar (r2 #4)
      if ((e as { name?: string })?.name === 'NotAllowedError' && !el.muted) {
        this.refused.add(el);
        el.muted = true;
        el.play().catch(() => {});
      }
    });
  }

  /** sincroniza todos os elementos com o tempo t */
  sync(p: Project, assets: Record<string, MediaAsset>, t: Seconds, playing: boolean, fps = 30, playRate = 1): SyncState {
    this.lastPlaying = playing;
    const now = performance.now();
    // contexto suspenso (iOS: chamada, outro app, tela bloqueada) com elementos no GainNode = silêncio: tenta retomar
    if (playing && this.actx && this.actx.state !== 'running' && now - this.resumeTry > 1000) { this.resumeTry = now; this.resumeAudio(); }
    const active: { clip: Clip; track: Track; role?: 'in' | 'out' }[] = [];
    let leadTrack: Track | null = null;
    for (const track of p.tracks) {
      if (track.kind === 'video' || track.kind === 'overlay') {
        if (!track.hidden) for (const l of trackLayers(track, t)) active.push({ clip: l.clip, track, role: l.transition?.role });
        if (!track.hidden && track.kind === 'video' && !leadTrack) leadTrack = track;
        for (const c of track.clips) {
          if (c.type === 'image' || (c.type === 'sticker' && c.assetId)) { const a = assets[c.assetId!]; if (a?.url) this.ensureImage(a); }
        }
      } else if (track.kind === 'audio') {
        for (const c of track.clips) {
          if (c.type !== 'audio') continue;
          if (t >= c.start && t < c.start + c.duration) active.push({ clip: c, track });
        }
      }
    }
    if (p.canvas?.type === 'image' && p.canvas.assetId) { const a = assets[p.canvas.assetId]; if (a?.url) this.ensureImage(a); }

    // vídeo principal: clipe de vídeo da 1ª trilha de vídeo visível (na transição, o que entra)
    const leadItem = active.find((x) => x.track === leadTrack && x.clip.type === 'video' && x.role !== 'out' && !x.clip.reverse)
      ?? active.find((x) => x.track === leadTrack && x.clip.type === 'video' && !x.clip.reverse);
    let lead: LeadState | null = null;
    let pending = false;

    // livres de mídia removida ou de fonte trocada (proxy pronto): destrói (libera o decodificador)
    for (const [assetId, list] of [...this.idle]) {
      const a = assets[assetId];
      const cur = a?.url ? mediaUrl(a) : null;
      const stale = staleIdle(list.map((el) => ({ el, url: el.dataset.url ?? '' })), cur);
      if (!stale.length) continue;
      stale.forEach(({ el }) => this.destroy(el));
      const rest = list.filter((el) => !stale.some((x) => x.el === el));
      if (rest.length) this.idle.set(assetId, rest); else this.idle.delete(assetId);
    }
    // libera ANTES de pegar elementos: depois de um corte (split/ripple) os pedaços ganham ids
    // novos; o elemento do clipe antigo (já carregado, no quadro certo) volta ao pool livre e é
    // reaproveitado pelo pedaço novo — em vez de criar um <video> do zero (quadro preto/travada).
    const wanted = new Set<string>();
    const usable = (c: Clip) => (c.type === 'video' || c.type === 'audio') && !!assets[c.assetId]?.url && assets[c.assetId]?.kind !== 'image';
    for (const { clip } of active) if (usable(clip)) wanted.add(clip.id);
    if (playing) for (const { clip } of prerollPlan(p, t)) if (usable(clip)) wanted.add(clip.id);
    const neighbors = playing ? [] : neighborPlan(p, t);
    for (const { clip } of neighbors) if (usable(clip)) wanted.add(clip.id);
    for (const [id, el] of [...this.byClip]) if (!wanted.has(id)) this.release(id, el, false);

    const keep = new Set<string>();
    for (const item of active) {
      const { clip, track } = item;
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const asset = assets[clip.assetId];
      if (!asset?.url || asset.kind === 'image') continue;
      keep.add(clip.id);
      const el = this.acquire(clip, asset);
      const target = sourceTime(clip, t);
      const isLead = item === leadItem;
      // reverso: o elemento não toca para trás → busca quadro a quadro, sem som
      const reverse = !!clip.reverse;
      const gain = reverse ? 0 : clipGainAt(p, track, clip, t);
      const routed = this.route(el, clip, gain);
      if (!routed) el.volume = Math.min(1, Math.max(0, gain));
      el.muted = !this.soundOk(el) || gain <= 0.0001;
      const speed = clipSpeed(clip, t);
      // velocidade do elemento = velocidade do clipe × velocidade de reprodução do preview
      const rate = Math.min(16, Math.max(0.0625, speed * playRate));
      let skipReady = false;
      if (playing && reverse) {
        // reverso: alterna DESENHAR o quadro buscado e PEDIR o próximo seek (nunca no mesmo passo) —
        // antes, o seek recém-pedido zerava a prova de quadro e o canvas inteiro congelava (r2 #1)
        if (!el.paused) el.pause();
        skipReady = true;
        const far = Math.abs(el.currentTime - target) > 0.5 / fps;
        if (el.seeking) { if (!this.everShown.has(el)) pending = true; }
        else if (!this.revDrawn.get(el) && el.readyState >= 2) { this.revDrawn.set(el, true); this.everShown.add(el); }
        else if (far) { this.seek(el, target, now); this.revDrawn.set(el, false); if (!this.everShown.has(el)) pending = true; }
      } else if (playing) {
        const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
        if (target < dur - 0.05) {
          const kick = this.kicks.get(el) ?? -Infinity;
          const dec = driftDecision({ drift: target - el.currentTime, rate, sinceKickMs: now - kick, lead: isLead });
          if (dec.seek && !el.seeking) this.seek(el, target, now);
          if (Math.abs(el.playbackRate - dec.rate) > 0.004) el.playbackRate = dec.rate;
          if (el.paused) this.play(el, now);
          if (isLead) {
            // tempo de timeline mostrado pelo vídeo (1ª ordem; vale p/ curva de velocidade)
            const videoT = t + (el.currentTime - target) / Math.max(0.0625, speed);
            const stalled = el.paused || el.seeking || el.readyState < 3;
            if (!this.isBroken(el)) lead = { videoT, stalled };
          }
        } else if (!el.paused) el.pause();
      } else {
        if (!el.paused) el.pause();
        if (el.playbackRate !== rate) el.playbackRate = rate;
        if (Math.abs(el.currentTime - target) > 0.5 / fps) this.seek(el, target, now);
      }
      // conferido DEPOIS do play/seek: um seek recém-pedido derruba o readyState na hora;
      // conferir antes deixava desenhar com o vídeo sem quadro (tela preta após cada corte)
      // fonte quebrada (sem decodificador/blob) não segura o desenho de tudo (r2 #2)
      if (!skipReady && clip.type === 'video' && el instanceof HTMLVideoElement && !this.isBroken(el) && !this.ready(el, target)) pending = true;
      else if (clip.type === 'video' && el instanceof HTMLVideoElement && el.readyState >= 2) this.everShown.add(el);
    }
    // pré-carga: o próximo clipe ganha elemento próprio, pausado no ponto de entrada
    if (playing) {
      for (const { clip } of prerollPlan(p, t)) {
        if (clip.type !== 'video' && clip.type !== 'audio') continue;
        const asset = assets[clip.assetId];
        if (!asset?.url || asset.kind === 'image' || keep.has(clip.id)) continue;
        keep.add(clip.id);
        const el = this.acquire(clip, asset);
        el.muted = true;
        const at = sourceTime(clip, clip.start);
        const speed = Math.max(0.0625, clipSpeed(clip, clip.start));
        const rate = Math.min(16, speed * playRate);
        const pos = warmPosition(at, clip.start - t, speed, !!clip.reverse);
        if (pos.play) {
          // partida a quente: já tocando (mudo) quando o corte chegar — sem a latência do play()
          const dec = driftDecision({ drift: pos.at - el.currentTime, rate, sinceKickMs: now - (this.kicks.get(el) ?? -Infinity), lead: false });
          if (dec.seek && !el.seeking) this.seek(el, pos.at, now);
          if (Math.abs(el.playbackRate - dec.rate) > 0.004) el.playbackRate = dec.rate;
          if (el.paused) this.play(el, now);
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - pos.at) > 0.04 && !el.seeking) this.seek(el, pos.at, now);
        }
      }
    }
    // pausado perto de um corte: vizinhos já no quadro do corte (transição aplicada aparece na hora)
    for (const { clip } of neighbors) {
      if (clip.type !== 'video' || keep.has(clip.id)) continue;
      const asset = assets[clip.assetId];
      if (!asset?.url || asset.kind === 'image') continue;
      keep.add(clip.id);
      const el = this.acquire(clip, asset);
      el.muted = true;
      if (!el.paused) el.pause();
      const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
      const at = Math.max(0, Math.min(sourceTime(clip, t), dur - 0.05));
      if (Math.abs(el.currentTime - at) > 0.5 / fps && !el.seeking) this.seek(el, at, now);
    }
    for (const [id, el] of [...this.byClip]) if (!keep.has(id)) this.release(id, el);
    // livres que não foram reaproveitados neste passo: pausa (sem pausar/retomar o reaproveitado)
    for (const list of this.idle.values()) for (const el of list) if (!el.paused) el.pause();
    return { lead, pending };
  }

  /**
   * Passa o som do elemento pelo grafo de efeitos quando o clipe tem efeitos de voz/tom
   * (exige AudioContext destravado). Uma vez roteado, o elemento fica no grafo; sem
   * efeitos, a cadeia é só o ganho. Devolve true se o volume é controlado pelo grafo.
   */
  private route(el: AV, clip: Clip, gain: number): boolean {
    const fx = clip.type === 'video' || clip.type === 'audio' ? clip.audioEffects : undefined;
    const pitch = clip.type === 'video' || clip.type === 'audio' ? clip.pitch : undefined;
    let r = this.routes.get(el);
    // automação de volume (props.volume) também vai pelo GainNode: rampas suaves, sem cliques
    // iOS: volume do elemento é só leitura → qualquer ganho ≠ 1 (volume, fades, ducking) vai pelo GainNode (r2 #5)
    if (!wantsRoute({ hasCtx: !!this.actx, routed: !!r, chain: needsAudioChain(fx, pitch), volumeKf: hasVolumeKeyframes(clip), gain, volumeReadOnly: volumeIsReadOnly() })) return false;
    if (!r) {
      try {
        const source = this.actx!.createMediaElementSource(el);
        const g = this.actx!.createGain();
        g.connect(this.actx!.destination);
        r = { source, gain: g, chain: null, key: '' };
        this.routes.set(el, r);
      } catch { return false; }
    }
    const key = chainKey(fx, pitch);
    if (key !== r.key) {
      r.source.disconnect();
      if (r.chain) { r.chain.output.disconnect(); r.chain.stop(); }
      r.chain = needsAudioChain(fx, pitch) ? buildAudioChain(this.actx!, fx, pitch, this.actx!.currentTime) : null;
      if (r.chain) { r.source.connect(r.chain.input); r.chain.output.connect(r.gain); } else r.source.connect(r.gain);
      r.key = key;
    }
    el.volume = 1;
    r.gain.gain.setTargetAtTime(Math.max(0, gain), this.actx!.currentTime, 0.015);
    return true;
  }

  /** iOS/Android suspendem o AudioContext (chamada, outro app, tela bloqueada): retoma no gesto de play */
  resumeAudio() {
    if (this.actx && this.actx.state !== 'running' && this.actx.state !== 'closed') void this.actx.resume().catch(() => {});
  }

  get isUnlocked() {
    return this.unlocked;
  }

  /**
   * Chamar DENTRO de um gesto do usuário (toque/clique): destrava o áudio.
   * Retoma um AudioContext e "abençoa" um elemento por asset (play+pause no
   * gesto), que fica no pool livre p/ ser reaproveitado pelos clipes.
   */
  unlock(p: Project, assets: Record<string, MediaAsset>) {
    // chamado a CADA gesto: no iOS, elementos criados depois do 1º toque (clipe novo, mídia nova,
    // proxy) também precisam de um play dentro de um gesto para ter som (r2 #4)
    if (!this.unlocked) {
      this.unlocked = true;
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) { this.actx = new AC(); void this.actx.resume().catch(() => {}); }
      } catch { /* sem WebAudio */ }
    } else this.resumeAudio();
    const bless = (el: AV) => {
      if (this.blessed.has(el) && !this.refused.has(el)) return;
      const wasPlaying = !el.paused;
      el.muted = false;
      el.defaultMuted = false;
      const pr = el.play();
      // pausa de volta, a menos que o sync já o esteja usando na reprodução
      if (pr) pr.then(() => {
        this.blessed.add(el); this.refused.delete(el);
        if (!wasPlaying && (!this.lastPlaying || ![...this.byClip.values()].includes(el))) el.pause();
      }).catch(() => { el.muted = true; });
    };
    for (const el of this.byClip.values()) bless(el);
    for (const list of this.idle.values()) list.forEach(bless);
    const used = new Map<string, 'video' | 'audio'>();
    for (const t of p.tracks) for (const c of t.clips) {
      if (c.type !== 'video' && c.type !== 'audio') continue;
      const a = assets[c.assetId];
      if (a?.url && a.kind !== 'image') used.set(a.id, c.type === 'video' && a.kind !== 'audio' ? 'video' : 'audio');
    }
    for (const [id, kind] of used) {
      const has = [...this.byClip.values(), ...(this.idle.get(id) ?? [])].some((e) => e.dataset.asset === id);
      if (has) continue;
      const el = this.create(assets[id], kind);
      bless(el);
      this.idle.set(id, [...(this.idle.get(id) ?? []), el]);
    }
  }

  /**
   * Modo nativo: mostra o <video> do clipe principal (geometria/opacidade/filtro em CSS)
   * e esconde os demais. Devolve false se o elemento ainda não tem quadro (o chamador
   * mantém o que está na tela). Com plano não nativo, esconde todos (canvas desenha tudo).
   */
  present(plan: NativePlan, t: Seconds, W: number, H: number): boolean | 'canvas' {
    const show = new Set<HTMLVideoElement>();
    if (plan.native) {
      const els: HTMLVideoElement[] = [];
      for (const l of plan.layers) {
        const el = this.byClip.get(l.clip.id);
        // sem elemento (mídia sem url / removida) ou fonte quebrada: o modo nativo não tem o que mostrar —
        // o chamador cai para o canvas (desenha fundo, textos e legendas) em vez de esperar para sempre (r2 #2/#3)
        if (!(el instanceof HTMLVideoElement) || this.isBroken(el)) return 'canvas';
        if (!el.videoWidth || !this.ready(el, sourceTime(l.clip, t))) return false;
        els.push(el);
      }
      plan.layers.forEach((l, i) => {
        const el = els[i];
        const g = nativeGeometry(l.clip, t, W, H, el.videoWidth, el.videoHeight, l.tv);
        const st = el.style;
        const w = `${g.w.toFixed(2)}px`, h = `${g.h.toFixed(2)}px`, tr = geometryTransform(g);
        const op = l.opacity.toFixed(3), fl = layerFilter(l, W, H), cp = geometryClip(g), z = String(l.z);
        if (st.width !== w) st.width = w;
        if (st.height !== h) st.height = h;
        if (st.transform !== tr) st.transform = tr;
        if (st.opacity !== op) st.opacity = op;
        if (st.filter !== fl) st.filter = fl;
        if (st.clipPath !== cp) st.clipPath = cp;
        if (st.zIndex !== z) st.zIndex = z;
        show.add(el);
      });
    }
    // 'escondido' = 0.001, não 0: camada continua no compositor (rVFC segue confirmando quadros)
    const hide = (e: AV) => { if (!show.has(e as HTMLVideoElement) && e instanceof HTMLVideoElement && e.style.opacity !== HIDDEN) e.style.opacity = HIDDEN; };
    this.byClip.forEach(hide);
    this.idle.forEach((l) => l.forEach(hide));
    this.shown = show.size ? [...show].at(-1)! : null;
    // já há quadro novo na tela: descarta as fontes antigas
    if (this.retiring.length) [...this.retiring].forEach((e) => this.retire(e));
    return true;
  }

  /** elemento exibido no modo nativo (diagnóstico) */
  get shownElement() {
    return this.shown;
  }

  pauseAll() {
    for (const el of this.byClip.values()) el.pause();
  }

  dispose() {
    [...this.retiring].forEach((e) => this.retire(e));
    for (const el of this.byClip.values()) this.destroy(el);
    for (const list of this.idle.values()) list.forEach((e) => this.destroy(e));
    this.byClip.clear();
    this.idle.clear();
    this.images.clear();
    void this.actx?.close().catch(() => {});
    this.actx = null;
  }
}
