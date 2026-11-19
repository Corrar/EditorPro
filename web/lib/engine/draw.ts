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
import { charOffsets, unitFx, unitKindOf, UNIT_NEUTRAL, type UnitFx, type UnitKind } from './textUnits';
import { basePresetFor, emojiForWord, requestFont } from './fonts';
import { applyGrade, applySurfaceEffects, effectGeometry, filmBurn, glitchInPlace, hasSurfaceEffects, pixelateInPlace, rgbSplitInPlace } from './effects';
import { applyMask } from './masks';
import { BLEND_OPS } from '../fx/blend';
import { processPixels } from './gl';
import { emojiCanvas, shapeCanvas, clipShapeAspect } from './shapes';
import { getSegMask, requestSegMask } from './segment';
import { hash, scratch, type AnyCanvas, type Ctx } from './surface';
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

/* modos de mesclagem: tabela no catálogo da sessão fx (lib/fx/blend.ts) */
const BLEND: Record<BlendMode, GlobalCompositeOperation> = BLEND_OPS;

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

export interface WordPaint {
  color: string;
  scale: number;
  /** opacidade extra da palavra (karaokê "acendendo") */
  alpha?: number;
  /** caixa atrás da palavra (palavra ativa / destaque) */
  box?: { color: string; radius: number; padding: number };
}

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
  /** animação por unidade (palavra ou letra global) */
  unit?: { kind: UnitKind; fx: (i: number) => UnitFx };
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
  /** máximo de linhas: reduz a fonte até caber */
  maxLines?: number;
  /** emoji desenhado acima de uma palavra */
  emoji?: { index: number; char: string; pop: number };
}

function fontString(style: TextStyle, px: number, weight: number) {
  const fam = style.fontFamily?.trim() || 'Poppins';
  const quoted = /[\s,]/.test(fam) && !/["']/.test(fam) ? `"${fam}"` : fam;
  return `${style.italic ? 'italic ' : ''}${weight} ${px}px ${quoted}, Poppins, system-ui, sans-serif`;
}

const mergeUnit = (a: UnitFx, b: UnitFx): UnitFx => ({
  opacity: a.opacity * b.opacity, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale,
  rotation: a.rotation + b.rotation, highlight: Math.max(a.highlight, b.highlight),
});

function drawBlock(ctx: Ctx, P: BlockParams, H: number) {
  const alpha = P.anim.opacity * (P.opacity ?? 1) * (P.style.opacity ?? 1);
  if (alpha <= 0.001 || !P.words.length) return;
  const k = H / 1920;
  ctx.save();
  const spacing = P.style.letterSpacing ? P.style.letterSpacing * k : 0;
  const ls = ctx as Ctx & { letterSpacing?: string };
  let px = P.px;
  const strokeOf = (size: number) => (P.stroke && P.style.strokeWidth && P.style.strokeColor ? P.style.strokeWidth * k * 2 * (size / P.px) : 0);
  const reserve = Math.max(1, P.reserve ?? 1);
  let lines: ReturnType<typeof layoutWords> = [];
  let strokeW = 0;
  // linhas máximas: diminui a fonte até caber
  for (let iter = 0; iter < 7; iter++) {
    ctx.font = fontString(P.style, px, P.weight);
    if (spacing && 'letterSpacing' in ls) ls.letterSpacing = `${(spacing * px / P.px).toFixed(1)}px`;
    strokeW = strokeOf(px);
    const gap = strokeW * 0.6 + px * 0.04;
    const measure = (s: string) => (s === ' ' ? ctx.measureText(' ').width + gap : ctx.measureText(s).width * reserve);
    lines = layoutWords(P.words, measure, P.maxWidth, P.breaks);
    if (!P.maxLines || lines.length <= P.maxLines) break;
    px *= 0.88;
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lh = px * (P.style.lineHeight && P.style.lineHeight > 0.5 ? P.style.lineHeight : 1.2);
  const blockH = lines.length * lh;
  const blockW = Math.max(...lines.map((l) => l.width));
  ctx.globalAlpha = alpha;
  ctx.translate(P.cx + P.anim.dx * px, P.cy + P.anim.dy * px);
  const rot = (P.rotation ?? 0) + P.anim.rotation;
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  const sc = P.anim.scale * (P.scale ?? 1);
  if (sc !== 1) ctx.scale(sc, sc);
  if (P.anim.blur > 0.02) ctx.filter = `blur(${(P.anim.blur * px * 0.25).toFixed(1)}px)`;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lineX = (lw: number) => {
    if (P.style.align === 'left') return -blockW / 2;
    if (P.style.align === 'right') return blockW / 2 - lw;
    return -lw / 2;
  };
  const pad = P.style.backgroundPadding !== undefined ? P.style.backgroundPadding * k : px * 0.32;
  const padY = P.style.backgroundPadding !== undefined ? P.style.backgroundPadding * k * 0.45 : px * 0.08;
  const radius = P.style.backgroundRadius !== undefined ? P.style.backgroundRadius * k : px * 0.22;
  const hl = P.style.highlightColor || '#FFD23F';

  // caixa de fundo por linha (com "revelar caixa": cresce da esquerda)
  if (P.box && P.anim.boxReveal !== 0) {
    ctx.save();
    ctx.fillStyle = P.box;
    const rev = P.anim.boxReveal < 0 ? 1 : P.anim.boxReveal;
    lines.forEach((l, li) => {
      const x0 = lineX(l.width);
      const y = -blockH / 2 + li * lh;
      const w = (l.width + pad * 2) * rev;
      if (w < 1) return;
      ctx.beginPath();
      ctx.roundRect(x0 - pad, y - padY + lh * 0.02, w, lh + padY * 2 - lh * 0.04, Math.max(0, Math.min(radius, w / 2)));
      ctx.fill();
    });
    ctx.restore();
  }
  // marca-texto varrendo
  if (P.anim.sweep > 0) {
    ctx.save();
    ctx.fillStyle = hl;
    ctx.globalAlpha *= 0.9;
    lines.forEach((l, li) => {
      const x0 = lineX(l.width);
      const yMid = -blockH / 2 + li * lh + lh / 2;
      const w = (l.width + px * 0.24) * P.anim.sweep;
      ctx.beginPath();
      ctx.roundRect(x0 - px * 0.12, yMid - px * 0.36, w, px * 0.72, px * 0.12);
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

  // sombra: detalhada (shadowColor/Blur/Offset) > simples
  const shadowOf = (): { color: string; blur: number; x: number; y: number } | null => {
    if (P.style.shadowColor) {
      return { color: P.style.shadowColor, blur: (P.style.shadowBlur ?? 12) * k, x: (P.style.shadowOffset?.x ?? 0) * k, y: (P.style.shadowOffset?.y ?? 6) * k };
    }
    if (P.shadow === 'none') return null;
    return P.shadow === 'hard'
      ? { color: 'rgba(0,0,0,0.6)', blur: px * 0.08, x: 0, y: px * 0.06 }
      : { color: 'rgba(0,0,0,0.45)', blur: px * 0.18, x: 0, y: px * 0.03 };
  };
  const shadow = shadowOf();
  const glow = P.style.glow ? { color: P.style.glow.color, blur: P.style.glow.blur * k } : P.glow ? { color: P.glow, blur: px * 0.45 } : null;
  const offsets = P.unit?.kind === 'char' ? charOffsets(P.words) : null;
  let charsLeft = P.anim.visibleChars;

  /** desenha um pedaço de texto já posicionado em (0,0) com contorno/sombra/brilho/preenchimento */
  const paintText = (text: string, tx: number, fill: string | CanvasGradient) => {
    if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; ctx.shadowOffsetX = shadow.x; ctx.shadowOffsetY = shadow.y; }
    if (P.anim.glitch > 0.02) {
      const o = px * 0.08 * P.anim.glitch;
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
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow.color; ctx.shadowBlur = glow.blur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = fill;
      ctx.fillText(text, tx, 0);
      ctx.fillText(text, tx, 0);
      ctx.restore();
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, tx, 0);
  };

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
      const ufx = P.unit?.kind === 'word' ? P.unit.fx(w.index) : UNIT_NEUTRAL;
      const wordAlpha = (paint.alpha ?? 1) * ufx.opacity;
      if (wordAlpha <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha *= wordAlpha;
      const wy = y + (P.anim.wave ? Math.sin(P.anim.wavePhase + w.index * 0.9) * P.anim.wave * px : 0) + ufx.dy * px;
      const wx = x0 + w.x + w.width / 2 + ufx.dx * px;
      ctx.translate(wx, wy);
      if (ufx.rotation) ctx.rotate((ufx.rotation * Math.PI) / 180);
      const s2 = paint.scale * ufx.scale;
      if (s2 !== 1) ctx.scale(s2, s2);
      const tw = ctx.measureText(w.text).width;
      const tx = -tw / 2;
      // caixa da palavra (palavra ativa / word-highlight)
      const wbox = paint.box ?? (ufx.highlight > 0 ? { color: hl, radius: px * 0.2, padding: px * 0.16 } : undefined);
      if (wbox) {
        ctx.save();
        ctx.globalAlpha *= ufx.highlight > 0 && !paint.box ? ufx.highlight : 1;
        ctx.fillStyle = wbox.color;
        ctx.beginPath();
        ctx.roundRect(tx - wbox.padding, -px * 0.56 - wbox.padding * 0.4, tw + wbox.padding * 2, px * 1.12 + wbox.padding * 0.8, wbox.radius);
        ctx.fill();
        ctx.restore();
      }
      const fill = gradient && paint.color === P.style.color ? gradient : paint.color;
      if (offsets && P.unit) {
        // letra a letra
        const chars = [...text];
        let acc = 0;
        chars.forEach((ch, ci) => {
          const cfx = P.unit!.fx(offsets[w.index] + ci);
          const cw = ctx.measureText(ch).width;
          if (cfx.opacity > 0.001) {
            ctx.save();
            ctx.globalAlpha *= cfx.opacity;
            ctx.translate(tx + acc + cw / 2 + cfx.dx * px, cfx.dy * px);
            if (cfx.rotation) ctx.rotate((cfx.rotation * Math.PI) / 180);
            if (cfx.scale !== 1) ctx.scale(cfx.scale, cfx.scale);
            paintText(ch, -cw / 2, fill);
            ctx.restore();
          }
          acc = ctx.measureText(chars.slice(0, ci + 1).join('')).width;
        });
      } else {
        paintText(text, tx, fill);
      }
      if (P.style.underline) {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = typeof fill === 'string' ? fill : P.style.color;
        ctx.fillRect(tx, px * 0.42, Math.min(tw, ctx.measureText(text).width), Math.max(1, px * 0.06));
      }
      if (P.emoji && P.emoji.index === w.index && P.emoji.pop > 0) {
        ctx.save();
        ctx.shadowColor = 'transparent';
        const es = px * 1.05 * P.emoji.pop;
        ctx.font = `${Math.round(es)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(P.emoji.char, 0, -lh * 0.95);
        ctx.restore();
      }
      ctx.restore();
    }
  });

  // sublinhado desenhado (animação underline-draw)
  if (P.anim.underlineDraw > 0) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = hl;
    lines.forEach((l, li) => {
      const x0 = lineX(l.width);
      const yb = -blockH / 2 + li * lh + lh / 2 + px * 0.5;
      ctx.beginPath();
      ctx.roundRect(x0, yb, l.width * P.anim.underlineDraw, Math.max(2, px * 0.09), px * 0.045);
      ctx.fill();
    });
    ctx.restore();
  }
  ctx.restore();
}

/** combina entrada/saída/loop por unidade para um texto */
function textUnits(clip: TextClip, words: string[], local: number): BlockParams['unit'] | undefined {
  const kinds = [unitKindOf(clip.animation), unitKindOf(clip.animationOut), unitKindOf(clip.animationLoop)];
  const kind = kinds.find(Boolean);
  if (!kind) return undefined;
  const count = kind === 'char' ? words.reduce((a, w) => a + [...w].length, 0) : words.length;
  const timing = { duration: clip.duration };
  return {
    kind,
    fx: (i) => {
      let fx = UNIT_NEUTRAL;
      if (unitKindOf(clip.animation) === kind) fx = mergeUnit(fx, unitFx(clip.animation, kind, i, count, local, timing, 'in'));
      if (clip.animationOut && unitKindOf(clip.animationOut) === kind) fx = mergeUnit(fx, unitFx(clip.animationOut, kind, i, count, local, timing, 'out'));
      if (clip.animationLoop && unitKindOf(clip.animationLoop) === kind) fx = mergeUnit(fx, unitFx(clip.animationLoop, kind, i, count, local, timing, 'loop'));
      return fx;
    },
  };
}

export function drawTextClip(ctx: Ctx, clip: TextClip, t: Seconds, W: number, H: number) {
  const style = clip.style;
  requestFont(style.fontFamily, style.fontWeight || 700, !!style.italic);
  const raw = style.uppercase ? clip.text.toLocaleUpperCase('pt-BR') : clip.text;
  const { words, breaks } = splitText(raw);
  const local = t - clip.start;
  // animação por unidade cuida da entrada/saída: o bloco não esmaece por conta própria
  const unitOut = unitKindOf(clip.animationOut) ? 'none' : clip.animationOut;
  const blockIn = unitKindOf(clip.animation) ? 'none' : clip.animation;
  const anim = textAnimState(blockIn, local, clip.duration, raw.replace(/\s+/g, ' ').length,
    unitKindOf(clip.animation) && !clip.animationOut ? 'none' : unitOut, unitKindOf(clip.animationLoop) ? undefined : clip.animationLoop);
  const tf = interpolateTransform({ x: 0, y: 0, scale: clip.scale ?? 1, rotation: clip.rotation ?? 0, opacity: 1 }, clip.keyframes, Math.max(0, local));
  const hl = style.highlightColor || style.color;
  const paints = clip.animation === 'karaoke'
    ? (i: number) => ({ color: i < Math.ceil(anim.progress * words.length + 0.0001) ? hl : style.color, scale: 1 })
    : undefined;
  drawBlock(ctx, {
    words, breaks, style, px: fontPx(style.fontSize, H), cx: (clip.position.x + tf.x) * W, cy: (clip.position.y + tf.y) * H,
    maxWidth: W * 0.86, anim, paints, unit: textUnits(clip, words, local), box: style.background || undefined, stroke: true,
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

function captionAnim(style: CaptionStyle, local: number, duration: number, chars: number): AnimState {
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
    case 'none': case 'typewriter': case 'karaoke': break;
    default:
      // animações de bloco novas (scale-in, blur-in, stomp, drop, marca-texto, sublinhar, caixa, tremer)
      if (!unitKindOf(style.animation)) return textAnimState(style.animation, local, Math.max(duration, 0.4), chars, 'none');
      break;
  }
  s.opacity = Math.min(1, s.opacity);
  return s;
}

export function drawCaptions(ctx: Ctx, p: Project, t: Seconds, W: number, H: number) {
  const cap = p.captions;
  if (!cap.enabled || !cap.segments.length) return;
  const chunks = cachedChunks(p);
  const chunk = chunkAt(chunks, t);
  if (!chunk) return;
  const style = cap.style;
  requestFont(style.fontFamily, style.fontWeight || 800, !!style.italic);
  const look = captionLook(basePresetFor(style.preset));
  const states = wordStates(chunk, t, look);
  const words = chunk.words.map((w) => (style.uppercase ? w.text.toLocaleUpperCase('pt-BR') : w.text));
  const hl = style.highlightColor || '#FFD23F';
  const local = t - chunk.start;
  const anim = captionAnim(style, local, chunk.end - chunk.start, words.join(' ').length);
  if (style.animation === 'typewriter') {
    const shown = chunk.words.filter((w) => t >= w.start).length;
    anim.visibleChars = words.slice(0, shown).reduce((a, w) => a + w.length + 1, 0);
  }
  // animação por palavra/letra seguindo o tempo da fala
  const kind = unitKindOf(style.animation);
  let unit: BlockParams['unit'];
  if (kind) {
    const wordStarts = chunk.words.map((w) => Math.max(0, w.start - chunk.start));
    const starts = kind === 'word' ? wordStarts : words.flatMap((w, wi) => [...w].map((_, ci) => wordStarts[wi] + ci * 0.03));
    const count = starts.length;
    unit = { kind, fx: (i) => unitFx(style.animation, kind, i, count, local, { duration: chunk.end - chunk.start, starts }, 'in') };
  }
  const activeScale = style.activeScale ?? look.activeScale;
  const weight = look.maxWeight ? Math.min(style.fontWeight || 700, look.maxWeight) : style.fontWeight || 800;
  const k = H / 1920;
  // emoji automático na 1ª palavra-chave do bloco
  let emoji: BlockParams['emoji'];
  if (style.autoEmoji) {
    for (let i = 0; i < chunk.words.length; i++) {
      const e = emojiForWord(chunk.words[i].text);
      if (e) {
        const since = t - chunk.words[i].start;
        if (since >= 0) emoji = { index: i, char: e, pop: Math.max(0.001, easeOutBack(clamp01(since / 0.25), 2.2)) };
        break;
      }
    }
  }
  const jitter = style.jitter ? (hash(Math.round(chunk.start * 1000) % 100000 + 7) - 0.5) * 2 * style.jitter : 0;
  drawBlock(ctx, {
    words, style, px: fontPx(style.fontSize, H), cx: style.position.x * W, cy: style.position.y * H,
    maxWidth: W * 0.84, anim, unit, emoji, rotation: jitter, maxLines: style.lines,
    paints: (i) => {
      const st = states[i];
      const w = chunk.words[i];
      const pop = st.active && activeScale !== 1 ? 1 + (activeScale - 1) * easeOutBack(clamp01((t - w.start) / 0.12), 2) : 1;
      const spoken = t >= w.start;
      return {
        color: st.highlighted ? hl : style.color,
        scale: pop,
        alpha: style.inactiveOpacity !== undefined && !spoken ? Math.max(0, Math.min(1, style.inactiveOpacity)) : 1,
        box: style.wordBox && st.active
          ? { color: style.wordBox.color, radius: style.wordBox.radius * k, padding: style.wordBox.padding * k }
          : undefined,
      };
    },
    box: look.box ? style.background || 'rgba(0,0,0,0.72)' : style.background || undefined,
    glow: look.glow ? hl : undefined,
    stroke: look.stroke,
    reserve: Math.max(activeScale, style.wordBox ? 1.08 : 1),
    shadow: look.shadow === 'none' ? 'none' : style.shadow === false ? 'none' : look.shadow,
    weight,
  }, H);
}

export type { ResolvedFilters };
