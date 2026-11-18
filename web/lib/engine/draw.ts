/* =====================================================================
   Desenho em canvas 2D (composição) + WebGL por pixel (gl.ts).
   Pipeline de uma camada visual (vídeo/imagem/sticker/forma):
   fonte → [recorte/chroma/realces/sombras/nitidez (GL)] → [remover fundo]
   → geometria (encaixe, transform/keyframes, animações, transição, tremor)
   → filtros CSS → superfície da camada (gradação, efeitos, máscara,
   pixelado/RGB) → composição no quadro (opacidade + modo de mesclagem)
   ===================================================================== */
import type {
  AdjustmentClip, BlendMode, CaptionStyle, Project, Seconds, TextClip, TextStyle,
} from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { interpolateTransform, easeOutBack, easeOutBounce, ease, clamp01 } from './easing';
import { resolveFilters, needsPixelGrade, type ResolvedFilters } from './filters';
import { fadeOpacity, type LayerItem } from './timing';
import { transitionVisual, NEUTRAL_TRANSITION, type TransitionVisual } from './transitions';
import { layoutWords, splitText, textAnimState, fontPx, type AnimState } from './text';
import { captionLook, chunkAt, chunkCaptions, wordStates, type CaptionChunk } from './captions';
import { clipAnimFx } from './animations';
import { applyGrade, applySurfaceEffects, effectGeometry, filmBurn, glitchInPlace, hasSurfaceEffects, pixelateInPlace, rgbSplitInPlace } from './effects';
import { applyMask } from './masks';
import { processPixels } from './gl';
import { emojiCanvas, shapeCanvas, shapeAspect } from './shapes';
import { getSegMask, requestSegMask } from './segment';
import { hash, scratch, type AnyCanvas, type Ctx } from './surface';
import type { MediaElement } from './index';

export type { Ctx } from './surface';

export function mediaSize(el: MediaElement | AnyCanvas): { w: number; h: number } | null {
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

  /* pré-processamento por pixel (GL) */
  const crop = natural && 'crop' in clip && clip.crop && (clip.crop.w < 0.999 || clip.crop.h < 0.999 || clip.crop.x > 0.001 || clip.crop.y > 0.001) ? clip.crop : undefined;
  const f = resolveFilters('filters' in clip ? clip.filters : undefined, clip.type === 'video' ? clip.colorPreset : undefined, H / 1080);
  const chroma = 'chromaKey' in clip && clip.chromaKey ? clip.chromaKey : undefined;
  const cw = crop ? sw * crop.w : sw, chh = crop ? sh * crop.h : sh;
  if (crop || chroma || needsPixelGrade(f)) {
    const k = Math.min(1, (Math.max(W, H) * 1.25) / Math.max(cw, chh));
    const out = processPixels(src as TexImageSource, sw, sh, cw * k, chh * k, {
      crop, chroma, highlights: f.highlights, shadows: f.shadows, sharpen: f.sharpen,
    });
    if (out) {
      // copia p/ superfície própria (o canvas GL é compartilhado)
      const { c, ctx: pc } = scratch(clip, out.width, out.height, 0);
      pc.drawImage(out as CanvasImageSource, 0, 0);
      src = c as CanvasImageSource; sw = c.width; sh = c.height;
    }
  }

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
    const asp = clip.type === 'shape' ? shapeAspect(clip.shape) : sw / sh;
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
  const anyFx = f.css !== 'none' || needsPixelGrade(f) || f.temperature || f.tint || f.fade || f.vignette || f.grain || clip.effects?.length;
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

/* ---------- texto ---------- */

export interface WordPaint { color: string; scale: number }

interface BlockParams {
  words: string[];
  breaks?: Set<number>;
  style: TextStyle;
  px: number;
  cx: number;
  cy: number;
  maxWidth: number;
  anim: AnimState;
  paints?: (i: number) => WordPaint;
  box?: string;
  glow?: string;
  stroke: boolean;
  shadow: 'none' | 'soft' | 'hard';
  weight: number;
  /** escala máxima que uma palavra pode ganhar (reserva espaço p/ não encostar nas vizinhas) */
  reserve?: number;
  /** transform extra do bloco (keyframes/rotação/escala do clipe de texto) */
  rotation?: number;
  scale?: number;
  opacity?: number;
}

function fontString(style: TextStyle, px: number, weight: number) {
  const fam = style.fontFamily?.trim() || 'Poppins';
  const quoted = /[\s,]/.test(fam) && !/["']/.test(fam) ? `"${fam}"` : fam;
  return `${style.italic ? 'italic ' : ''}${weight} ${px}px ${quoted}, Poppins, system-ui, sans-serif`;
}

function drawBlock(ctx: Ctx, P: BlockParams, H: number) {
  const alpha = P.anim.opacity * (P.opacity ?? 1) * (P.style.opacity ?? 1);
  if (alpha <= 0.001 || !P.words.length) return;
  ctx.save();
  ctx.font = fontString(P.style, P.px, P.weight);
  const spacing = P.style.letterSpacing ? (P.style.letterSpacing * H) / 1920 : 0;
  const ls = ctx as Ctx & { letterSpacing?: string };
  if (spacing && 'letterSpacing' in ls) ls.letterSpacing = `${spacing.toFixed(1)}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const strokeW = P.stroke && P.style.strokeWidth && P.style.strokeColor ? (P.style.strokeWidth * H) / 1920 * 2 : 0;
  const reserve = Math.max(1, P.reserve ?? 1);
  const gap = strokeW * 0.6 + P.px * 0.04;
  const measure = (s: string) => (s === ' ' ? ctx.measureText(' ').width + gap : ctx.measureText(s).width * reserve);
  const lines = layoutWords(P.words, measure, P.maxWidth, P.breaks);
  const lh = P.px * (P.style.lineHeight && P.style.lineHeight > 0.5 ? P.style.lineHeight : 1.2);
  const blockH = lines.length * lh;
  const blockW = Math.max(...lines.map((l) => l.width));
  ctx.globalAlpha = alpha;
  ctx.translate(P.cx + P.anim.dx * P.px, P.cy + P.anim.dy * P.px);
  const rot = (P.rotation ?? 0) + P.anim.rotation;
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  const sc = P.anim.scale * (P.scale ?? 1);
  if (sc !== 1) ctx.scale(sc, sc);
  if (P.anim.blur > 0.02) ctx.filter = `blur(${(P.anim.blur * P.px * 0.25).toFixed(1)}px)`;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  let charsLeft = P.anim.visibleChars;
  const lineX = (lw: number) => {
    if (P.style.align === 'left') return -blockW / 2;
    if (P.style.align === 'right') return blockW / 2 - lw;
    return -lw / 2;
  };

  if (P.box) {
    ctx.save();
    ctx.fillStyle = P.box;
    const radius = P.style.backgroundRadius !== undefined ? (P.style.backgroundRadius * H) / 1920 : P.px * 0.22;
    lines.forEach((l, li) => {
      const x0 = lineX(l.width);
      const y = -blockH / 2 + li * lh;
      const padX = P.px * 0.32, padY = P.px * 0.08;
      ctx.beginPath();
      ctx.roundRect(x0 - padX, y - padY + lh * 0.02, l.width + padX * 2, lh + padY * 2 - lh * 0.04, Math.max(0, radius));
      ctx.fill();
    });
    ctx.restore();
  }

  let gradient: CanvasGradient | null = null;
  if (P.style.gradient) {
    const a = ((P.style.gradient.angle ?? 90) * Math.PI) / 180;
    const rx = (Math.sin(a) * blockW) / 2, ry = (-Math.cos(a) * blockH) / 2;
    gradient = ctx.createLinearGradient(-rx, -ry, rx, ry);
    gradient.addColorStop(0, P.style.gradient.from);
    gradient.addColorStop(1, P.style.gradient.to);
  }

  lines.forEach((l, li) => {
    const x0 = lineX(l.width);
    const y = -blockH / 2 + li * lh + lh / 2;
    for (const w of l.words) {
      if (charsLeft <= 0) break;
      let text = w.text;
      if (Number.isFinite(charsLeft)) {
        if (text.length > charsLeft) text = text.slice(0, charsLeft);
        charsLeft -= w.text.length + 1;
      }
      const paint = P.paints?.(w.index) ?? { color: P.style.color, scale: 1 };
      const useGradient = gradient && paint.color === P.style.color;
      ctx.save();
      const wy = y + (P.anim.wave ? Math.sin(P.anim.wavePhase + w.index * 0.9) * P.anim.wave * P.px : 0);
      const wx = x0 + w.x + w.width / 2;
      ctx.translate(wx, wy);
      if (paint.scale !== 1) ctx.scale(paint.scale, paint.scale);
      const tw = ctx.measureText(w.text).width;
      const tx = -tw / 2;
      if (P.shadow !== 'none') {
        ctx.shadowColor = P.shadow === 'hard' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = P.px * (P.shadow === 'hard' ? 0.08 : 0.18);
        ctx.shadowOffsetY = P.px * (P.shadow === 'hard' ? 0.06 : 0.03);
      }
      if (P.anim.glitch > 0.02) {
        const o = P.px * 0.08 * P.anim.glitch;
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.globalAlpha *= 0.8;
        ctx.fillStyle = '#ff2a55'; ctx.fillText(text, tx - o, 0);
        ctx.fillStyle = '#22e6ff'; ctx.fillText(text, tx + o, 0);
        ctx.restore();
      }
      if (strokeW > 0) {
        ctx.strokeStyle = P.style.strokeColor!;
        ctx.lineWidth = strokeW;
        ctx.strokeText(text, tx, 0);
        ctx.shadowColor = 'transparent';
      }
      const fill = useGradient ? (gradient as CanvasGradient) : paint.color;
      if (P.glow) {
        ctx.shadowColor = P.glow;
        ctx.shadowBlur = P.px * 0.45;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = fill;
        ctx.fillText(text, tx, 0);
        ctx.shadowBlur = P.px * 0.18;
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, tx, 0);
      if (P.style.underline) {
        ctx.shadowColor = 'transparent';
        const uw = Math.min(tw, ctx.measureText(text).width);
        ctx.fillRect(tx, P.px * 0.42, uw + (w !== l.words[l.words.length - 1] ? 0 : 0), Math.max(1, P.px * 0.06));
      }
      ctx.restore();
    }
  });
  ctx.restore();
}

export function drawTextClip(ctx: Ctx, clip: TextClip, t: Seconds, W: number, H: number) {
  const style = clip.style;
  const raw = style.uppercase ? clip.text.toLocaleUpperCase('pt-BR') : clip.text;
  const { words, breaks } = splitText(raw);
  const local = t - clip.start;
  const anim = textAnimState(clip.animation, local, clip.duration, raw.replace(/\s+/g, ' ').length, clip.animationOut, clip.animationLoop);
  const tf = interpolateTransform({ x: 0, y: 0, scale: clip.scale ?? 1, rotation: clip.rotation ?? 0, opacity: 1 }, clip.keyframes, Math.max(0, local));
  const hl = style.highlightColor || style.color;
  const paints = clip.animation === 'karaoke'
    ? (i: number) => ({ color: i < Math.ceil(anim.progress * words.length + 0.0001) ? hl : style.color, scale: 1 })
    : undefined;
  drawBlock(ctx, {
    words, breaks, style, px: fontPx(style.fontSize, H), cx: (clip.position.x + tf.x) * W, cy: (clip.position.y + tf.y) * H,
    maxWidth: W * 0.86, anim, paints, box: style.background || undefined, stroke: true,
    shadow: style.shadow ? 'soft' : 'none', weight: style.fontWeight || 700,
    rotation: tf.rotation, scale: tf.scale, opacity: tf.opacity,
  }, H);
}

/* ---------- legendas ---------- */

const chunkCache = new WeakMap<object, { maxWords: number; chunks: CaptionChunk[] }>();
function cachedChunks(p: Project): CaptionChunk[] {
  const key = p.captions.segments;
  const max = p.captions.style.maxWords;
  const hit = chunkCache.get(key);
  if (hit && hit.maxWords === max) return hit.chunks;
  const chunks = chunkCaptions(key, max);
  chunkCache.set(key, { maxWords: max, chunks });
  return chunks;
}

function captionAnim(style: CaptionStyle, local: number): AnimState {
  const s = textAnimState('none', local, 1, 0);
  const p = clamp01(local / 0.18);
  switch (style.animation) {
    case 'pop': s.scale = 0.7 + 0.3 * easeOutBack(p, 2.4); s.opacity = clamp01(p * 3); break;
    case 'fade': s.opacity = ease('easeOut', clamp01(local / 0.15)); break;
    case 'slide-up': s.dy = (1 - ease('easeOut', p)) * 0.5; s.opacity = p; break;
    case 'slide-down': s.dy = -(1 - ease('easeOut', p)) * 0.5; s.opacity = p; break;
    case 'zoom': s.scale = 1 + 0.5 * (1 - ease('easeOut', p)); s.opacity = p; break;
    case 'bounce': s.dy = -(1 - easeOutBounce(clamp01(local / 0.4))) * 0.6; break;
    case 'blur': s.blur = 1 - p; s.opacity = clamp01(p * 2); break;
    case 'wave': s.wave = 0.12; s.wavePhase = local * 8; break;
    case 'glitch': s.glitch = local < 0.15 ? 1 - local / 0.15 : 0; break;
    default: break;
  }
  s.opacity = Math.min(1, s.opacity);
  return s;
}

export function drawCaptions(ctx: Ctx, p: Project, t: Seconds, W: number, H: number) {
  const cap = p.captions;
  if (!cap.enabled || !cap.segments.length) return;
  const chunk = chunkAt(cachedChunks(p), t);
  if (!chunk) return;
  const style = cap.style;
  const look = captionLook(style.preset);
  const states = wordStates(chunk, t, look);
  const words = chunk.words.map((w) => (style.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text));
  const hl = style.highlightColor || '#FFD23F';
  const anim = captionAnim(style, t - chunk.start);
  if (style.animation === 'typewriter') {
    const shown = chunk.words.filter((w) => t >= w.start).length;
    anim.visibleChars = words.slice(0, shown).reduce((a, w) => a + w.length + 1, 0);
  }
  const weight = look.maxWeight ? Math.min(style.fontWeight || 700, look.maxWeight) : style.fontWeight || 800;
  drawBlock(ctx, {
    words, style, px: fontPx(style.fontSize, H), cx: style.position.x * W, cy: style.position.y * H,
    maxWidth: W * 0.84, anim,
    paints: (i) => {
      const st = states[i];
      const pop = st.active && look.activeScale !== 1 ? 1 + (look.activeScale - 1) * easeOutBack(clamp01((t - chunk.words[i].start) / 0.12), 2) : 1;
      return { color: st.highlighted ? hl : style.color, scale: pop };
    },
    box: look.box ? style.background || 'rgba(0,0,0,0.72)' : style.background || undefined,
    glow: look.glow ? hl : undefined,
    stroke: look.stroke,
    reserve: look.activeScale,
    shadow: look.shadow === 'none' ? 'none' : style.shadow === false ? 'none' : look.shadow,
    weight,
  }, H);
}

export type { ResolvedFilters };
