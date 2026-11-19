/* =====================================================================
   Efeitos visuais (VisualEffectKind) e gradação por sobreposição.
   Tudo opera "no lugar" sobre uma superfície W×H (camada do clipe ou o
   quadro inteiro, no caso da camada de ajuste). Determinístico em t.
   ===================================================================== */
import type { VisualEffect, VisualEffectKind } from '../types';
import type { ResolvedFilters } from './filters';
import { hash, noise, scratch, type AnyCanvas, type Ctx } from './surface';
import { FX_EFFECT_LABELS } from '../fx/catalog';
import { addFxGeometry, isGeometryEffect } from '../fx/geometry';
import { paint2DEffect, type FxOpts } from '../fx/effects2d';
import { applyGLEffect } from '../fx/effectsGL';
import { applyCustomEffect } from '../fx/customRender';

/** rótulos PT-BR (derivados do catálogo único em lib/fx/catalog.ts) */
export const EFFECT_LABELS: Record<VisualEffectKind, string> = FX_EFFECT_LABELS;

/** opções extras (todas opcionais): tempo local do clipe e geometria na camada de ajuste */
export interface SurfaceFxOpts extends FxOpts {
  /** aplica também os efeitos de geometria (camada de ajuste não passa por effectGeometry) */
  geometry?: boolean;
}

const I = (e: VisualEffect) => Math.max(0, Math.min(1, e.intensity ?? 0.5));
const SPD = (e: VisualEffect) => Math.max(0.05, e.speed ?? 1);

/** efeitos que mexem na geometria do desenho (aplicados antes de desenhar) */
export function effectGeometry(effects: VisualEffect[] | undefined, t: number): { dx: number; dy: number; scale: number; rotation: number } {
  const g = { dx: 0, dy: 0, scale: 1, rotation: 0 };
  for (const e of effects ?? []) {
    if (e.kind === 'shake') {
      const f = Math.floor(t * 24 * SPD(e));
      g.dx += (hash(f) - 0.5) * 0.05 * I(e);
      g.dy += (hash(f + 77) - 0.5) * 0.05 * I(e);
      g.rotation += (hash(f + 13) - 0.5) * 3 * I(e);
      g.scale *= 1 + 0.04 * I(e); // evita bordas aparecendo
    } else if (e.kind === 'zoom-pulse') {
      const ph = (t * 2 * SPD(e)) % 1;
      g.scale *= 1 + 0.12 * I(e) * Math.exp(-ph * 6);
    } else addFxGeometry(g, e, t);
  }
  return g;
}

/** efeitos que são aplicados na superfície já desenhada */
export function hasSurfaceEffects(effects: VisualEffect[] | undefined): boolean {
  return !!effects?.some((e) => !isGeometryEffect(e.kind) && I(e) > 0);
}

function copyOf(ctx: Ctx, W: number, H: number, slot = 3): AnyCanvas {
  const { c, ctx: cc } = scratch(ctx.canvas, W, H, slot);
  cc.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
  return c;
}

function clear(ctx: Ctx, W: number, H: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.restore();
}

/** separa canais: vermelho deslocado p/ esquerda, ciano p/ direita (recompõe a cor onde não há deslocamento) */
export function rgbSplitInPlace(ctx: Ctx, W: number, H: number, shift: number, dy = 0) {
  if (shift < 0.5) return;
  const src = copyOf(ctx, W, H, 3);
  const channel = (color: string, slot: number) => {
    const { c, ctx: t } = scratch(ctx.canvas, W, H, slot);
    t.drawImage(src as CanvasImageSource, 0, 0);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = color;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(src as CanvasImageSource, 0, 0);
    return c;
  };
  const red = channel('#ff0000', 4);
  const cyan = channel('#00ffff', 5);
  clear(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(red as CanvasImageSource, -shift, -dy);
  ctx.drawImage(cyan as CanvasImageSource, shift, dy);
  ctx.restore();
}

/** glitch: RGB split + fatias horizontais deslocadas */
export function glitchInPlace(ctx: Ctx, W: number, H: number, amount: number, t: number) {
  if (amount <= 0.01) return;
  const frame = Math.floor(t * 30);
  rgbSplitInPlace(ctx, W, H, Math.max(2, W * 0.025 * amount));
  const src = copyOf(ctx, W, H, 6);
  const slices = 3 + Math.floor(hash(frame) * 5);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < slices; i++) {
    const y = Math.floor(hash(frame * 7 + i) * H);
    const h = Math.max(2, Math.floor(hash(frame * 13 + i) * H * 0.08));
    const dx = (hash(frame * 17 + i) - 0.5) * W * 0.18 * amount;
    ctx.clearRect(0, y, W, h);
    ctx.drawImage(src as CanvasImageSource, 0, y, W, h, dx, y, W, h);
  }
  ctx.restore();
}

export function pixelateInPlace(ctx: Ctx, W: number, H: number, block: number) {
  if (block < 2) return;
  const src = copyOf(ctx, W, H, 3);
  const sw = Math.max(1, Math.round(W / block)), sh = Math.max(1, Math.round(H / block));
  // tamanho FIXO (W/2×H/2) e desenho num sub-retângulo: o bloco anima na transição e
  // recriar o canvas a cada quadro custava alocação + GC
  const { c: small, ctx: s } = scratch(ctx.canvas, Math.ceil(W / 2), Math.ceil(H / 2), 8);
  s.drawImage(src as CanvasImageSource, 0, 0, sw, sh);
  clear(ctx, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small as CanvasImageSource, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();
}

function vignette(ctx: Ctx, W: number, H: number, v: number) {
  if (v <= 0) return;
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, 0.9 * v)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function grain(ctx: Ctx, W: number, H: number, v: number, t: number) {
  if (v <= 0) return;
  const tile = noise();
  const frame = Math.floor(t * 24);
  const ox = Math.floor(hash(frame) * tile.width), oy = Math.floor(hash(frame + 99) * tile.height);
  const pat = ctx.createPattern(tile as CanvasImageSource, 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.55 * v);
  ctx.globalCompositeOperation = ctx.globalCompositeOperation === 'source-atop' ? 'source-atop' : 'overlay';
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W + ox, H + oy);
  ctx.restore();
}

/**
 * Gradação por sobreposição: temperatura, matiz, desbotado, vinheta, grão.
 * `opaque` = a superfície cobre o quadro todo (camada de ajuste) — pode usar
 * modos de mistura sem restringir ao alfa.
 */
export function applyGrade(ctx: Ctx, f: ResolvedFilters, W: number, H: number, t: number) {
  if (!f.temperature && !f.tint && !f.fade && !f.vignette && !f.grain) return;
  const alphaMask = f.fade ? copyOf(ctx, W, H, 9) : null;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  if (f.temperature) {
    const a = Math.abs(f.temperature) * 0.22;
    ctx.fillStyle = f.temperature > 0 ? `rgba(255,138,38,${a})` : `rgba(38,120,255,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.tint) {
    const a = Math.abs(f.tint) * 0.18;
    ctx.fillStyle = f.tint > 0 ? `rgba(255,40,200,${a})` : `rgba(40,255,90,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.fade) {
    // levanta os pretos (screen com cinza) e depois restringe ao alfa original
    ctx.globalCompositeOperation = 'screen';
    const g = Math.round(70 * f.fade);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(alphaMask as CanvasImageSource, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
  }
  vignette(ctx, W, H, f.vignette);
  grain(ctx, W, H, f.grain, t);
  ctx.restore();
}

function lightLeak(ctx: Ctx, W: number, H: number, v: number, t: number, speed: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const ph = t * 0.35 * speed;
  const blobs = [
    { x: 0.15 + 0.25 * Math.sin(ph), y: 0.2 + 0.15 * Math.cos(ph * 1.3), c: '255,120,40' },
    { x: 0.85 - 0.2 * Math.sin(ph * 0.8), y: 0.75 + 0.1 * Math.sin(ph * 1.7), c: '255,60,90' },
  ];
  for (const b of blobs) {
    const r = Math.max(W, H) * 0.6;
    const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, r);
    g.addColorStop(0, `rgba(${b.c},${0.55 * v})`);
    g.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function sparkles(ctx: Ctx, W: number, H: number, v: number, t: number, speed: number) {
  const n = Math.round(10 + 30 * v);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const tw = Math.sin(t * 4 * speed + i * 2.1);
    if (tw <= 0) continue;
    const x = hash(i * 3.1) * W, y = hash(i * 7.7) * H;
    const r = Math.min(W, H) * (0.006 + 0.014 * hash(i)) * tw;
    ctx.fillStyle = `rgba(255,248,220,${0.9 * tw})`;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 3); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 3, y); ctx.lineTo(x + r * 0.5, y + r * 0.5);
    ctx.lineTo(x, y + r * 3); ctx.lineTo(x - r * 0.5, y + r * 0.5); ctx.lineTo(x - r * 3, y); ctx.lineTo(x - r * 0.5, y - r * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** aplica os efeitos de superfície, na ordem dada */
export function applySurfaceEffects(ctx: Ctx, W: number, H: number, effects: VisualEffect[] | undefined, t: number, opts: SurfaceFxOpts = {}) {
  if (!effects?.length) return;
  if (!Number.isFinite(t)) t = 0;
  if (opts.geometry) applyGeometryInPlace(ctx, W, H, effects, t);
  for (const e of effects) {
    const v = I(e);
    if (v <= 0) continue;
    const sp = SPD(e);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    switch (e.kind) {
      case 'glitch': {
        const burst = hash(Math.floor(t * 8 * sp)) > 0.55 ? 1 : 0.12;
        glitchInPlace(ctx, W, H, v * burst, t);
        break;
      }
      case 'rgb-split':
        rgbSplitInPlace(ctx, W, H, W * 0.012 * v * (1 + 0.5 * Math.sin(t * 6 * sp)));
        break;
      case 'vhs': {
        rgbSplitInPlace(ctx, W, H, W * 0.006 * v + 1);
        ctx.globalCompositeOperation = 'source-atop'; // scanlines e grão só sobre o conteúdo da camada
        ctx.globalAlpha = 0.18 * v;
        ctx.fillStyle = '#000';
        const step = Math.max(2, Math.round(H / 240));
        for (let y = 0; y < H; y += step * 2) ctx.fillRect(0, y, W, step);
        ctx.globalAlpha = 1;
        // faixa de ruído rolando
        const by = ((t * 0.25 * sp) % 1) * H;
        const src = copyOf(ctx, W, H, 6);
        const bh = H * 0.05;
        ctx.drawImage(src as CanvasImageSource, 0, by, W, bh, W * 0.02 * v, by, W, bh);
        grain(ctx, W, H, 0.5 * v, t);
        break;
      }
      case 'film-grain': ctx.globalCompositeOperation = 'source-atop'; grain(ctx, W, H, v, t); break;
      case 'light-leak': lightLeak(ctx, W, H, v, t, sp); break;
      case 'pixelate': pixelateInPlace(ctx, W, H, 2 + v * Math.min(W, H) / 22); break;
      case 'mirror': {
        const src = copyOf(ctx, W, H, 3);
        ctx.clearRect(W / 2, 0, W / 2, H);
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src as CanvasImageSource, 0, 0, W / 2, H, 0, 0, W / 2, H);
        break;
      }
      case 'kaleidoscope': {
        const src = copyOf(ctx, W, H, 3);
        clear(ctx, W, H);
        const qw = W / 2, qh = H / 2;
        const sx = W * 0.25, sy = H * 0.25; // usa o miolo do quadro
        for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.scale(fx, fy);
          ctx.drawImage(src as CanvasImageSource, sx, sy, qw, qh, -qw, -qh, qw, qh);
          ctx.restore();
        }
        break;
      }
      case 'blur-motion': {
        const src = copyOf(ctx, W, H, 3);
        clear(ctx, W, H);
        const n = 6, spread = W * 0.05 * v;
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = i === 0 ? 1 : 0.35;
          ctx.drawImage(src as CanvasImageSource, (i / (n - 1) - 0.5) * spread, 0);
        }
        break;
      }
      case 'flash-strobe': {
        const on = (t * 4 * sp) % 1 < 0.25;
        if (on) { ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = 0.85 * v; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
        break;
      }
      case 'old-film': {
        const src = copyOf(ctx, W, H, 3);
        clear(ctx, W, H);
        const flick = 0.9 + 0.12 * hash(Math.floor(t * 18));
        ctx.filter = `sepia(${0.75 * v}) contrast(1.1) brightness(${flick.toFixed(3)})`;
        ctx.drawImage(src as CanvasImageSource, 0, 0);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-atop';
        grain(ctx, W, H, 0.8 * v, t);
        const f = Math.floor(t * 24);
        ctx.strokeStyle = `rgba(30,20,10,${0.5 * v})`;
        ctx.lineWidth = Math.max(1, W / 500);
        for (let i = 0; i < 3; i++) {
          if (hash(f * 5 + i) < 0.5) continue;
          const x = hash(f * 11 + i) * W;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (hash(f + i) - 0.5) * 8, H); ctx.stroke();
        }
        vignette(ctx, W, H, 0.6 * v);
        break;
      }
      case 'vignette-pulse':
        ctx.globalCompositeOperation = 'source-atop';
        vignette(ctx, W, H, v * (0.55 + 0.45 * Math.sin(t * Math.PI * 2 * sp)));
        break;
      case 'sparkle': sparkles(ctx, W, H, v, t, sp); break;
      case 'soft-glow': {
        if (applyGLEffect(ctx, W, H, e, t)) break; // WebGL (o ctx.filter não funciona no Safari)
        const src = copyOf(ctx, W, H, 3);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.65 * v;
        ctx.filter = `blur(${(Math.min(W, H) * 0.02).toFixed(1)}px) brightness(1.15)`;
        ctx.drawImage(src as CanvasImageSource, 0, 0);
        break;
      }
      case 'neon-edge': {
        const src = copyOf(ctx, W, H, 3);
        const { c: edges, ctx: ec } = scratch(ctx.canvas, W, H, 4);
        ec.drawImage(src as CanvasImageSource, 0, 0);
        ec.globalCompositeOperation = 'difference';
        const o = Math.max(1, W / 360);
        ec.drawImage(src as CanvasImageSource, o, o);
        clear(ctx, W, H);
        ctx.filter = `brightness(${(1 - 0.65 * v).toFixed(2)})`;
        ctx.drawImage(src as CanvasImageSource, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'brightness(4) saturate(2.5)';
        ctx.globalAlpha = v;
        ctx.drawImage(edges as CanvasImageSource, 0, 0);
        ctx.filter = `brightness(4) saturate(2.5) blur(${(W / 160).toFixed(1)}px)`;
        ctx.drawImage(edges as CanvasImageSource, 0, 0);
        break;
      }
      case 'black-bars': {
        const bh = H * (0.05 + 0.09 * v);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, bh);
        ctx.fillRect(0, H - bh, W, bh);
        break;
      }
      case 'custom': applyCustomEffect(ctx, W, H, e, t, opts); break; // shader da IA (falha = passagem direta)
      default:
        if (!paint2DEffect(ctx, W, H, e, t, opts)) applyGLEffect(ctx, W, H, e, t);
        break;
    }
    ctx.restore();
  }
}

/** geometria (tremor, zooms, câmera na mão…) aplicada redesenhando a superfície — p/ camada de ajuste */
export function applyGeometryInPlace(ctx: Ctx, W: number, H: number, effects: VisualEffect[] | undefined, t: number) {
  const g = effectGeometry(effects, t);
  if (!g.dx && !g.dy && g.scale === 1 && !g.rotation) return;
  const src = copyOf(ctx, W, H, 3);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.translate(W / 2 + g.dx * W, H / 2 + g.dy * H);
  if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180);
  ctx.scale(g.scale, g.scale);
  ctx.drawImage(src as CanvasImageSource, -W / 2, -H / 2);
  ctx.restore();
}

/** queimado de filme (transição film-burn) por cima do quadro */
export function filmBurn(ctx: Ctx, W: number, H: number, v: number, t: number) {
  if (v <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  const x = (0.3 + 0.4 * hash(Math.floor(t * 3))) * W;
  const g = ctx.createRadialGradient(x, H * 0.4, 0, x, H * 0.4, Math.max(W, H) * 0.9);
  g.addColorStop(0, `rgba(255,240,200,${v})`);
  g.addColorStop(0.35, `rgba(255,140,40,${0.85 * v})`);
  g.addColorStop(1, `rgba(120,20,0,${0.3 * v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
