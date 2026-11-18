/* máscaras (retângulo, círculo, coração, estrela, linha, espelho) com suavização e inversão */
import type { Mask } from '../types';
import { scratch, type AnyCanvas, type Ctx } from './surface';

export const MASK_LABELS: Record<Mask['shape'], string> = {
  rect: 'Retângulo', circle: 'Círculo', heart: 'Coração', star: 'Estrela', line: 'Linha', mirror: 'Espelho',
};

export function heartPath(ctx: Ctx | Path2D, w: number, h: number) {
  // coração centrado em (0,0) ocupando w×h
  const x = -w / 2, y = -h / 2;
  ctx.moveTo(0, y + h * 0.3);
  ctx.bezierCurveTo(0, y, x, y, x, y + h * 0.32);
  ctx.bezierCurveTo(x, y + h * 0.62, 0, y + h * 0.78, 0, y + h);
  ctx.bezierCurveTo(0, y + h * 0.78, -x, y + h * 0.62, -x, y + h * 0.32);
  ctx.bezierCurveTo(-x, y, 0, y, 0, y + h * 0.3);
}

export function starPath(ctx: Ctx | Path2D, w: number, h: number, points = 5, inner = 0.45) {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * r * w, py = Math.sin(a) * r * h;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** desenha a forma da máscara (branca, opaca) em ctx, em coordenadas do quadro W×H */
function paintMaskShape(ctx: Ctx, m: Mask, W: number, H: number) {
  const cx = m.x * W, cy = m.y * H;
  const w = Math.max(1, m.w * W), h = Math.max(1, m.h * H);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((m.rotation || 0) * Math.PI) / 180);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const big = (W + H) * 4;
  switch (m.shape) {
    case 'rect': ctx.rect(-w / 2, -h / 2, w, h); break;
    case 'circle': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'heart': heartPath(ctx, w, h); break;
    case 'star': starPath(ctx, w, h); break;
    case 'line': ctx.rect(-big, 0, big * 2, big); break; // metade de baixo da linha
    case 'mirror': ctx.rect(-big, -h / 2, big * 2, h); break; // faixa horizontal de altura h
  }
  ctx.fill();
  ctx.restore();
}

/** aplica a máscara ao conteúdo de `layerCtx` (canvas W×H) */
export function applyMask(layerCtx: Ctx, m: Mask, W: number, H: number) {
  const { c, ctx } = scratch(layerCtx.canvas, W, H, 7);
  const feather = Math.max(0, Math.min(1, m.feather || 0)) * Math.min(W, H) * 0.12;
  if (feather > 0.5) ctx.filter = `blur(${feather.toFixed(1)}px)`;
  paintMaskShape(ctx, m, W, H);
  ctx.filter = 'none';
  layerCtx.save();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
  layerCtx.drawImage(c as AnyCanvas as CanvasImageSource, 0, 0);
  layerCtx.restore();
}
