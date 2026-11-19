/* =====================================================================
   Efeitos em canvas 2D (sem leitura de pixel): partículas, luz, moldura,
   estrobo, split/clone, eco de quadros. Determinísticos em t (exceto o eco,
   que acumula quadros e se reinicia quando o tempo pula). Os que só
   DESENHAM POR CIMA estão em OVERLAY_EFFECTS (o preview híbrido pode
   desenhá-los no canvas transparente sobre o <video> nativo).
   ===================================================================== */
import type { VisualEffect, VisualEffectKind } from '../types';
import { hash, makeCanvas, scratch, type AnyCanvas, type Ctx } from '../engine/surface';
import { heartPath } from '../engine/masks';
import { fxIntensity, fxSpeed } from './geometry';
import { canvasFilterSupported, glowSprite, hexToRgbStr, hsl } from './sprites';

export interface FxOpts {
  /** segundos desde o início do clipe (contagem, flash de entrada, barras animadas) */
  local?: number;
  /** duração do clipe */
  duration?: number;
}

/** slots de canvas temporário desta sessão (draw.ts/effects.ts usam 1–22) */
const S_COPY = 40, S_SMALL = 41, S_TMP = 43;

function copyOf(ctx: Ctx, W: number, H: number, slot = S_COPY): AnyCanvas {
  const { c, ctx: cc } = scratch(ctx.canvas, W, H, slot);
  cc.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
  return c;
}

function clearAll(ctx: Ctx, W: number, H: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.restore();
}

/** desfoque barato que funciona em qualquer navegador (reduz e amplia), usado quando ctx.filter não existe */
export function cheapBlurInPlace(ctx: Ctx, W: number, H: number, radiusPx: number) {
  if (radiusPx < 0.6) return;
  const src = copyOf(ctx, W, H);
  if (canvasFilterSupported()) {
    clearAll(ctx, W, H);
    ctx.save();
    ctx.filter = `blur(${radiusPx.toFixed(1)}px)`;
    ctx.drawImage(src as CanvasImageSource, 0, 0);
    ctx.restore();
    return;
  }
  // canvas pequeno de tamanho FIXO (W/8×H/8) — desenha só no sub-retângulo (sem realocar por quadro)
  const k = Math.max(1.5, Math.min(24, radiusPx / 1.5));
  const { c: small, ctx: s } = scratch(ctx.canvas, Math.ceil(W / 1.5), Math.ceil(H / 1.5), S_SMALL);
  const sw = Math.max(1, Math.round(W / k)), sh = Math.max(1, Math.round(H / k));
  s.imageSmoothingQuality = 'high';
  s.drawImage(src as CanvasImageSource, 0, 0, sw, sh);
  clearAll(ctx, W, H);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small as CanvasImageSource, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();
}

const PALETTE = ['#F2681F', '#FFD23F', '#3BE37A', '#22B8FF', '#FF3DCB', '#FFFFFF'];

/* ---------------- partículas ---------------- */

function snow(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const n = Math.round(40 + 180 * v);
  const short = Math.min(W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const layer of [0, 1, 2]) {
    ctx.beginPath();
    for (let i = layer; i < n; i += 3) {
      const fall = 0.05 + 0.08 * hash(i * 1.7) + layer * 0.03;
      const y = ((hash(i * 3.3) + t * fall * sp) % 1) * (H + 20) - 10;
      const x = (hash(i * 7.1) + 0.02 * Math.sin(t * sp * 0.9 + i)) * W;
      const r = short * (0.0018 + 0.0022 * layer + 0.002 * hash(i));
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function rain(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, angleDeg: number) {
  ctx.fillStyle = `rgba(10,20,40,${0.12 * v})`;
  ctx.fillRect(0, 0, W, H);
  const n = Math.round(80 + 260 * v);
  const a = (angleDeg * Math.PI) / 180;
  const len = H * 0.05;
  const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
  ctx.strokeStyle = 'rgba(200,220,255,0.55)';
  ctx.lineWidth = Math.max(1, Math.min(W, H) / 700);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const s = 1.2 + hash(i * 2.3);
    const p = (hash(i * 5.9) + t * s * sp) % 1;
    const x = hash(i * 9.7) * (W + Math.abs(dx) * 4) - Math.abs(dx) * 2 + (dx / len) * p * H;
    const y = p * (H + len) - len;
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
  }
  ctx.stroke();
}

function confetti(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const n = Math.round(30 + 130 * v);
  const short = Math.min(W, H);
  for (let i = 0; i < n; i++) {
    const fall = 0.12 + 0.12 * hash(i * 1.3);
    const y = ((hash(i * 4.1) + t * fall * sp) % 1) * (H * 1.1) - H * 0.05;
    const x = (hash(i * 8.3) + 0.03 * Math.sin(t * sp * 2 + i * 1.7)) * W;
    const s = short * (0.008 + 0.008 * hash(i * 2.2));
    const rot = t * sp * (2 + 3 * hash(i)) + i;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1, Math.cos(rot * 1.7));
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fillRect(-s, -s * 0.45, s * 2, s * 0.9);
    ctx.restore();
  }
}

function hearts(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, color?: string) {
  const n = Math.round(8 + 28 * v);
  const short = Math.min(W, H);
  for (let i = 0; i < n; i++) {
    const rise = 0.08 + 0.1 * hash(i * 2.9);
    const p = (hash(i * 6.1) + t * rise * sp) % 1;
    const y = H * (1.08 - p * 1.2);
    const x = (hash(i * 3.7) + 0.04 * Math.sin(t * sp * 1.5 + i)) * W;
    const s = short * (0.03 + 0.04 * hash(i * 1.1));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * sp + i) * 0.25);
    ctx.globalAlpha = Math.min(1, (1 - p) * 2.2) * 0.9;
    ctx.fillStyle = color ?? (i % 3 === 0 ? '#FF7AA8' : i % 3 === 1 ? '#FF2D55' : '#FFFFFF');
    ctx.beginPath();
    heartPath(ctx, s, s);
    ctx.fill();
    ctx.restore();
  }
}

function bubbles(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const n = Math.round(10 + 30 * v);
  const short = Math.min(W, H);
  ctx.lineWidth = Math.max(1, short / 400);
  for (let i = 0; i < n; i++) {
    const rise = 0.06 + 0.08 * hash(i * 2.1);
    const p = (hash(i * 5.3) + t * rise * sp) % 1;
    const r = short * (0.015 + 0.035 * hash(i * 3.9));
    const x = (hash(i * 7.7) + 0.03 * Math.sin(t * sp * 1.2 + i * 2)) * W;
    const y = H * (1.05 - p * 1.15);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.fillStyle = 'rgba(180,230,255,0.12)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, Math.PI * 2); ctx.fill();
  }
}

function sprites(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, kind: 'fireflies' | 'embers' | 'bokeh', color?: string) {
  const short = Math.min(W, H);
  const n = kind === 'bokeh' ? Math.round(8 + 18 * v) : Math.round(14 + 50 * v);
  ctx.globalCompositeOperation = kind === 'bokeh' ? 'screen' : 'lighter';
  for (let i = 0; i < n; i++) {
    let x: number, y: number, r: number, a: number, rgb: string;
    if (kind === 'fireflies') {
      x = (hash(i * 1.9) + 0.06 * Math.sin(t * sp * 0.7 + i * 2.3)) * W;
      y = (hash(i * 4.7) + 0.05 * Math.cos(t * sp * 0.6 + i * 1.3)) * H;
      r = short * (0.012 + 0.012 * hash(i));
      a = 0.35 + 0.65 * Math.max(0, Math.sin(t * sp * 2.2 + i * 3.1));
      rgb = color ? hexToRgbStr(color) : '255,236,140';
    } else if (kind === 'embers') {
      const p = (hash(i * 2.7) + t * sp * (0.15 + 0.15 * hash(i * 9.1))) % 1;
      x = (hash(i * 6.3) + 0.04 * Math.sin(t * sp * 2 + i)) * W;
      y = H * (1.02 - p * 1.1);
      r = short * (0.004 + 0.008 * hash(i * 3.3));
      a = (1 - p) * (0.6 + 0.4 * hash(Math.floor(t * 12) + i));
      rgb = color ? hexToRgbStr(color) : i % 2 ? '255,140,40' : '255,200,80';
    } else {
      x = (hash(i * 3.1) + 0.03 * Math.sin(t * sp * 0.3 + i)) * W;
      y = (hash(i * 5.7) + 0.03 * Math.cos(t * sp * 0.25 + i * 1.7)) * H;
      r = short * (0.05 + 0.09 * hash(i * 7.3));
      a = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * sp * 0.8 + i));
      rgb = color ? hexToRgbStr(color) : ['255,190,120', '255,120,80', '255,230,170', '120,180,255'][i % 4];
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, a * (0.5 + 0.5 * v)));
    const spr = glowSprite(rgb, kind === 'bokeh' ? 0.75 : 0.1);
    ctx.drawImage(spr as CanvasImageSource, x - r * (kind === 'bokeh' ? 1 : 2.5), y - r * (kind === 'bokeh' ? 1 : 2.5), r * (kind === 'bokeh' ? 2 : 5), r * (kind === 'bokeh' ? 2 : 5));
  }
}

/* ---------------- luz ---------------- */

function leak(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, variant: 2 | 3) {
  ctx.globalCompositeOperation = 'screen';
  const ph = t * sp * 0.4;
  if (variant === 2) {
    // faixa diagonal quente que atravessa
    const x = (0.5 + 0.6 * Math.sin(ph)) * W;
    const g = ctx.createLinearGradient(x - W * 0.6, 0, x + W * 0.6, H);
    g.addColorStop(0, 'rgba(255,90,20,0)');
    g.addColorStop(0.45, `rgba(255,120,40,${0.55 * v})`);
    g.addColorStop(0.55, `rgba(255,220,150,${0.7 * v})`);
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    // arco-íris saindo da lateral
    const side = Math.sin(ph * 0.7) > 0 ? 0 : W;
    for (let i = 0; i < 4; i++) {
      const cy = (0.3 + 0.4 * Math.sin(ph + i * 1.3)) * H;
      const r = Math.max(W, H) * (0.45 + 0.1 * i);
      const g = ctx.createRadialGradient(side, cy, 0, side, cy, r);
      const hue = (t * sp * 40 + i * 70) % 360;
      g.addColorStop(0, hsl(hue, 100, 60, 0.5 * v));
      g.addColorStop(1, hsl(hue, 100, 50, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

function lensFlare(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, color?: string) {
  ctx.globalCompositeOperation = 'lighter';
  const ph = t * sp * 0.3;
  const lx = (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(ph))) * W, ly = (0.18 + 0.1 * Math.cos(ph * 1.3)) * H;
  const cx = W / 2, cy = H / 2;
  const short = Math.min(W, H);
  const rgb = color ? hexToRgbStr(color) : '255,210,150';
  const main = glowSprite(rgb, 0.05);
  ctx.globalAlpha = 0.9 * v;
  const R = short * 0.35;
  ctx.drawImage(main as CanvasImageSource, lx - R, ly - R, R * 2, R * 2);
  // estria horizontal
  const sg = ctx.createLinearGradient(lx - W * 0.5, ly, lx + W * 0.5, ly);
  sg.addColorStop(0, `rgba(${rgb},0)`); sg.addColorStop(0.5, `rgba(${rgb},${0.55 * v})`); sg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = sg;
  ctx.fillRect(lx - W * 0.5, ly - short * 0.004, W, short * 0.008);
  // fantasmas ao longo da linha luz → centro
  const ghosts = [[0.5, 0.06, '120,200,255'], [0.9, 0.035, '255,140,80'], [1.3, 0.09, '160,255,170'], [1.7, 0.05, '255,120,200']] as const;
  for (const [k, s, c] of ghosts) {
    const gx = lx + (cx - lx) * k * 1.2, gy = ly + (cy - ly) * k * 1.2;
    const r = short * s;
    ctx.globalAlpha = 0.35 * v;
    ctx.drawImage(glowSprite(c, 0.85) as CanvasImageSource, gx - r, gy - r, r * 2, r * 2);
  }
}

function lightSweep(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  ctx.globalCompositeOperation = 'source-atop';
  const per = 2.2 / sp;
  const p = ((t % per) + per) % per / per;
  const x = (-0.4 + p * 1.8) * (W + H);
  const g = ctx.createLinearGradient(x - H * 0.25, 0, x + H * 0.05, H * 0.3);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${0.55 * v})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  // fica em source-atop: clareia só o conteúdo da camada (sticker/PiP não vaza p/ o quadro)
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function disco(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const alpha = copyOf(ctx, W, H, S_TMP);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${0.3 * v})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const R = Math.max(W, H) * 0.35;
  for (let i = 0; i < 5; i++) {
    const a = t * sp * (0.8 + 0.2 * i) + i * 1.25;
    const x = W / 2 + Math.cos(a) * W * 0.38, y = H / 2 + Math.sin(a * 1.3) * H * 0.38;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    const hue = (i * 72 + t * sp * 60) % 360;
    g.addColorStop(0, hsl(hue, 100, 60, 0.45 * v));
    g.addColorStop(1, hsl(hue, 100, 50, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'destination-in'; // corta o que saiu da camada
  ctx.drawImage(alpha as CanvasImageSource, 0, 0);
}

/* ---------------- estrobo ---------------- */

function strobeColor(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const f = t * sp * 6;
  if (f - Math.floor(f) > 0.45) return;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = hsl(Math.floor(f) * 67, 100, 55, 0.55 * v);
  ctx.fillRect(0, 0, W, H);
}

function flashBlack(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const f = t * sp * 3;
  if (f - Math.floor(f) > 0.18) return;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${0.95 * v})`;
  ctx.fillRect(0, 0, W, H);
}

function freezeFlash(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, o: FxOpts) {
  const since = o.local !== undefined ? o.local : ((t % 2) + 2) % 2;
  const a = Math.exp(-since * 9 * sp) * v;
  if (a < 0.01) return;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a)})`;
  ctx.fillRect(0, 0, W, H);
}

function countdown(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, o: FxOpts, color?: string) {
  const N = 3;
  const local = (o.local !== undefined ? o.local : ((t % N) + N) % N) * sp;
  if (local >= N || local < 0) return;
  const n = N - Math.floor(local);
  const ph = local - Math.floor(local);
  const short = Math.min(W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,0,0,${0.35 * v})`;
  ctx.fillRect(0, 0, W, H);
  const R = short * 0.22;
  ctx.lineWidth = short * 0.018;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color ?? '#F2681F';
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(W / 2, H / 2, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - ph)); ctx.stroke();
  const s = 1 + 0.25 * Math.exp(-ph * 8);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(R * 1.15 * s)}px "Plus Jakarta Sans", Poppins, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), W / 2, H / 2 + R * 0.05);
}

/* ---------------- moldura ---------------- */

function frameBorder(ctx: Ctx, W: number, H: number, v: number, color?: string) {
  const b = Math.min(W, H) * (0.015 + 0.05 * v);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color ?? '#FFFFFF';
  ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); ctx.fillRect(0, 0, b, H); ctx.fillRect(W - b, 0, b, H);
}

function filmFrame(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const portrait = H >= W;
  const short = Math.min(W, H);
  const strip = short * (0.06 + 0.04 * v);
  const hole = strip * 0.42, gap = hole * 1.9;
  const off = ((t * sp * short * 0.25) % gap + gap) % gap;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#0d0d0d';
  if (portrait) { ctx.fillRect(0, 0, strip, H); ctx.fillRect(W - strip, 0, strip, H); } else { ctx.fillRect(0, 0, W, strip); ctx.fillRect(0, H - strip, W, strip); }
  ctx.fillStyle = 'rgba(240,235,220,0.92)';
  const len = portrait ? H : W;
  for (let p = -gap + off; p < len + gap; p += gap) {
    for (const side of [0, 1]) {
      const a = side ? (portrait ? W - strip : H - strip) : 0;
      ctx.beginPath();
      if (portrait) ctx.roundRect(a + (strip - hole) / 2, p, hole, hole * 1.3, hole * 0.2);
      else ctx.roundRect(p, a + (strip - hole) / 2, hole * 1.3, hole, hole * 0.2);
      ctx.fill();
    }
  }
}

function cinemaBarsAnim(ctx: Ctx, W: number, H: number, v: number, o: FxOpts) {
  const full = H * (0.06 + 0.1 * v);
  let k = 1;
  if (o.local !== undefined) {
    const inP = Math.min(1, Math.max(0, o.local / 0.6));
    const outP = o.duration !== undefined ? Math.min(1, Math.max(0, (o.duration - o.local) / 0.6)) : 1;
    k = Math.min(1 - Math.pow(1 - inP, 3), 1 - Math.pow(1 - outP, 3));
  }
  const bh = full * k;
  if (bh < 0.5) return;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, bh);
  ctx.fillRect(0, H - bh, W, bh);
}

function vignetteFx(ctx: Ctx, W: number, H: number, v: number, color?: string) {
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, r * (0.55 - 0.3 * v), W / 2, H / 2, r);
  const rgb = color ? hexToRgbStr(color) : '0,0,0';
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(1, `rgba(${rgb},${Math.min(1, 0.95 * v)})`);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function roundedFrame(ctx: Ctx, W: number, H: number, v: number, color?: string) {
  const short = Math.min(W, H);
  const inset = short * 0.04 * v;
  const r = short * (0.04 + 0.08 * v);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r); ctx.fill();
  if (color) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = short * 0.008;
    ctx.beginPath(); ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r); ctx.stroke();
  }
}

function dropShadow(ctx: Ctx, W: number, H: number, v: number, angleDeg: number, color?: string) {
  const src = copyOf(ctx, W, H);
  const short = Math.min(W, H);
  const a = (angleDeg * Math.PI) / 180;
  const d = short * 0.02 * (0.4 + v);
  clearAll(ctx, W, H);
  ctx.save();
  ctx.shadowColor = color ? `rgba(${hexToRgbStr(color)},${0.75 * v})` : `rgba(0,0,0,${0.7 * v})`;
  ctx.shadowBlur = short * 0.035 * (0.3 + v);
  ctx.shadowOffsetX = Math.cos(a) * d;
  ctx.shadowOffsetY = Math.sin(a) * d;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.restore();
}

function polaroid(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number, color?: string) {
  const src = copyOf(ctx, W, H);
  const short = Math.min(W, H);
  clearAll(ctx, W, H);
  // fundo: a própria imagem escurecida e desfocada
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.restore();
  cheapBlurInPlace(ctx, W, H, short * 0.03);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const cw = W * (0.86 - 0.1 * v), border = short * 0.035;
  const photo = cw - border * 2;
  const ph = Math.min(photo * (H / W), H * 0.7);
  const ch = ph + border * 1.2 + short * 0.12;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(((-3 + 1.5 * Math.sin(t * sp * 0.8)) * Math.PI) / 180 * v);
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = short * 0.04; ctx.shadowOffsetY = short * 0.012;
  ctx.fillStyle = color ?? '#FBFAF6';
  ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
  ctx.shadowColor = 'transparent';
  // foto em "cover" na janela
  const k = Math.max(photo / W, ph / H);
  const sw = photo / k, sh = ph / k;
  ctx.drawImage(src as CanvasImageSource, (W - sw) / 2, (H - sh) / 2, sw, sh, -photo / 2, -ch / 2 + border, photo, ph);
  ctx.restore();
}

function dustScratches(ctx: Ctx, W: number, H: number, v: number, t: number, sp: number) {
  const f = Math.floor(t * 18 * sp);
  const short = Math.min(W, H);
  ctx.globalCompositeOperation = 'source-atop';
  // poeira
  const n = Math.round(6 + 30 * v);
  for (let i = 0; i < n; i++) {
    if (hash(f * 13 + i) > 0.5) continue;
    const x = hash(f * 7 + i * 3.1) * W, y = hash(f * 11 + i * 5.3) * H;
    const r = short * (0.001 + 0.004 * hash(f + i));
    ctx.fillStyle = hash(i + f) > 0.5 ? 'rgba(20,15,10,0.7)' : 'rgba(255,250,235,0.6)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // fios de cabelo
  ctx.strokeStyle = 'rgba(15,10,5,0.55)';
  ctx.lineWidth = Math.max(1, short / 900);
  for (let i = 0; i < 2; i++) {
    if (hash(f * 3 + i * 17) > 0.25 * v + 0.05) continue;
    const x = hash(f * 5 + i) * W, y = hash(f * 9 + i) * H, s = short * 0.06;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + s, y - s * 0.4, x + s * 0.4, y + s, x + s * 1.4, y + s * 0.6);
    ctx.stroke();
  }
  // riscos verticais
  ctx.strokeStyle = `rgba(255,250,240,${0.35 * v})`;
  for (let i = 0; i < 3; i++) {
    if (hash(f * 19 + i) < 0.6) continue;
    const x = hash(f * 23 + i) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (hash(f + i * 7) - 0.5) * 6, H); ctx.stroke();
  }
}

/* ---------------- split / clone ---------------- */

function grid(ctx: Ctx, W: number, H: number, cols: number, rows: number, v: number) {
  const src = copyOf(ctx, W, H);
  clearAll(ctx, W, H);
  const cw = W / cols, ch = H / rows;
  // recorte "cover" do quadro para a célula
  const k = Math.max(cw / W, ch / H);
  const sw = cw / k, sh = ch / k;
  const gap = Math.min(W, H) * 0.006 * v;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.drawImage(src as CanvasImageSource, (W - sw) / 2, (H - sh) / 2, sw, sh, c * cw + gap, r * ch + gap, cw - gap * 2, ch - gap * 2);
    }
  }
}

function mirror4(ctx: Ctx, W: number, H: number) {
  const src = copyOf(ctx, W, H);
  clearAll(ctx, W, H);
  const hw = W / 2, hh = H / 2;
  for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(fx, fy);
    ctx.drawImage(src as CanvasImageSource, -hw, -hh, hw, hh);
    ctx.restore();
  }
}

function mirrorVertical(ctx: Ctx, W: number, H: number) {
  const src = copyOf(ctx, W, H);
  ctx.clearRect(0, H / 2, W, H / 2);
  ctx.save();
  ctx.translate(0, H);
  ctx.scale(1, -1);
  ctx.drawImage(src as CanvasImageSource, 0, 0, W, H / 2, 0, 0, W, H / 2);
  ctx.restore();
}

/** eco de quadros (rastro): acumula o resultado anterior; reinicia ao pular no tempo */
const echoState = new WeakMap<object, { t: number }>();
function echoTrail(ctx: Ctx, W: number, H: number, v: number, t: number, key: object) {
  const prev = echoState.get(key);
  const { c: acc, ctx: ac } = scratchKeep(key, W, H);
  const jump = !prev || t < prev.t - 1e-4 || t - prev.t > 0.25;
  if (jump) {
    ac.clearRect(0, 0, W, H);
  } else {
    // esmaece o acumulado (destination-out com alfa = 1 - decaimento)
    // decaimento por TEMPO (não por quadro): o rastro é igual no preview a 60 fps e no export a 30 fps
    const dt = Math.max(0, t - prev!.t);
    const keepPerFrame30 = 1 - (0.55 - 0.4 * v);
    const keep = Math.pow(keepPerFrame30, dt * 30);
    ac.globalCompositeOperation = 'destination-out';
    ac.fillStyle = `rgba(0,0,0,${(1 - keep).toFixed(4)})`;
    ac.fillRect(0, 0, W, H);
    ac.globalCompositeOperation = 'source-over';
  }
  ac.globalAlpha = 1;
  ac.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
  echoState.set(key, { t });
  clearAll(ctx, W, H);
  ctx.drawImage(acc as CanvasImageSource, 0, 0);
}

/** canvas persistente (NÃO limpo a cada uso) por chave — usado pelo eco */
const keepPool = new WeakMap<object, AnyCanvas>();
function scratchKeep(key: object, W: number, H: number): { c: AnyCanvas; ctx: Ctx } {
  let c = keepPool.get(key);
  if (!c || c.width !== W || c.height !== H) {
    c = makeCanvas(W, H);
    keepPool.set(key, c);
  }
  const cx = c.getContext('2d') as Ctx;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = 'source-over';
  return { c, ctx: cx };
}

/* ---------------- despacho ---------------- */

/** efeitos que só desenham por cima (não leem/trocam os pixels de baixo) */
const NEW_OVERLAY: VisualEffectKind[] = [
  'snow', 'rain', 'confetti', 'hearts', 'bubbles', 'fireflies', 'embers', 'bokeh', 'lens-flare', 'light-leak-2',
  'light-leak-3', 'frame-border', 'film-frame', 'cinema-bars-anim', 'countdown',
];
export const OVERLAY_EFFECTS: ReadonlySet<VisualEffectKind> = new Set<VisualEffectKind>([
  ...NEW_OVERLAY, 'sparkle', 'light-leak', 'black-bars',
]);

export const PAINT_2D_EFFECTS: ReadonlySet<VisualEffectKind> = new Set<VisualEffectKind>([
  ...NEW_OVERLAY, 'light-sweep', 'disco', 'strobe-color', 'flash-black', 'freeze-flash', 'vignette', 'rounded-frame',
  'drop-shadow', 'polaroid', 'dust-scratches', 'split-2', 'split-3', 'split-4', 'split-9', 'mirror-4', 'mirror-vertical', 'echo-trail',
]);

/** aplica um efeito 2D novo; false = não é um efeito 2D desta sessão */
export function paint2DEffect(ctx: Ctx, W: number, H: number, e: VisualEffect, t: number, o: FxOpts = {}): boolean {
  if (!PAINT_2D_EFFECTS.has(e.kind)) return false;
  const v = fxIntensity(e), sp = fxSpeed(e);
  if (v <= 0) return true;
  const portrait = H >= W;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  switch (e.kind) {
    case 'snow': snow(ctx, W, H, v, t, sp); break;
    case 'rain': rain(ctx, W, H, v, t, sp, e.angle ?? 100); break;
    case 'confetti': confetti(ctx, W, H, v, t, sp); break;
    case 'hearts': hearts(ctx, W, H, v, t, sp, e.color); break;
    case 'bubbles': bubbles(ctx, W, H, v, t, sp); break;
    case 'fireflies': case 'embers': case 'bokeh': sprites(ctx, W, H, v, t, sp, e.kind, e.color); break;
    case 'light-leak-2': leak(ctx, W, H, v, t, sp, 2); break;
    case 'light-leak-3': leak(ctx, W, H, v, t, sp, 3); break;
    case 'lens-flare': lensFlare(ctx, W, H, v, t, sp, e.color); break;
    case 'light-sweep': lightSweep(ctx, W, H, v, t, sp); break;
    case 'disco': disco(ctx, W, H, v, t, sp); break;
    case 'strobe-color': strobeColor(ctx, W, H, v, t, sp); break;
    case 'flash-black': flashBlack(ctx, W, H, v, t, sp); break;
    case 'freeze-flash': freezeFlash(ctx, W, H, v, t, sp, o); break;
    case 'countdown': countdown(ctx, W, H, v, t, sp, o, e.color); break;
    case 'frame-border': frameBorder(ctx, W, H, v, e.color); break;
    case 'film-frame': filmFrame(ctx, W, H, v, t, sp); break;
    case 'cinema-bars-anim': cinemaBarsAnim(ctx, W, H, v, o); break;
    case 'vignette': vignetteFx(ctx, W, H, v, e.color); break;
    case 'rounded-frame': roundedFrame(ctx, W, H, v, e.color); break;
    case 'drop-shadow': dropShadow(ctx, W, H, v, e.angle ?? 60, e.color); break;
    case 'polaroid': polaroid(ctx, W, H, v, t, sp, e.color); break;
    case 'dust-scratches': dustScratches(ctx, W, H, v, t, sp); break;
    case 'split-2': grid(ctx, W, H, portrait ? 1 : 2, portrait ? 2 : 1, v); break;
    case 'split-3': grid(ctx, W, H, portrait ? 1 : 3, portrait ? 3 : 1, v); break;
    case 'split-4': grid(ctx, W, H, 2, 2, v); break;
    case 'split-9': grid(ctx, W, H, 3, 3, v); break;
    case 'mirror-4': mirror4(ctx, W, H); break;
    case 'mirror-vertical': mirrorVertical(ctx, W, H); break;
    case 'echo-trail': echoTrail(ctx, W, H, v, t, e); break;
    default: break;
  }
  ctx.restore();
  return true;
}

export { S_TMP as FX_TMP_SLOT };
