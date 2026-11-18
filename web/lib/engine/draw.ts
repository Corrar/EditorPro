/* desenho em canvas 2D: mídia (cover + transform + filtros + transições), textos e legendas */
import type { CaptionStyle, Project, Seconds, TextClip, TextStyle } from '../types';
import { interpolateTransform } from './easing';
import { resolveFilters, type ResolvedFilters } from './filters';
import { fadeOpacity, type LayerItem } from './timing';
import { transitionVisual, type TransitionVisual } from './transitions';
import { layoutWords, splitText, textAnimState, fontPx, type AnimState } from './text';
import { captionLook, chunkAt, chunkCaptions, wordStates, type CaptionChunk } from './captions';
import { easeOutBack, easeOutBounce, ease, clamp01 } from './easing';
import type { MediaElement, MediaSources } from './index';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/* ---------- utilidades de canvas ---------- */

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const scratchPool = new WeakMap<object, AnyCanvas[]>();
/** canvas temporário do mesmo tamanho do destino (reaproveitado) */
function scratch(owner: object, w: number, h: number, slot: number): { c: AnyCanvas; ctx: Ctx } {
  let list = scratchPool.get(owner);
  if (!list) { list = []; scratchPool.set(owner, list); }
  let c = list[slot];
  if (!c || c.width !== w || c.height !== h) {
    c = makeCanvas(w, h);
    list[slot] = c;
  }
  const ctx = c.getContext('2d') as Ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  return { c, ctx };
}

let noiseTile: AnyCanvas | null = null;
function getNoise(): AnyCanvas {
  if (noiseTile) return noiseTile;
  const n = 160;
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d') as Ctx;
  const img = ctx.createImageData(n, n);
  let seed = 1234567;
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 110;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

/** pseudoaleatório determinístico (glitch/grão iguais no preview e no export) */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function mediaSize(el: MediaElement): { w: number; h: number } | null {
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

/* ---------- mídia visual ---------- */

interface Placement { cx: number; cy: number; dw: number; dh: number; rot: number }

function drawPlaced(ctx: Ctx, el: CanvasImageSource, pl: Placement, offsetX = 0) {
  ctx.save();
  ctx.translate(pl.cx + offsetX, pl.cy);
  if (pl.rot) ctx.rotate((pl.rot * Math.PI) / 180);
  ctx.drawImage(el, -pl.dw / 2, -pl.dh / 2, pl.dw, pl.dh);
  ctx.restore();
}

function applyOverlays(ctx: Ctx, f: ResolvedFilters, W: number, H: number, t: Seconds) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  if (f.temperature) {
    const a = Math.abs(f.temperature) * 0.22;
    ctx.fillStyle = f.temperature > 0 ? `rgba(255,138,38,${a})` : `rgba(38,120,255,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.vignette) {
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.9 * f.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.grain) {
    const tile = getNoise();
    const frame = Math.floor(t * 24);
    const ox = Math.floor(hash(frame) * tile.width);
    const oy = Math.floor(hash(frame + 99) * tile.height);
    const pat = ctx.createPattern(tile as CanvasImageSource, 'repeat');
    if (pat) {
      ctx.globalAlpha = 0.55 * f.grain;
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + ox, H + oy);
    }
  }
  ctx.restore();
}

function drawGlitch(ctx: Ctx, src: AnyCanvas, W: number, H: number, amount: number, t: Seconds) {
  const frame = Math.floor(t * 30);
  // separação RGB: cópias deslocadas com canal tingido somadas por cima
  const shift = Math.max(2, W * 0.025 * amount);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.45 * amount;
  const tint = (color: string, dx: number) => {
    const { c, ctx: tctx } = scratch(src, W, H, 0);
    tctx.drawImage(src as CanvasImageSource, 0, 0);
    tctx.globalCompositeOperation = 'multiply';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, W, H);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(src as CanvasImageSource, 0, 0);
    ctx.drawImage(c as CanvasImageSource, dx, 0);
  };
  tint('#ff0000', -shift);
  tint('#00ffff', shift);
  ctx.restore();
  // fatias horizontais deslocadas
  const slices = 3 + Math.floor(hash(frame) * 5);
  for (let i = 0; i < slices; i++) {
    const y = Math.floor(hash(frame * 7 + i) * H);
    const h = Math.max(2, Math.floor(hash(frame * 13 + i) * H * 0.08));
    const dx = (hash(frame * 17 + i) - 0.5) * W * 0.18 * amount;
    ctx.drawImage(src as CanvasImageSource, 0, y, W, h, dx, y, W, h);
  }
}

/** desenha um item visual (vídeo/imagem) no contexto */
export function drawLayer(ctx: Ctx, layer: LayerItem, t: Seconds, el: MediaElement | undefined, W: number, H: number): void {
  if (!el) return;
  const size = mediaSize(el);
  if (!size) return;
  const clip = layer.clip;
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  const tf = interpolateTransform(clip.transform, clip.keyframes, local);
  const tv: TransitionVisual = layer.transition
    ? transitionVisual(layer.transition.kind, layer.transition.progress, layer.transition.role)
    : { opacity: 1, dx: 0, dy: 0, scale: 1, motionBlur: 0, flash: 0, glitch: 0 };
  const opacity = Math.max(0, Math.min(1, tf.opacity * tv.opacity * (layer.transition?.role === 'out' ? 1 : fadeOpacity(clip, t))));
  if (opacity <= 0.001 && !tv.flash) return;

  const cover = Math.max(W / size.w, H / size.h);
  const s = cover * Math.max(0.0001, tf.scale) * tv.scale;
  // Transform.x/y: fração da largura/altura do quadro (x=0.5 desloca meio quadro p/ direita)
  const pl: Placement = {
    cx: W / 2 + (tf.x + tv.dx) * W,
    cy: H / 2 + (tf.y + tv.dy) * H,
    dw: size.w * s,
    dh: size.h * s,
    rot: tf.rotation,
  };
  const f = resolveFilters(clip.filters, clip.type === 'video' ? clip.colorPreset : undefined, H / 1080);
  const needsScratch = f.temperature !== 0 || f.vignette > 0 || f.grain > 0 || tv.glitch > 0.01;
  const src = el as CanvasImageSource;

  const paint = (target: Ctx, alpha: number) => {
    // em slide/chicote cada clipe fica preso ao seu quadro deslocado (mídia mais larga não "vaza")
    const shifted = tv.dx !== 0 || tv.dy !== 0;
    if (shifted) {
      target.save();
      target.beginPath();
      target.rect(tv.dx * W, tv.dy * H, W, H);
      target.clip();
    }
    target.filter = f.css;
    if (tv.motionBlur > 0.05) {
      const n = 7;
      const spread = W * 0.12 * tv.motionBlur;
      for (let i = 0; i < n; i++) {
        target.globalAlpha = alpha * (i === (n - 1) / 2 ? 0.5 : 0.18);
        drawPlaced(target, src, pl, ((i / (n - 1)) - 0.5) * spread);
      }
    } else {
      target.globalAlpha = alpha;
      drawPlaced(target, src, pl);
    }
    target.filter = 'none';
    target.globalAlpha = 1;
    if (shifted) target.restore();
  };

  if (!needsScratch) {
    ctx.save();
    paint(ctx, opacity);
    ctx.restore();
  } else {
    const { c, ctx: sctx } = scratch(ctx.canvas, W, H, 1);
    paint(sctx, 1);
    applyOverlays(sctx, f, W, H, t);
    ctx.save();
    ctx.globalAlpha = opacity;
    if (tv.glitch > 0.01) drawGlitch(ctx, c, W, H, tv.glitch, t);
    else ctx.drawImage(c as CanvasImageSource, 0, 0);
    ctx.restore();
  }

  if (tv.flash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, tv.flash);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
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
}

function fontString(style: TextStyle, px: number, weight: number) {
  const fam = style.fontFamily?.trim() || 'Poppins';
  const quoted = /[\s,]/.test(fam) && !/["']/.test(fam) ? `"${fam}"` : fam;
  return `${weight} ${px}px ${quoted}, Poppins, system-ui, sans-serif`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBlock(ctx: Ctx, P: BlockParams, H: number) {
  if (P.anim.opacity <= 0.001 || !P.words.length) return;
  ctx.save();
  ctx.font = fontString(P.style, P.px, P.weight);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const strokeW = P.stroke && P.style.strokeWidth && P.style.strokeColor ? (P.style.strokeWidth * H) / 1920 * 2 : 0;
  const reserve = Math.max(1, P.reserve ?? 1);
  const gap = strokeW * 0.6 + P.px * 0.04;
  const measure = (s: string) => (s === ' ' ? ctx.measureText(' ').width + gap : ctx.measureText(s).width * reserve);
  const lines = layoutWords(P.words, measure, P.maxWidth, P.breaks);
  const lh = P.px * 1.2;
  const blockH = lines.length * lh;
  const blockW = Math.max(...lines.map((l) => l.width));
  ctx.globalAlpha = P.anim.opacity;
  ctx.translate(P.cx, P.cy + P.anim.dy * P.px);
  if (P.anim.scale !== 1) ctx.scale(P.anim.scale, P.anim.scale);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  let charsLeft = P.anim.visibleChars;
  const lineX = (lw: number) => {
    if (P.style.align === 'left') return -blockW / 2;
    if (P.style.align === 'right') return blockW / 2 - lw;
    return -lw / 2;
  };

  // caixas de fundo por linha
  if (P.box) {
    ctx.save();
    ctx.fillStyle = P.box;
    lines.forEach((l, li) => {
      const x0 = lineX(l.width);
      const y = -blockH / 2 + li * lh;
      const padX = P.px * 0.32, padY = P.px * 0.08;
      roundRect(ctx, x0 - padX, y - padY + lh * 0.02, l.width + padX * 2, lh + padY * 2 - lh * 0.04, P.px * 0.22);
      ctx.fill();
    });
    ctx.restore();
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
      ctx.save();
      const wx = x0 + w.x + w.width / 2;
      ctx.translate(wx, y);
      if (paint.scale !== 1) ctx.scale(paint.scale, paint.scale);
      const tx = -ctx.measureText(w.text).width / 2;
      if (P.shadow !== 'none') {
        ctx.shadowColor = P.shadow === 'hard' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = P.px * (P.shadow === 'hard' ? 0.08 : 0.18);
        ctx.shadowOffsetY = P.px * (P.shadow === 'hard' ? 0.06 : 0.03);
      }
      if (strokeW > 0) {
        ctx.strokeStyle = P.style.strokeColor!;
        ctx.lineWidth = strokeW;
        ctx.strokeText(text, tx, 0);
        ctx.shadowColor = 'transparent';
      }
      if (P.glow) {
        ctx.shadowColor = P.glow;
        ctx.shadowBlur = P.px * 0.45;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = paint.color;
        ctx.fillText(text, tx, 0);
        ctx.shadowBlur = P.px * 0.18;
      }
      ctx.fillStyle = paint.color;
      ctx.fillText(text, tx, 0);
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
  const anim = textAnimState(clip.animation, local, clip.duration, raw.replace(/\s+/g, ' ').length);
  const hl = style.highlightColor || style.color;
  const paints = clip.animation === 'karaoke'
    ? (i: number) => ({ color: i < Math.ceil(anim.progress * words.length + 0.0001) ? hl : style.color, scale: 1 })
    : undefined;
  drawBlock(ctx, {
    words, breaks, style, px: fontPx(style.fontSize, H), cx: clip.position.x * W, cy: clip.position.y * H,
    maxWidth: W * 0.86, anim, paints, box: style.background || undefined, stroke: true,
    shadow: style.shadow ? 'soft' : 'none', weight: style.fontWeight || 700,
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

function captionAnim(style: CaptionStyle, local: number, duration: number): AnimState {
  const s: AnimState = { opacity: 1, dy: 0, scale: 1, visibleChars: Infinity, progress: 0 };
  const p = clamp01(local / 0.18);
  switch (style.animation) {
    case 'pop': s.scale = 0.7 + 0.3 * easeOutBack(p, 2.4); s.opacity = clamp01(p * 3); break;
    case 'fade': s.opacity = ease('easeOut', clamp01(local / 0.15)); break;
    case 'slide-up': s.dy = (1 - ease('easeOut', p)) * 0.5; s.opacity = p; break;
    case 'bounce': s.dy = -(1 - easeOutBounce(clamp01(local / 0.4))) * 0.6; break;
    default: break;
  }
  if (duration < 0) s.opacity = 0;
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
  const anim = captionAnim(style, t - chunk.start, chunk.end - chunk.start);
  if (style.animation === 'typewriter') {
    // revela palavra a palavra conforme são faladas
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
