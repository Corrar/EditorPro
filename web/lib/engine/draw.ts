/* =====================================================================
   Desenho em canvas 2D (composição) + WebGL por pixel (gl.ts).
   Pipeline de uma camada visual (vídeo/imagem/sticker/forma):
   fonte → [recorte/chroma/realces/sombras/nitidez (GL)] → [remover fundo]
   → geometria (encaixe, transform/keyframes, animações, transição, tremor)
   → filtros CSS → superfície da camada (gradação, efeitos, máscara,
   pixelado/RGB) → composição no quadro (opacidade + modo de mesclagem)
   ===================================================================== */
import type {
  AdjustmentClip, BlendMode, Project, Seconds,
} from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { interpolateTransform } from './easing';
import { resolveFilters, needsPixelGrade, type ResolvedFilters } from './filters';
import { fadeOpacity, type LayerItem } from './timing';
import { transitionVisual, NEUTRAL_TRANSITION, type TransitionVisual } from './transitions';
import { clipAnimFx } from './animations';
import { applyGrade, applySurfaceEffects, effectGeometry, filmBurn, glitchInPlace, hasSurfaceEffects, pixelateInPlace, rgbSplitInPlace } from './effects';
import { applyMask } from './masks';
import { processPixels } from './gl';
import { emojiCanvas, shapeCanvas, clipShapeAspect } from './shapes';
import { getSegMask, requestSegMask } from './segment';
import { hash, scratch, type AnyCanvas, type Ctx } from './surface';
import { gradeLayer } from '../color';
import type { MediaElement } from './index';

export type { Ctx } from './surface';

export function mediaSize(el: MediaElement | AnyCanvas): { w: number; h: number } | null {
  // quadro decodificado pelo WebCodecs (export rápido)
  if (typeof VideoFrame !== 'undefined' && el instanceof VideoFrame) return el.displayWidth ? { w: el.displayWidth, h: el.displayHeight } : null;
  if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
    if (el.readyState < 2 || !el.videoWidth) return null;
    return { w: el.videoWidth, h: el.videoHeight };
  }
  if (typeof HTMLImageElement !== 'undefined' && el instanceof HTMLImageElement) {
    if (!el.complete || !el.naturalWidth) return null;
    return { w: el.naturalWidth, h: el.naturalHeight };
  }
  if (typeof HTMLAudioElement !== 'undefined' && el instanceof HTMLAudioElement) return null;
  const any = el as { width?: number; height?: number };
  if (any.width && any.height) return { w: any.width, h: any.height };
  return null;
}

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken',
  lighten: 'lighten', add: 'lighter', difference: 'difference',
};

/* ---------- fundo (Tela de fundo do CapCut) ---------- */

export function drawBackground(
  ctx: Ctx, p: Project, t: Seconds, W: number, H: number,
  bottom: { layer: LayerItem; el: MediaElement | undefined } | null, bgImage: MediaElement | undefined,
) {
  const cv = p.canvas;
  ctx.fillStyle = (cv?.type === 'color' && cv.color) || p.background || '#000';
  ctx.fillRect(0, 0, W, H);
  const coverDraw = (el: MediaElement, blurPx: number) => {
    const sz = mediaSize(el);
    if (!sz) return;
    const k = Math.max(W / sz.w, H / sz.h) * (blurPx ? 1.08 : 1);
    ctx.save();
    if (blurPx) ctx.filter = `blur(${blurPx.toFixed(1)}px) brightness(0.85)`;
    ctx.drawImage(el as CanvasImageSource, (W - sz.w * k) / 2, (H - sz.h * k) / 2, sz.w * k, sz.h * k);
    ctx.restore();
  };
  if (cv?.type === 'image' && bgImage) coverDraw(bgImage, 0);
  else if (cv?.type === 'blur' && bottom?.el && (bottom.layer.clip.type === 'video' || bottom.layer.clip.type === 'image')) {
    coverDraw(bottom.el, Math.min(W, H) * 0.035 * Math.max(0.2, Math.min(1, cv.blur ?? 0.6)) * 2);
  }
}

/* ---------- camada visual ---------- */

export interface LayerOpts {
  /** chave p/ máscara de segmentação (clipe) */
  segKey?: string;
  /** export: máscara exata já calculada, não pedir assíncrona */
  offline?: boolean;
}

/** desenha um item visual (vídeo/imagem/sticker/forma) no quadro */
export function drawLayer(ctx: Ctx, layer: LayerItem, t: Seconds, el: MediaElement | undefined, W: number, H: number, opts: LayerOpts = {}): void {
  const clip = layer.clip;
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  const tf = interpolateTransform(clip.transform ?? DEFAULT_TRANSFORM, clip.keyframes, local);
  const short = Math.min(W, H);

  /* fonte */
  let src: CanvasImageSource | null = null;
  let sw = 0, sh = 0;
  let natural = true; // fonte "natural" (vídeo/imagem) usa encaixe; sticker/forma usa tamanho relativo
  if (clip.type === 'shape') {
    const sizePx = short * Math.max(0.01, tf.scale) * 1.2;
    const c = shapeCanvas(clip, sizePx);
    src = c as CanvasImageSource; sw = c.width; sh = c.height; natural = false;
  } else if (clip.type === 'sticker' && clip.emoji && !el) {
    const c = emojiCanvas(clip.emoji, short * Math.max(0.01, tf.scale) * 1.4);
    src = c as CanvasImageSource; sw = c.width; sh = c.height; natural = false;
  } else {
    if (!el) return;
    const size = mediaSize(el);
    if (!size) return;
    src = el as CanvasImageSource; sw = size.w; sh = size.h;
    natural = clip.type !== 'sticker';
  }

  const tv: TransitionVisual = layer.transition
    ? transitionVisual(layer.transition.kind, layer.transition.progress, layer.transition.role)
    : NEUTRAL_TRANSITION;
  const anim = clipAnimFx(clip, Math.max(0, t - clip.start), clip.duration);
  const effects = clip.effects;
  const geo = effectGeometry(effects, t);
  const opacity = Math.max(0, Math.min(1,
    tf.opacity * tv.opacity * anim.opacity * (layer.transition?.role === 'out' ? 1 : fadeOpacity(clip, t))));
  if (opacity <= 0.001 && !tv.flash && !tv.dip) return;

  /* remover fundo */
  if ('removeBackground' in clip && clip.removeBackground && natural) {
    const key = opts.segKey ?? clip.id;
    if (!opts.offline) requestSegMask(key, src, sw, sh, t);
    const m = getSegMask(key);
    if (m) {
      const { c, ctx: rc } = scratch(clip, sw, sh, 1);
      rc.drawImage(src, 0, 0, sw, sh);
      rc.globalCompositeOperation = 'destination-in';
      rc.drawImage(m as CanvasImageSource, 0, 0, sw, sh);
      src = c as CanvasImageSource;
    }
  }

  /* pré-processamento por pixel (GL) */
  const crop = natural && 'crop' in clip && clip.crop && (clip.crop.w < 0.999 || clip.crop.h < 0.999 || clip.crop.x > 0.001 || clip.crop.y > 0.001) ? clip.crop : undefined;
  const f = resolveFilters('filters' in clip ? clip.filters : undefined, clip.type === 'video' ? clip.colorPreset : undefined, H / 1080);
  const chroma = 'chromaKey' in clip && clip.chromaKey ? clip.chromaKey : undefined;
  const cw = crop ? sw * crop.w : sw, chh = crop ? sh * crop.h : sh;
  if (crop || chroma || needsPixelGrade(f)) {
    // processa já no tamanho em que vai ser desenhado (PiP pequeno não precisa de 1080p)
    const fitMode = natural ? (('fit' in clip && clip.fit) || 'cover') : 'contain';
    const kfit = fitMode === 'fill' ? Math.max(W / cw, H / chh) : fitMode === 'contain' ? Math.min(W / cw, H / chh) : Math.max(W / cw, H / chh);
    const drawn = kfit * Math.max(0.05, tf.scale * tv.scale * anim.scale * geo.scale);
    const k = Math.min(1, drawn * 1.1);
    let tsrc: TexImageSource = src as TexImageSource, tsw = sw, tsh = sh;
    // texturas enormes: reduz antes de subir p/ a GPU (upload é o passo caro)
    if (k < 0.6 && !crop) {
      const { c, ctx: dc } = scratch(clip, Math.max(2, sw * k), Math.max(2, sh * k), 2);
      dc.drawImage(src, 0, 0, c.width, c.height);
      tsrc = c as TexImageSource; tsw = c.width; tsh = c.height;
    }
    const out = processPixels(tsrc, tsw, tsh, cw * k, chh * k, {
      crop, chroma, highlights: f.highlights, shadows: f.shadows, sharpen: f.sharpen,
    });
    // o canvas GL é compartilhado, mas é desenhado logo abaixo antes de outro uso
    if (out) { src = out as CanvasImageSource; sw = out.width; sh = out.height; }
  }

  /* correção de cor estilo DaVinci (sessão Cor; WebGL, canvas reaproveitado — desenhado logo abaixo) */
  if ('colorGrade' in clip && clip.colorGrade) {
    const kk = Math.min(1, 1920 / Math.max(sw, sh));
    const g = gradeLayer(src, clip.colorGrade, sw * kk, sh * kk);
    if (g) { src = g; sw = (g as HTMLCanvasElement).width; sh = (g as HTMLCanvasElement).height; }
  }

  /* geometria */
  let dw: number, dh: number;
  if (natural) {
    const fit = ('fit' in clip && clip.fit) || 'cover';
    if (fit === 'fill') { dw = W; dh = H; } else {
      const k = fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      dw = sw * k; dh = sh * k;
    }
  } else {
    const base = short * 0.95;
    const asp = clip.type === 'shape' ? clipShapeAspect(clip) : sw / sh;
    dh = asp >= 1 ? base / asp : base;
    dw = dh * asp;
  }
  const s = Math.max(0.0001, natural ? tf.scale : tf.scale) * tv.scale * anim.scale * geo.scale;
  dw *= s; dh *= s;
  const shake = tv.shake ? { x: (hash(Math.floor(t * 30)) - 0.5) * 0.06 * tv.shake, y: (hash(Math.floor(t * 30) + 5) - 0.5) * 0.06 * tv.shake } : { x: 0, y: 0 };
  const cx = W / 2 + (tf.x + tv.dx + anim.dx + geo.dx + shake.x) * W;
  const cy = H / 2 + (tf.y + tv.dy + anim.dy + geo.dy + shake.y) * H;
  const rot = tf.rotation + tv.rotation + anim.rotation + geo.rotation;
  const flipX = ('flipH' in clip && clip.flipH ? -1 : 1) * anim.scaleX;
  const flipY = 'flipV' in clip && clip.flipV ? -1 : 1;
  const blurPx = Math.max(tv.blur, anim.blur) * short * 0.03;
  const css = [f.css !== 'none' ? f.css : '', blurPx > 0.3 ? `blur(${blurPx.toFixed(1)}px)` : ''].filter(Boolean).join(' ') || 'none';

  const surfaceWork = !!(f.temperature || f.tint || f.fade || f.vignette || f.grain || tv.glitch > 0.01 || tv.pixelate > 0.01
    || tv.rgbSplit > 0.01 || hasSurfaceEffects(effects) || ('mask' in clip && clip.mask));
  const blend = ('blendMode' in clip && clip.blendMode && clip.blendMode !== 'normal') ? BLEND[clip.blendMode] : 'source-over';

  const paint = (target: Ctx, alpha: number) => {
    target.save();
    const shifted = tv.dx !== 0 || tv.dy !== 0;
    if (shifted) { target.beginPath(); target.rect(tv.dx * W, tv.dy * H, W, H); target.clip(); }
    if (tv.reveal) {
      target.beginPath();
      const pr = tv.reveal.progress;
      if (tv.reveal.kind === 'wipe-left') target.rect(W * (1 - pr), 0, W * pr, H);
      else if (tv.reveal.kind === 'wipe-right') target.rect(0, 0, W * pr, H);
      else if (tv.reveal.kind === 'wipe-up') target.rect(0, H * (1 - pr), W, H * pr);
      else target.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * pr, 0, Math.PI * 2);
      target.clip();
    }
    target.filter = css;
    const place = (offsetX: number) => {
      target.save();
      target.translate(cx + offsetX, cy);
      if (rot) target.rotate((rot * Math.PI) / 180);
      if (flipX !== 1 || flipY !== 1) target.scale(flipX, flipY);
      target.drawImage(src!, -dw / 2, -dh / 2, dw, dh);
      target.restore();
    };
    if (tv.motionBlur > 0.05) {
      const n = 7, spread = W * 0.12 * tv.motionBlur;
      for (let i = 0; i < n; i++) {
        target.globalAlpha = alpha * (i === (n - 1) / 2 ? 0.5 : 0.18);
        place(((i / (n - 1)) - 0.5) * spread);
      }
    } else {
      target.globalAlpha = alpha;
      place(0);
    }
    target.restore();
  };

  if (!surfaceWork && blend === 'source-over') {
    paint(ctx, opacity);
  } else {
    const { c, ctx: lc } = scratch(ctx.canvas, W, H, 1);
    paint(lc, 1);
    if (surfaceWork) {
      applyGrade(lc, f, W, H, t);
      applySurfaceEffects(lc, W, H, effects, t);
      if (tv.pixelate > 0.01) pixelateInPlace(lc, W, H, 2 + tv.pixelate * short / 14);
      if (tv.rgbSplit > 0.01) rgbSplitInPlace(lc, W, H, W * 0.04 * tv.rgbSplit);
      if (tv.glitch > 0.01) glitchInPlace(lc, W, H, tv.glitch, t);
      if ('mask' in clip && clip.mask) applyMask(lc, clip.mask, W, H);
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(c as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  /* sobreposições do quadro inteiro vindas da transição */
  if (tv.flash > 0) overlayColor(ctx, '#ffffff', Math.min(1, tv.flash), W, H);
  if (tv.dip) overlayColor(ctx, tv.dip.color, tv.dip.alpha, W, H);
  if (tv.burn > 0) filmBurn(ctx, W, H, tv.burn, t);
}

function overlayColor(ctx: Ctx, color: string, alpha: number, W: number, H: number) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ---------- camada de ajuste: aplica filtros/efeitos a tudo que já está desenhado ---------- */

export function applyAdjustment(ctx: Ctx, clip: AdjustmentClip, t: Seconds, W: number, H: number) {
  const f = resolveFilters(clip.filters, clip.colorPreset, H / 1080);
  const anyFx = f.css !== 'none' || needsPixelGrade(f) || f.temperature || f.tint || f.fade || f.vignette || f.grain || clip.effects?.length || !!clip.colorGrade;
  if (!anyFx) return;
  const local = t - clip.start;
  // entra/sai suave em 0,2 s p/ não "estalar"
  const amt = Math.min(1, local / 0.2, (clip.duration - local) / 0.2);
  const { c: snap, ctx: sc } = scratch(ctx.canvas, W, H, 2);
  sc.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
  let base: CanvasImageSource = snap as CanvasImageSource;
  if (needsPixelGrade(f)) {
    const out = processPixels(snap as TexImageSource, W, H, W, H, { highlights: f.highlights, shadows: f.shadows, sharpen: f.sharpen });
    if (out) { const { c, ctx: g } = scratch(ctx.canvas, W, H, 10); g.drawImage(out as CanvasImageSource, 0, 0); base = c as CanvasImageSource; }
  }
  if (clip.colorGrade) {
    const g = gradeLayer(base, clip.colorGrade, W, H);
    if (g) { const { c, ctx: gc } = scratch(ctx.canvas, W, H, 12); gc.drawImage(g, 0, 0); base = c as CanvasImageSource; }
  }
  const { c: work, ctx: wc } = scratch(ctx.canvas, W, H, 11);
  wc.filter = f.css;
  wc.drawImage(base, 0, 0);
  wc.filter = 'none';
  applyGrade(wc, f, W, H, t);
  applySurfaceEffects(wc, W, H, clip.effects, t);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, amt);
  ctx.drawImage(work as CanvasImageSource, 0, 0);
  ctx.restore();
}

/* texto e legendas: lib/engine/textDraw.ts (dono: biblioteca) */
export { drawTextClip, drawCaptions } from './textDraw';
export type { WordPaint } from './textDraw';

export type { ResolvedFilters };
