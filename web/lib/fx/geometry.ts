/* efeitos de GEOMETRIA (mexem em posição/escala/rotação do desenho) — puro e determinístico em t */
import type { VisualEffect, VisualEffectKind } from '../types';
import { hash } from '../engine/surface';

export interface FxGeometry { dx: number; dy: number; scale: number; rotation: number }

export const GEOMETRY_EFFECTS: ReadonlySet<VisualEffectKind> = new Set<VisualEffectKind>([
  'shake', 'zoom-pulse', 'zoom-punch', 'zoom-slow', 'handheld', 'shake-3d', 'beat-pulse',
]);

export const isGeometryEffect = (k: VisualEffectKind) => GEOMETRY_EFFECTS.has(k);

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const fxIntensity = (e: VisualEffect) => Math.max(0, Math.min(1, num(e.intensity, 0.5)));
export const fxSpeed = (e: VisualEffect) => Math.max(0.05, Math.min(4, num(e.speed, 1)));

/** acumula a geometria dos efeitos novos em `g` (os antigos 'shake'/'zoom-pulse' ficam em effects.ts) */
export function addFxGeometry(g: FxGeometry, e: VisualEffect, t: number): void {
  const v = fxIntensity(e), sp = fxSpeed(e);
  if (v <= 0) return;
  t = num(t, 0);
  switch (e.kind) {
    case 'zoom-punch': {
      // corta entre normal e "zoom punch" a cada batida (0,5 s), com 60 ms de transição
      const beat = t * sp * 2;
      const ph = beat - Math.floor(beat);
      const on = Math.floor(beat) % 2 === 1;
      const k = Math.min(1, ph / 0.12);
      const amt = on ? k : 1 - k;
      g.scale *= 1 + 0.22 * v * Math.max(0, Math.min(1, amt));
      break;
    }
    case 'zoom-slow': {
      const ph = (t * sp) / 6;
      g.scale *= 1 + 0.16 * v * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
      break;
    }
    case 'handheld': {
      const a = t * sp;
      g.dx += 0.012 * v * (Math.sin(a * 1.3) + 0.5 * Math.sin(a * 2.9 + 1.1) + 0.25 * Math.sin(a * 6.1 + 2));
      g.dy += 0.01 * v * (Math.sin(a * 1.1 + 0.7) + 0.5 * Math.sin(a * 3.3 + 0.2));
      g.rotation += 0.9 * v * Math.sin(a * 0.9 + 0.4);
      g.scale *= 1 + 0.035 * v;
      break;
    }
    case 'shake-3d': {
      const f = Math.floor(t * 20 * sp);
      g.dx += (hash(f + 3) - 0.5) * 0.07 * v;
      g.dy += (hash(f + 31) - 0.5) * 0.07 * v;
      g.rotation += (hash(f + 59) - 0.5) * 6 * v;
      g.scale *= 1 + 0.07 * v + 0.06 * v * hash(f + 97);
      break;
    }
    case 'beat-pulse': {
      const bpm = 120 * sp;
      const b = (t * bpm) / 60;
      const ph = b - Math.floor(b);
      g.scale *= 1 + 0.09 * v * Math.exp(-ph * 8);
      break;
    }
    default: break;
  }
}
