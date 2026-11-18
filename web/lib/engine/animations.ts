/* animações de clipe (entrada/saída/loop) estilo CapCut — puro */
import type { ClipAnimation, Seconds } from '../types';
import { clamp01, ease, easeOutBack, easeOutBounce } from './easing';

export interface AnimFx {
  opacity: number;
  dx: number; // fração da largura
  dy: number; // fração da altura
  scale: number;
  rotation: number; // graus
  blur: number; // 0..1
  scaleX: number; // flip (1 = normal)
}

export const NO_ANIM: AnimFx = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0, scaleX: 1 };

export const CLIP_ANIMATION_LABELS: Record<ClipAnimation, string> = {
  fade: 'Esmaecer', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', 'slide-left': 'Deslizar ←', 'slide-right': 'Deslizar →',
  'slide-up': 'Deslizar ↑', 'slide-down': 'Deslizar ↓', spin: 'Girar', bounce: 'Quicar', pop: 'Pop', shake: 'Tremer',
  swing: 'Balançar', blur: 'Desfocar', flip: 'Virar',
};

/** aplica uma animação de entrada com progresso p (0 = início, 1 = repouso). dir=-1 espelha (saída) */
function applyIntro(fx: AnimFx, kind: ClipAnimation, p: number, dir: 1 | -1): void {
  const e = ease('easeOut', p);
  const a = 1 - e; // quanto falta p/ chegar no repouso
  switch (kind) {
    case 'fade': fx.opacity *= e; break;
    case 'zoom-in': fx.scale *= 1 - 0.45 * a; fx.opacity *= clamp01(p * 2.5); break;
    case 'zoom-out': fx.scale *= 1 + 0.45 * a; fx.opacity *= clamp01(p * 2.5); break;
    case 'slide-left': fx.dx += a * dir; break;
    case 'slide-right': fx.dx -= a * dir; break;
    case 'slide-up': fx.dy += a * dir; break;
    case 'slide-down': fx.dy -= a * dir; break;
    case 'spin': fx.rotation += -200 * a * dir; fx.scale *= 1 - 0.6 * a; fx.opacity *= clamp01(p * 2); break;
    case 'bounce': fx.scale *= Math.max(0.001, easeOutBounce(p)); break;
    case 'pop': fx.scale *= Math.max(0.001, easeOutBack(p, 2.4)); fx.opacity *= clamp01(p * 3); break;
    case 'shake': fx.dx += Math.sin(p * 42) * 0.035 * a; fx.opacity *= clamp01(p * 4); break;
    case 'swing': fx.rotation += Math.sin(p * Math.PI * 3) * 22 * a; fx.opacity *= clamp01(p * 3); break;
    case 'blur': fx.blur = Math.max(fx.blur, a); fx.opacity *= clamp01(p * 1.5); break;
    case 'flip': fx.scaleX *= Math.max(0.001, e); break;
  }
}

function applyLoop(fx: AnimFx, kind: ClipAnimation, phase: number): void {
  const s = Math.sin(phase * Math.PI * 2);
  switch (kind) {
    case 'fade': fx.opacity *= 0.65 + 0.35 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2)); break;
    case 'zoom-in': case 'pop': fx.scale *= 1 + 0.06 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2)); break;
    case 'zoom-out': fx.scale *= 1 - 0.06 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2)); break;
    case 'slide-left': case 'slide-right': fx.dx += s * 0.02; break;
    case 'slide-up': case 'slide-down': fx.dy += s * 0.02; break;
    case 'spin': fx.rotation += phase * 360; break;
    case 'bounce': fx.dy -= Math.abs(s) * 0.035; break;
    case 'shake': fx.dx += Math.sin(phase * 60) * 0.012; fx.dy += Math.cos(phase * 47) * 0.008; break;
    case 'swing': fx.rotation += s * 8; break;
    case 'blur': fx.blur = Math.max(fx.blur, 0.3 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))); break;
    case 'flip': fx.scaleX *= Math.cos(phase * Math.PI * 2) || 0.001; break;
  }
}

interface Animated {
  animationIn?: { kind: ClipAnimation; duration: Seconds };
  animationOut?: { kind: ClipAnimation; duration: Seconds };
  animationLoop?: { kind: ClipAnimation; duration: Seconds };
}

/** efeito combinado das animações do clipe em `local` segundos (duração total `duration`) */
export function clipAnimFx(c: Animated, local: Seconds, duration: Seconds): AnimFx {
  const fx = { ...NO_ANIM };
  const ai = c.animationIn;
  if (ai && ai.duration > 0) {
    const d = Math.min(ai.duration, duration);
    if (local < d) applyIntro(fx, ai.kind, clamp01(local / d), 1);
  }
  const ao = c.animationOut;
  if (ao && ao.duration > 0) {
    const d = Math.min(ao.duration, duration);
    const left = duration - local;
    if (left < d) applyIntro(fx, ao.kind, clamp01(left / d), -1);
  }
  const al = c.animationLoop;
  if (al && al.duration > 0) applyLoop(fx, al.kind, (local / al.duration) % 1);
  return fx;
}
