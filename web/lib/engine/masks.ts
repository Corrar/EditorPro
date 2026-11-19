/* máscaras estilo Power Window (retângulo, arredondado, círculo, losango, coração, estrela, linha, espelho,
   gradiente linear/radial, texto) com suavização, inversão e keyframes */
import type { Mask } from '../types';
import { scratch, type AnyCanvas, type Ctx } from './surface';
import { ease } from './easing';
import { FX_MASK_LABELS } from '../fx/catalog';
import { canvasFilterSupported } from '../fx/sprites';

export const MASK_LABELS: Record<Mask['shape'], string> = FX_MASK_LABELS;

const MASK_KEYS = ['x', 'y', 'w', 'h', 'rotation', 'feather'] as const;

/** máscara efetiva no tempo `local` (relativo ao clipe), interpolando os keyframes (puro) */
export function maskAt(m: Mask, local?: number): Mask {
  const kfs = m.keyframes;
  if (!kfs?.length || local === undefined || !Number.isFinite(local)) return m;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const out: Mask = { ...m };
  for (const key of MASK_KEYS) {
    const ks = sorted.filter((k) => typeof k[key] === 'number' && Number.isFinite(k[key]));
    if (!ks.length) continue;
    if (local <= ks[0].t) { out[key] = ks[0][key]!; continue; }
    const last = ks[ks.length - 1];
    if (local >= last.t) { out[key] = last[key]!; continue; }
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (local >= a.t && local <= b.t) {
        const span = b.t - a.t;
        const p = span <= 0 ? 1 : ease(b.easing, (local - a.t) / span);
        out[key] = a[key]! + (b[key]! - a[key]!) * p;
        break;
      }
    }
  }
  return out;
}

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
    case 'rounded-rect': {
      const r = Math.max(0, Math.min(1, m.radius ?? 0.25)) * Math.min(w, h) / 2;
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
      break;
    }
    case 'diamond': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(0, h / 2); ctx.lineTo(-w / 2, 0); ctx.closePath(); break;
    case 'text': {
      const txt = (m.text || 'TEXTO').slice(0, 60);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let px = h * 0.9;
      ctx.font = `900 ${px}px "Plus Jakarta Sans", Poppins, system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width;
      if (tw > w) { px *= w / tw; ctx.font = `900 ${px}px "Plus Jakarta Sans", Poppins, system-ui, sans-serif`; }
      ctx.fillText(txt, 0, 0);
      break;
    }
    case 'linear': case 'radial': break; // pintadas por gradiente (paintGradientMask)
  }
  ctx.fill();
  ctx.restore();
}

/** gradiente linear (metade de baixo da linha, transição de largura ~h) e radial (elipse w×h com borda suave) */
function paintGradientMask(ctx: Ctx, m: Mask, W: number, H: number) {
  const cx = m.x * W, cy = m.y * H;
  const f = Math.max(0.02, Math.min(1, m.feather || 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((m.rotation || 0) * Math.PI) / 180);
  const big = (W + H) * 4;
  if (m.shape === 'linear') {
    const half = Math.max(1, m.h * H * f) / 2;
    const g = ctx.createLinearGradient(0, -half, 0, half);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(-big, -half, big * 2, half * 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-big, half, big * 2, big);
  } else {
    const rx = Math.max(1, m.w * W / 2), ry = Math.max(1, m.h * H / 2);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * (1 - f), 0, 0, rx);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** aplica a máscara ao conteúdo de `layerCtx` (canvas W×H). `local` = tempo no clipe (keyframes) */
export function applyMask(layerCtx: Ctx, mask: Mask, W: number, H: number, local?: number) {
  const m = maskAt(mask, local);
  const { c, ctx } = scratch(layerCtx.canvas, W, H, 7);
  const feather = Math.max(0, Math.min(1, m.feather || 0)) * Math.min(W, H) * 0.12;
  if (m.shape === 'linear' || m.shape === 'radial') paintGradientMask(ctx, m, W, H);
  else if (feather > 0.5 && canvasFilterSupported()) {
    ctx.filter = `blur(${feather.toFixed(1)}px)`;
    paintMaskShape(ctx, m, W, H);
  } else if (feather > 0.5) {
    // Safari/iOS (sem ctx.filter): a SOMBRA desfocada da forma, desenhada fora da tela, vira a máscara suave
    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = feather * 2;
    // deslocamento maior que qualquer forma ('line'/'mirror' vão até 4(W+H)·√2): só a sombra cai no quadro
    const off = (W + H) * 12;
    ctx.shadowOffsetX = off;
    ctx.translate(-off, 0);
    paintMaskShape(ctx, m, W, H);
    ctx.restore();
  } else paintMaskShape(ctx, m, W, H);
  ctx.filter = 'none';
  layerCtx.save();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
  layerCtx.drawImage(c as AnyCanvas as CanvasImageSource, 0, 0);
  layerCtx.restore();
}
