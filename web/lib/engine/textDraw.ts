/* =====================================================================
   Desenho de TEXTO e LEGENDAS no canvas (dono: sessão biblioteca).
   Movido de draw.ts sem mudança de comportamento. drawBlock faz o layout
   em linhas, animação de bloco e por unidade, caixas, sombra, brilho,
   contorno, gradiente e emoji; drawTextClip/drawCaptions montam os parâmetros.
   ===================================================================== */
import { animateClip } from './animate';
import type { CaptionStyle, Project, Seconds, TextClip, TextStyle } from '../types';
import { interpolateTransform, easeOutBack, easeOutBounce, ease, clamp01 } from './easing';
import { balanceLines, layoutWords, splitText, textAnimState, fontPx, type AnimState } from './text';
import { captionLook, chunkAt, chunkCaptions, clampToSafeZone, isEmphasisWord, wordStates, type CaptionChunk } from './captions';
import { charOffsets, unitFx, unitKindOf, UNIT_NEUTRAL, type UnitFx, type UnitKind } from './textUnits';
import { basePresetFor, emojiForWord, requestFont } from './fonts';
import { hash, makeCanvas, type AnyCanvas, type Ctx } from './surface';

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
    lines = (P.style.balance ? balanceLines : layoutWords)(P.words, measure, P.maxWidth, P.breaks);
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
      if (P.style.backgroundBlur && P.style.backgroundBlur > 0) {
        // "vidro": redesenha o quadro já composto, desfocado, só dentro da caixa
        ctx.save();
        ctx.clip();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = `blur(${(P.style.backgroundBlur * k).toFixed(1)}px)`;
        ctx.globalAlpha = 1;
        try { ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0); } catch { /* canvas sem leitura */ }
        ctx.restore();
        ctx.restore();
      }
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
  const curveRad = Math.abs(P.style.curve ?? 0) >= 1 ? (Math.max(-360, Math.min(360, P.style.curve!)) * Math.PI) / 180 : 0;
  let charsLeft = P.anim.visibleChars;

  /** desenha um pedaço de texto já posicionado em (0,0) com contorno/sombra/brilho/preenchimento */
  const depth = (spec: { color: string; length: number; angle?: number } | undefined, cap: number) => {
    if (!spec || spec.length <= 0) return null;
    const len = spec.length * k;
    const a = (((spec.angle ?? 45) % 360) * Math.PI) / 180;
    const steps = Math.max(1, Math.min(cap, Math.round(len)));
    return { color: spec.color, steps, dx: (Math.cos(a) * len) / steps, dy: (Math.sin(a) * len) / steps };
  };
  const longShadow = depth(P.style.longShadow, 48);
  const extrude = depth(P.style.extrude ? { color: P.style.extrude.color, length: P.style.extrude.depth, angle: P.style.extrude.angle ?? 60 } : undefined, 32);
  const extraStrokes = (P.stroke || P.style.strokes?.length) && P.style.strokes?.length
    ? P.style.strokes.reduce<{ color: string; lw: number }[]>((acc, st) => {
        const prev = acc.length ? acc[acc.length - 1].lw : strokeW;
        acc.push({ color: st.color, lw: prev + Math.max(0, st.width) * k * 2 });
        return acc;
      }, [])
    : [];
  /** camadas empilhadas atrás do texto (sombra longa / extrusão), sem sombra borrada */
  const paintDepth = (text: string, tx: number, d: NonNullable<ReturnType<typeof depth>>, withStroke: number) => {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = d.color;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = withStroke;
    for (let i = d.steps; i >= 1; i--) {
      if (withStroke > 0) ctx.strokeText(text, tx + d.dx * i, d.dy * i);
      ctx.fillText(text, tx + d.dx * i, d.dy * i);
    }
    ctx.restore();
  };

  const paintText = (text: string, tx: number, fill: string | CanvasGradient) => {
    const outer = extraStrokes.length ? extraStrokes[extraStrokes.length - 1].lw : strokeW;
    if (longShadow) paintDepth(text, tx, longShadow, outer);
    if (extrude) paintDepth(text, tx, extrude, outer);
    if (extraStrokes.length) {
      ctx.save();
      if (shadow && !longShadow && !extrude) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; ctx.shadowOffsetX = shadow.x; ctx.shadowOffsetY = shadow.y; }
      for (let i = extraStrokes.length - 1; i >= 0; i--) {
        ctx.strokeStyle = extraStrokes[i].color;
        ctx.lineWidth = extraStrokes[i].lw;
        ctx.strokeText(text, tx, 0);
        ctx.shadowColor = 'transparent';
      }
      ctx.restore();
    }
    if (shadow && !extraStrokes.length && !longShadow && !extrude) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; ctx.shadowOffsetX = shadow.x; ctx.shadowOffsetY = shadow.y; }
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
      if (curveRad) {
        // texto curvo: cada letra posicionada e girada sobre o arco da linha
        const L = Math.max(1, l.width);
        const Rr = L / curveRad;
        const cxLine = x0 + L / 2;
        const fillC = gradient && paint.color === P.style.color ? gradient : paint.color;
        ctx.save();
        ctx.globalAlpha *= wordAlpha;
        let acc = 0;
        for (const ch of [...text]) {
          const cw = ctx.measureText(ch).width;
          const phi = (x0 + w.x + acc + cw / 2 - cxLine) / Rr;
          ctx.save();
          ctx.translate(cxLine + Rr * Math.sin(phi), y + ufx.dy * px - Rr * (1 - Math.cos(phi)));
          ctx.rotate(-phi);
          paintText(ch, -cw / 2, fillC);
          ctx.restore();
          acc += cw;
        }
        ctx.restore();
        continue;
      }
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

/* cache de texto rasterizado (preview no celular: sombra/brilho/contorno custam caro) */
const TEXT_CACHE_SIZE = 10;
const TEXT_CACHE_MAX_PX = 1_600_000; // ~ prévia; no export (1080×1920) desenha direto
const textCache = new Map<string, AnyCanvas>();
export const textCacheStats = { hits: 0, clear: () => { textCache.clear(); textCacheStats.hits = 0; } };

function isStaticAnim(a: AnimState): boolean {
  const done = (v: number) => v < 0 || v >= 0.999;
  return a.opacity >= 0.999 && !a.dx && !a.dy && a.scale === 1 && !a.rotation && a.blur <= 0.02 && !a.wave && a.glitch <= 0.02
    && !Number.isFinite(a.visibleChars) && done(a.sweep) && done(a.underlineDraw) && done(a.boxReveal);
}

export function drawTextClip(ctx: Ctx, clip0: TextClip, t: Seconds, W: number, H: number) {
  // keyframes universais: style.fontSize/color/strokeWidth…, position, scale, rotation
  const clip = animateClip(clip0, t - clip0.start);
  const style = clip.style;
  const fontReady = requestFont(style.fontFamily, style.fontWeight || 700, !!style.italic);
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
  const unit = textUnits(clip, words, local);
  const params: BlockParams = {
    words, breaks, style, px: fontPx(style.fontSize, H), cx: (clip.position.x + tf.x) * W, cy: (clip.position.y + tf.y) * H,
    maxWidth: W * 0.86, anim, paints, unit, box: style.background || undefined, stroke: true,
    shadow: style.shadow ? 'soft' : 'none', weight: style.fontWeight || 700,
    rotation: tf.rotation, scale: tf.scale, opacity: tf.opacity,
  };
  // texto parado (fora da entrada/saída, sem loop/unidade): desenha 1x num bitmap e reaproveita
  if (fontReady && !unit && !paints && !style.backgroundBlur && isStaticAnim(anim) && W * H <= TEXT_CACHE_MAX_PX) {
    const key = JSON.stringify([raw, style, W, H, anim.sweep > 0, anim.underlineDraw > 0, anim.boxReveal]);
    let bmp = textCache.get(key);
    if (bmp) { textCache.delete(key); textCache.set(key, bmp); } else {
      bmp = makeCanvas(W, H);
      const bctx = bmp.getContext('2d') as Ctx | null;
      if (bctx) drawBlock(bctx, { ...params, cx: W / 2, cy: H / 2, rotation: 0, scale: 1, opacity: 1 }, H);
      textCache.set(key, bmp);
      while (textCache.size > TEXT_CACHE_SIZE) textCache.delete(textCache.keys().next().value as string);
    }
    ctx.save();
    ctx.translate(params.cx, params.cy);
    if (tf.rotation) ctx.rotate((tf.rotation * Math.PI) / 180);
    if (tf.scale !== 1) ctx.scale(tf.scale, tf.scale);
    ctx.globalAlpha *= Math.max(0, Math.min(1, tf.opacity));
    ctx.drawImage(bmp as CanvasImageSource, -W / 2, -H / 2);
    ctx.restore();
    textCacheStats.hits++;
    return;
  }
  drawBlock(ctx, params, H);
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
  const px0 = fontPx(style.fontSize, H);
  const estLines = style.lines ?? Math.min(2, Math.max(1, Math.ceil(words.join(' ').length / 18)));
  const lhK = style.lineHeight && style.lineHeight > 0.5 ? style.lineHeight : 1.2;
  const safe = clampToSafeZone(style.safeZone, style.position.x, style.position.y, 0.84, (px0 * lhK * estLines + px0 * 0.6) / H, H > W);
  const emph = style.emphasis?.auto ? chunk.words.map((w) => isEmphasisWord(w.text)) : null;
  const emphScale = style.emphasis?.scale ?? 1.15;
  // legendas: linhas equilibradas por padrão (evita palavra órfã)
  const capStyle = style.balance === undefined ? { ...style, balance: true } : style;
  drawBlock(ctx, {
    words, style: capStyle, px: px0, cx: safe.x * W, cy: safe.y * H,
    maxWidth: W * Math.min(0.84, safe.maxW), anim, unit, emoji, rotation: jitter, maxLines: style.lines,
    paints: (i) => {
      const st = states[i];
      const w = chunk.words[i];
      const pop = st.active && activeScale !== 1 ? 1 + (activeScale - 1) * easeOutBack(clamp01((t - w.start) / 0.12), 2) : 1;
      const spoken = t >= w.start;
      const isEmph = !!emph?.[i];
      return {
        color: isEmph ? style.emphasis?.color ?? hl : st.highlighted ? hl : style.color,
        scale: pop * (isEmph ? emphScale : 1),
        alpha: style.inactiveOpacity !== undefined && !spoken ? Math.max(0, Math.min(1, style.inactiveOpacity)) : 1,
        box: style.wordBox && st.active
          ? { color: style.wordBox.color, radius: style.wordBox.radius * k, padding: style.wordBox.padding * k }
          : undefined,
      };
    },
    box: look.box ? style.background || 'rgba(0,0,0,0.72)' : style.background || undefined,
    glow: look.glow ? hl : undefined,
    stroke: look.stroke,
    reserve: Math.max(activeScale * (emph?.some(Boolean) ? emphScale : 1), style.wordBox ? 1.08 : 1),
    shadow: look.shadow === 'none' ? 'none' : style.shadow === false ? 'none' : look.shadow,
    weight,
  }, H);
}

