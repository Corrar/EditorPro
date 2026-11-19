/* sprites cacheados (brilho radial) e utilidades 2D da sessão fx */
import { makeCanvas, type AnyCanvas, type Ctx } from '../engine/surface';

const glowCache = new Map<string, AnyCanvas>();

/** disco de brilho radial 128×128 (cor central → transparente), para bokeh, vaga-lumes, flare */
export function glowSprite(rgb: string, hardness = 0): AnyCanvas {
  const k = `${rgb}|${hardness}`;
  const hit = glowCache.get(k);
  if (hit) return hit;
  const s = 128;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d') as Ctx;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(Math.min(0.95, 0.15 + hardness * 0.7), `rgba(${rgb},${hardness > 0.5 ? 0.9 : 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  if (glowCache.size > 48) glowCache.clear();
  glowCache.set(k, c);
  return c;
}

/** '#RRGGBB' → 'r,g,b' (fallback = laranja da marca) */
export function hexToRgbStr(hex: string | undefined, fallback = '242,104,31'): string {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
}

let filterSupport: boolean | undefined;
/** ctx.filter funciona? (Safari/iOS ignora — não dá para depender dele) */
export function canvasFilterSupported(): boolean {
  if (filterSupport !== undefined) return filterSupport;
  try {
    const c = makeCanvas(8, 8);
    const ctx = c.getContext('2d') as Ctx | null;
    // sem o atributo no protótipo, escrever ctx.filter só cria uma propriedade solta (falso positivo)
    if (!ctx || !('filter' in Object.getPrototypeOf(ctx)) || typeof ctx.filter !== 'string') { filterSupport = false; return false; }
    // atributo existe mas pode ser ignorado: confirma desenhando
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, 0, 4, 8);
    filterSupport = ctx.getImageData(2, 4, 1, 1).data[3] > 0;
  } catch { filterSupport = false; }
  return filterSupport;
}

/** só p/ testes: esquece a detecção (refaz na próxima chamada) */
export function resetCanvasFilterSupport() { filterSupport = undefined; }

export const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%,${a})`;
