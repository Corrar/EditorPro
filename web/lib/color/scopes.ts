/* =====================================================================
   Escopos (puros): histograma RGB+L, forma de onda RGB e vetorscópio
   (Cb/Cr Rec.709) de um quadro reduzido; e o desenho em canvas 2D.
   computeScopes roda no Worker (scopes.worker.ts) ou na thread principal.
   ===================================================================== */

export interface ScopeOpts { waveW: number; waveH: number; vecSize: number }
export interface ScopeData {
  histR: Uint32Array; histG: Uint32Array; histB: Uint32Array; histL: Uint32Array;
  /** waveW × waveH × 3 contagens (linha 0 = nível 1,0 no topo) */
  wave: Uint32Array; waveW: number; waveH: number;
  /** vecSize² contagens (centro = neutro, Cb → x, Cr → −y) */
  vec: Uint32Array; vecSize: number;
  pixels: number;
}

export const DEFAULT_SCOPE_OPTS: ScopeOpts = { waveW: 256, waveH: 128, vecSize: 128 };

export function computeScopes(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, o: ScopeOpts = DEFAULT_SCOPE_OPTS): ScopeData {
  const { data, width: W, height: H } = img;
  const histR = new Uint32Array(256), histG = new Uint32Array(256), histB = new Uint32Array(256), histL = new Uint32Array(256);
  const wave = new Uint32Array(o.waveW * o.waveH * 3);
  const vec = new Uint32Array(o.vecSize * o.vecSize);
  const hm = o.waveH - 1, vs = o.vecSize, half = (vs - 1) / 2;
  let pixels = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < 8) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      pixels++;
      histR[r]++; histG[g]++; histB[b]++;
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
      histL[l]++;
      const col = Math.min(o.waveW - 1, ((x * o.waveW) / W) | 0);
      const base = col * o.waveH * 3;
      wave[base + (hm - ((r * hm / 255) | 0)) * 3]++;
      wave[base + (hm - ((g * hm / 255) | 0)) * 3 + 1]++;
      wave[base + (hm - ((b * hm / 255) | 0)) * 3 + 2]++;
      // Cb/Cr em −0,5..0,5 (escala ×2 p/ ocupar o círculo como nos escopos de verdade)
      const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const cb = (b / 255 - Y) / 1.8556, cr = (r / 255 - Y) / 1.5748;
      const vx = Math.round(half + cb * 2 * half), vy = Math.round(half - cr * 2 * half);
      if (vx >= 0 && vx < vs && vy >= 0 && vy < vs) vec[vy * vs + vx]++;
    }
  }
  return { histR, histG, histB, histL, wave, waveW: o.waveW, waveH: o.waveH, vec, vecSize: vs, pixels };
}

type C2D = CanvasRenderingContext2D;

/** histograma RGB sobreposto (aditivo) */
export function drawHistogram(ctx: C2D, s: ScopeData, W: number, H: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0B0C0E';
  ctx.fillRect(0, 0, W, H);
  grid(ctx, W, H, 4, 0);
  let mx = 1;
  // ignora as pontas (preto/branco estourado) na escala, como os NLEs fazem
  for (const h of [s.histR, s.histG, s.histB]) for (let i = 1; i < 255; i++) mx = Math.max(mx, h[i]);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  const cols: [Uint32Array, string][] = [[s.histR, 'rgba(255,70,60,.75)'], [s.histG, 'rgba(60,220,90,.75)'], [s.histB, 'rgba(70,120,255,.8)']];
  for (const [h, c] of cols) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const v = Math.min(1, Math.sqrt(h[i] / mx));
      ctx.lineTo((i / 255) * W, H - v * (H - 4));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = prev;
}

/** forma de onda RGB (sobreposta) — usa ImageData p/ ser rápida */
export function drawWaveform(ctx: C2D, s: ScopeData, W: number, H: number) {
  const img = ctx.createImageData(s.waveW, s.waveH);
  const d = img.data;
  const gain = 255 * 6 / Math.max(1, s.pixels / s.waveW / s.waveH * 6);
  for (let x = 0; x < s.waveW; x++) {
    for (let y = 0; y < s.waveH; y++) {
      const i = (x * s.waveH + y) * 3, o = (y * s.waveW + x) * 4;
      d[o] = Math.min(255, 14 + Math.sqrt(s.wave[i]) * gain * 0.35);
      d[o + 1] = Math.min(255, 14 + Math.sqrt(s.wave[i + 1]) * gain * 0.35);
      d[o + 2] = Math.min(255, 18 + Math.sqrt(s.wave[i + 2]) * gain * 0.4);
      d[o + 3] = 255;
    }
  }
  const tmp = scopeCanvas(s.waveW, s.waveH);
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp as CanvasImageSource, 0, 0, W, H);
  grid(ctx, W, H, 4, 0, true);
}

/** vetorscópio com alvos de cor e linha de tom de pele */
export function drawVectorscope(ctx: C2D, s: ScopeData, W: number, H: number) {
  const n = s.vecSize;
  const img = ctx.createImageData(n, n);
  const d = img.data;
  let mx = 1;
  for (let i = 0; i < s.vec.length; i++) if (s.vec[i] > mx) mx = s.vec[i];
  const half = (n - 1) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = s.vec[y * n + x];
    const o = (y * n + x) * 4;
    if (!v) { d[o + 3] = 0; continue; }
    const k = Math.min(1, Math.pow(v / mx, 0.35) * 1.2);
    // cor do ponto = a própria crominância (como o Resolve)
    const cb = ((x - half) / half) / 2, cr = ((half - y) / half) / 2;
    const R = 0.6 + 1.5748 * cr, G = 0.6 - 0.1873 * cb - 0.4681 * cr, B = 0.6 + 1.8556 * cb;
    d[o] = Math.min(255, R * 255 * k + 40 * k); d[o + 1] = Math.min(255, G * 255 * k + 40 * k); d[o + 2] = Math.min(255, B * 255 * k + 40 * k);
    d[o + 3] = Math.min(255, 90 + 165 * k);
  }
  const tmp = scopeCanvas(n, n);
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  const S = Math.min(W, H);
  const ox = (W - S) / 2, oy = (H - S) / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0B0C0E';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, S / 4, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2, oy + 2); ctx.lineTo(W / 2, oy + S - 2); ctx.moveTo(ox + 2, H / 2); ctx.lineTo(ox + S - 2, H / 2); ctx.stroke();
  // linha de tom de pele (~123° no vetorscópio)
  ctx.strokeStyle = 'rgba(242,154,90,.55)';
  const a = (-123 * Math.PI) / 180;
  ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.lineTo(W / 2 + Math.cos(a) * (S / 2 - 2), H / 2 + Math.sin(a) * (S / 2 - 2)); ctx.stroke();
  // alvos das cores primárias/secundárias a 75%
  const targets: [string, number, number, number][] = [['R', 0.75, 0, 0], ['G', 0, 0.75, 0], ['B', 0, 0, 0.75], ['Cy', 0, 0.75, 0.75], ['Mg', 0.75, 0, 0.75], ['Yl', 0.75, 0.75, 0]];
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [lab, r, g, b] of targets) {
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cb = (b - Y) / 1.8556, cr = (r - Y) / 1.5748;
    const x = W / 2 + cb * 2 * (S / 2), y = H / 2 - cr * 2 * (S / 2);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(lab, x, y - 10);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp as CanvasImageSource, ox, oy, S, S);
}

function grid(ctx: C2D, W: number, H: number, rows: number, cols: number, labels = false) {
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < rows; i++) { const y = Math.round((i / rows) * H) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  for (let i = 1; i < cols; i++) { const x = Math.round((i / cols) * W) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  ctx.stroke();
  if (labels) {
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i <= rows; i++) ctx.fillText(String(Math.round(100 - (i / rows) * 100)), 3, Math.min(H - 10, (i / rows) * H + 2));
  }
}

const tmpCanvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
function scopeCanvas(w: number, h: number) {
  const k = `${w}x${h}`;
  let c = tmpCanvases.get(k);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    tmpCanvases.set(k, c);
  }
  return c as HTMLCanvasElement;
}
