/* =====================================================================
   Rodas de cor: posição do disco (puck) ⇄ deslocamento RGB. O disco usa o
   mesmo plano do vetorscópio (Cb horizontal, Cr vertical, Rec.709), então
   empurrar a roda para o vermelho move a imagem para o vermelho no
   vetorscópio. O deslocamento resultante tem luminância ~0 (só cor).
   ===================================================================== */
import type { ColorWheel } from '../types';
import { clamp, num } from './grade';

/** raio 1 do disco ⇒ |(Cb,Cr)| = WHEEL_RANGE */
export const WHEEL_RANGE = 0.35;

/** (x,y) no disco unitário (x→direita, y→cima) + mestre ⇒ ColorWheel */
export function wheelFromPuck(x: number, y: number, master = 0): ColorWheel {
  let m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; m = 1; }
  const cb = x * WHEEL_RANGE, cr = y * WHEEL_RANGE;
  const r = 1.5748 * cr;
  const g = -0.187324 * cb - 0.468124 * cr;
  const b = 1.8556 * cb;
  const q = (v: number) => Math.round(v * 10000) / 10000;
  return { r: q(clamp(r, -1, 1)), g: q(clamp(g, -1, 1)), b: q(clamp(b, -1, 1)), y: q(clamp(master, -1, 1)) };
}

/** ColorWheel ⇒ posição do disco (ignora a parte de luminância de r/g/b) */
export function puckFromWheel(w?: ColorWheel): { x: number; y: number; master: number } {
  if (!w) return { x: 0, y: 0, master: 0 };
  const r = num(w.r), g = num(w.g), b = num(w.b);
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cb = (b - Y) / 1.8556, cr = (r - Y) / 1.5748;
  let x = cb / WHEEL_RANGE, y = cr / WHEEL_RANGE;
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y, master: num(w.y) };
}

/** cor CSS da direção do disco (para o anel/indicador) */
export function puckColor(x: number, y: number): string {
  const w = wheelFromPuck(x, y);
  const to = (v: number) => Math.round(clamp(0.5 + v * 0.9, 0, 1) * 255);
  return `rgb(${to(w.r)},${to(w.g)},${to(w.b)})`;
}
