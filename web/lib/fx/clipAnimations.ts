/* animações de clipe novas (entrada/saída/loop estilo CapCut) — puro. Plugadas em lib/engine/animations.ts */
import type { ClipAnimation } from '../types';
import type { AnimFx } from '../engine/animations';
import { clamp01, ease, easeOutBack } from '../engine/easing';

const elastic = (t: number) => {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

/** entrada com progresso p (0 = início, 1 = repouso); dir = -1 na saída. false = kind desconhecido */
export function applyIntroFx(fx: AnimFx, kind: ClipAnimation, p: number, dir: 1 | -1): boolean {
  p = Number.isFinite(p) ? clamp01(p) : 1;
  const e = ease('easeOut', p);
  const a = 1 - e;
  switch (kind) {
    case 'rotate-3d': fx.scaleX *= Math.max(0.001, Math.cos(a * Math.PI / 2)); fx.rotation += -12 * a * dir; fx.opacity *= clamp01(p * 2); break;
    case 'slide-blur-left': fx.dx += a * 0.6 * dir; fx.blur = Math.max(fx.blur, a); fx.opacity *= clamp01(p * 2); break;
    case 'slide-blur-right': fx.dx -= a * 0.6 * dir; fx.blur = Math.max(fx.blur, a); fx.opacity *= clamp01(p * 2); break;
    case 'slide-blur-up': fx.dy += a * 0.6 * dir; fx.blur = Math.max(fx.blur, a); fx.opacity *= clamp01(p * 2); break;
    case 'spin-zoom': fx.rotation += -360 * a * dir; fx.scale *= 1 + 1.2 * a; fx.opacity *= clamp01(p * 2); break;
    case 'drop': { const b = easeOutBack(p, 1.6); fx.dy -= (1 - b) * 1.1; fx.opacity *= clamp01(p * 3); break; }
    case 'elastic': fx.scale *= Math.max(0.001, elastic(p)); break;
    case 'rise': fx.dy += a * 0.35; fx.opacity *= e; break;
    case 'roll': fx.dx -= a * 1.1 * dir; fx.rotation += -360 * a * dir; break;
    case 'zoom-blur': fx.scale *= 1 + 0.6 * a; fx.blur = Math.max(fx.blur, a); fx.opacity *= clamp01(p * 1.6); break;
    case 'whirl': fx.rotation += 540 * a * dir; fx.scale *= Math.max(0.001, e); break;
    case 'squash': fx.scaleX *= 1 + 0.5 * a * Math.cos(p * Math.PI * 3); fx.scale *= Math.max(0.001, easeOutBack(p, 2)); break;
    case 'jelly': fx.scaleX *= 1 + 0.25 * a * Math.sin(p * Math.PI * 6); fx.scale *= 1 - 0.15 * a * Math.cos(p * Math.PI * 6); fx.opacity *= clamp01(p * 4); break;
    case 'tilt': fx.rotation += 25 * a * dir; fx.dy += a * 0.15; fx.opacity *= e; break;
    /* loops usados como entrada/saída: entra suave */
    case 'pulse': case 'breathe': case 'wiggle': case 'heartbeat': case 'float': case 'pendulum':
      fx.opacity *= e; break;
    default: return false;
  }
  return true;
}

/** loop com fase 0..1. false = kind desconhecido */
export function applyLoopFx(fx: AnimFx, kind: ClipAnimation, phase: number): boolean {
  const ph = Number.isFinite(phase) ? phase - Math.floor(phase) : 0;
  const TAU = Math.PI * 2;
  const s = Math.sin(ph * TAU);
  switch (kind) {
    case 'rotate-3d': fx.scaleX *= Math.cos(ph * TAU) || 0.001; break;
    case 'pulse': fx.scale *= 1 + 0.08 * Math.max(0, s); break;
    case 'breathe': fx.scale *= 1 + 0.04 * (0.5 - 0.5 * Math.cos(ph * TAU)); fx.opacity *= 0.92 + 0.08 * (0.5 + 0.5 * s); break;
    case 'wiggle': fx.rotation += Math.sin(ph * TAU * 3) * 4; fx.dx += Math.sin(ph * TAU * 2) * 0.008; break;
    case 'heartbeat': { const b = Math.exp(-((ph % 0.5) * 14)); fx.scale *= 1 + 0.07 * b * (ph < 0.5 ? 1 : 0.6); break; }
    case 'float': fx.dy += s * 0.02; fx.rotation += Math.sin(ph * TAU + 1) * 1.5; break;
    case 'pendulum': fx.rotation += s * 12; break;
    case 'tilt': fx.rotation += s * 5; break;
    case 'jelly': fx.scaleX *= 1 + 0.05 * s; fx.scale *= 1 - 0.03 * s; break;
    case 'squash': fx.scaleX *= 1 + 0.06 * Math.abs(s); break;
    case 'slide-blur-left': case 'slide-blur-right': case 'slide-blur-up': case 'rise': case 'drop': fx.dy += s * 0.015; break;
    case 'spin-zoom': case 'whirl': case 'roll': fx.rotation += ph * 360; break;
    case 'zoom-blur': case 'elastic': fx.scale *= 1 + 0.05 * (0.5 - 0.5 * Math.cos(ph * TAU)); break;
    default: return false;
  }
  return true;
}
