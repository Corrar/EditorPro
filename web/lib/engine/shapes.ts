/* formas e emoji renderizados em canvas próprio (cacheados) p/ entrar no mesmo pipeline das imagens */
import type { ShapeClip } from '../types';
import { makeCanvas, type AnyCanvas, type Ctx } from './surface';
import { heartPath, starPath } from './masks';

export const SHAPE_LABELS: Record<ShapeClip['shape'], string> = {
  rect: 'Retângulo', 'rounded-rect': 'Retângulo arredondado', circle: 'Círculo', triangle: 'Triângulo', star: 'Estrela',
  arrow: 'Seta', line: 'Linha', heart: 'Coração', 'speech-bubble': 'Balão de fala',
};

/** proporção (largura/altura) natural de cada forma */
/** proporção efetiva do clipe: `aspect` (campo opcional dos modelos da biblioteca) ou a natural da forma */
export function clipShapeAspect(c: ShapeClip): number {
  const a = (c as ShapeClip & { aspect?: number }).aspect;
  return a && Number.isFinite(a) && a > 0 ? Math.min(64, Math.max(1 / 64, a)) : shapeAspect(c.shape);
}

export function shapeAspect(shape: ShapeClip['shape']): number {
  switch (shape) {
    case 'rect': case 'rounded-rect': return 1.6;
    case 'arrow': return 2;
    case 'line': return 8;
    case 'speech-bubble': return 1.4;
    default: return 1;
  }
}

const cache = new Map<string, AnyCanvas>();

function key(parts: unknown[]) { return parts.join('|'); }

export function shapeCanvas(c: ShapeClip, sizePx: number): AnyCanvas {
  const asp = clipShapeAspect(c);
  // lado maior limitado (faixas finas muito largas não estouram a memória)
  let h = Math.max(4, Math.min(2048, Math.round(sizePx)));
  let w = Math.round(h * asp);
  if (w > 4096) { w = 4096; h = Math.max(2, Math.round(w / asp)); }
  w = Math.max(4, w);
  const k = key([c.shape, c.fill, c.stroke, c.strokeWidth, c.cornerRadius, asp.toFixed(4), w, h]);
  const hit = cache.get(k);
  if (hit) return hit;
  if (cache.size > 64) cache.clear();
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d') as Ctx;
  const sw = c.stroke && c.strokeWidth ? Math.max(1, (c.strokeWidth * h) / 200) : 0;
  const pad = sw / 2 + 1;
  const iw = w - pad * 2, ih = h - pad * 2;
  ctx.translate(w / 2, h / 2);
  ctx.beginPath();
  switch (c.shape) {
    case 'rect': ctx.rect(-iw / 2, -ih / 2, iw, ih); break;
    case 'rounded-rect': {
      const r = Math.min(ih / 2, iw / 2, c.cornerRadius !== undefined ? (c.cornerRadius * h) / 200 : ih * 0.22);
      ctx.roundRect(-iw / 2, -ih / 2, iw, ih, r);
      break;
    }
    case 'circle': ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(0, -ih / 2); ctx.lineTo(iw / 2, ih / 2); ctx.lineTo(-iw / 2, ih / 2); ctx.closePath(); break;
    case 'star': starPath(ctx, iw, ih); break;
    case 'heart': heartPath(ctx, iw, ih); break;
    case 'line': ctx.roundRect(-iw / 2, -ih / 2, iw, ih, ih / 2); break;
    case 'arrow': {
      const head = ih * 0.9;
      ctx.moveTo(-iw / 2, -ih * 0.18); ctx.lineTo(iw / 2 - head, -ih * 0.18); ctx.lineTo(iw / 2 - head, -ih / 2);
      ctx.lineTo(iw / 2, 0); ctx.lineTo(iw / 2 - head, ih / 2); ctx.lineTo(iw / 2 - head, ih * 0.18);
      ctx.lineTo(-iw / 2, ih * 0.18); ctx.closePath();
      break;
    }
    case 'speech-bubble': {
      const bh = ih * 0.78;
      ctx.roundRect(-iw / 2, -ih / 2, iw, bh, bh * 0.3);
      ctx.moveTo(-iw * 0.2, -ih / 2 + bh - 1); ctx.lineTo(-iw * 0.32, ih / 2); ctx.lineTo(-iw * 0.02, -ih / 2 + bh - 1);
      break;
    }
  }
  ctx.fillStyle = c.fill || '#D9641E';
  ctx.fill();
  if (sw) { ctx.lineWidth = sw; ctx.strokeStyle = c.stroke!; ctx.lineJoin = 'round'; ctx.stroke(); }
  cache.set(k, cv);
  return cv;
}

const emojiCache = new Map<string, AnyCanvas>();
/** emoji nativo desenhado num canvas quadrado */
export function emojiCanvas(emoji: string, sizePx: number): AnyCanvas {
  const s = Math.max(16, Math.min(1024, Math.round(sizePx / 64) * 64 || 64));
  const k = `${emoji}|${s}`;
  const hit = emojiCache.get(k);
  if (hit) return hit;
  if (emojiCache.size > 64) emojiCache.clear();
  const cv = makeCanvas(s, s);
  const ctx = cv.getContext('2d') as Ctx;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(s * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText(emoji, s / 2, s * 0.54);
  emojiCache.set(k, cv);
  return cv;
}
