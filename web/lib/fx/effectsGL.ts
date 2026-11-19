/* aplica um efeito por pixel (shader) numa superfície 2D, com fallback em CPU/2D quando não há WebGL */
import type { VisualEffect } from '../types';
import { scratch, type Ctx } from '../engine/surface';
import { effectFragment, isGLEffect } from './effectShaders';
import { hexToRgb01, runFx } from './glcore';
import { fxIntensity, fxSpeed } from './geometry';
import { cheapBlurInPlace } from './effects2d';

const S_CPU = 44;

type RGB = [number, number, number];
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const mixc = (a: number, b: number, k: number) => a + (b - a) * k;

/** versões em CPU (resolução reduzida) dos efeitos de cor — só quando o WebGL falha */
function cpuMapper(e: VisualEffect, v: number, t: number): ((c: RGB) => RGB) | null {
  const col = hexToRgb01(e.color);
  switch (e.kind) {
    case 'invert': return ([r, g, b]) => [mixc(r, 1 - r, v), mixc(g, 1 - g, v), mixc(b, 1 - b, v)];
    case 'posterize': { const n = mixc(14, 3, v); return ([r, g, b]) => [Math.round(r * n) / n, Math.round(g * n) / n, Math.round(b * n) / n]; }
    case 'duotone': return ([r, g, b]) => {
      const l = Math.min(1, Math.max(0, (lum(r, g, b) - 0.05) / 0.9));
      const d: RGB = [0.09, 0.05, 0.25];
      return [mixc(r, mixc(d[0], col[0], l), v), mixc(g, mixc(d[1], col[1], l), v), mixc(b, mixc(d[2], col[2], l), v)];
    };
    case 'thermal': return ([r, g, b]) => {
      const x = lum(r, g, b);
      const stops: RGB[] = [[0, 0, 0.2], [0.5, 0, 0.8], [1, 0, 0.2], [1, 0.8, 0], [1, 1, 1]];
      const f = Math.min(3.999, x * 4), i = Math.floor(f), k = f - i;
      const a = stops[i], c = stops[i + 1];
      return [mixc(r, mixc(a[0], c[0], k), v), mixc(g, mixc(a[1], c[1], k), v), mixc(b, mixc(a[2], c[2], k), v)];
    };
    case 'night-vision': return ([r, g, b]) => { const l = Math.pow(lum(r, g, b), 0.8) * 1.4; return [mixc(r, 0.12 * l, v), mixc(g, l, v), mixc(b, 0.22 * l, v)]; };
    case 'sketch': return ([r, g, b]) => { const l = lum(r, g, b); const s = l > 0.5 ? 0.95 : l > 0.25 ? 0.7 : 0.35; return [mixc(r, s, v), mixc(g, s * 0.98, v), mixc(b, s * 0.93, v)]; };
    case 'rainbow': {
      const a = t * 2, ca = Math.cos(a), sa = Math.sin(a), k = 0.57735;
      return ([r, g, b]) => {
        const d = k * (r + g + b) * (1 - ca);
        const cr: RGB = [k * (b - g), k * (r - b), k * (g - r)];
        return [mixc(r, r * ca + cr[0] * sa + k * d, v), mixc(g, g * ca + cr[1] * sa + k * d, v), mixc(b, b * ca + cr[2] * sa + k * d, v)];
      };
    }
    default: return null;
  }
}

function cpuFallback(ctx: Ctx, W: number, H: number, e: VisualEffect, v: number, t: number): void {
  if (e.kind.startsWith('blur') || e.kind === 'tilt-shift' || e.kind === 'focus-center') {
    cheapBlurInPlace(ctx, W, H, Math.min(W, H) * 0.02 * v);
    return;
  }
  const fn = cpuMapper(e, v, t);
  if (!fn) return; // distorções/glitch sem WebGL: mantém o quadro (raríssimo; documentado em docs/fx-catalogo.md)
  const k = Math.min(1, 360 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const { ctx: s } = scratch(ctx.canvas, w, h, S_CPU);
  s.drawImage(ctx.canvas as CanvasImageSource, 0, 0, w, h);
  let img: ImageData;
  try { img = s.getImageData(0, 0, w, h); } catch { return; }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const o = fn([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
    d[i] = Math.round(Math.min(1, Math.max(0, o[0])) * 255);
    d[i + 1] = Math.round(Math.min(1, Math.max(0, o[1])) * 255);
    d[i + 2] = Math.round(Math.min(1, Math.max(0, o[2])) * 255);
  }
  s.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(s.canvas as CanvasImageSource, 0, 0, w, h, 0, 0, W, H);
  ctx.restore();
}

/** aplica o efeito em shader; false = não é efeito em shader */
export function applyGLEffect(ctx: Ctx, W: number, H: number, e: VisualEffect, t: number): boolean {
  if (!isGLEffect(e.kind)) return false;
  const v = fxIntensity(e);
  if (v <= 0) return true;
  const frag = effectFragment(e.kind)!;
  const out = runFx('fx:' + e.kind, frag, [['u_tex', ctx.canvas as TexImageSource]], W, H, {
    u_time: (Number.isFinite(t) ? t : 0) * fxSpeed(e),
    u_int: v,
    u_angle: (((e.angle ?? 0) % 360) * Math.PI) / 180,
    u_color: hexToRgb01(e.color, e.kind === 'neon-glow' ? [0.13, 0.9, 1] : e.kind === 'outline' ? [1, 1, 1] : undefined),
  });
  if (!out) { cpuFallback(ctx, W, H, e, v, t); return true; }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(out as CanvasImageSource, 0, 0, W, H);
  ctx.restore();
  return true;
}
