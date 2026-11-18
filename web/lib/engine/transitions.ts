/* parâmetros visuais de cada transição (puro). progress 0..1; role 'out' = clipe que sai, 'in' = que entra */
import type { TransitionKind } from '../types';
import { ease } from './easing';

export interface TransitionVisual {
  opacity: number;
  /** deslocamento em fração do quadro */
  dx: number;
  dy: number;
  scale: number;
  /** desfoque de movimento horizontal, 0..1 */
  motionBlur: number;
  /** flash branco por cima (só aplicado uma vez, no clipe que entra), 0..1 */
  flash: number;
  /** intensidade do glitch, 0..1 */
  glitch: number;
}

const NEUTRAL: TransitionVisual = { opacity: 1, dx: 0, dy: 0, scale: 1, motionBlur: 0, flash: 0, glitch: 0 };

export function transitionVisual(kind: TransitionKind, progress: number, role: 'in' | 'out'): TransitionVisual {
  const p = Math.min(1, Math.max(0, progress));
  const e = ease('easeInOut', p);
  const v = { ...NEUTRAL };
  switch (kind) {
    case 'fade':
      // fade via preto: sai até metade, entra na segunda metade
      if (role === 'out') v.opacity = p < 0.5 ? 1 - p * 2 : 0;
      else v.opacity = p < 0.5 ? 0 : (p - 0.5) * 2;
      break;
    case 'crossfade':
      // o que sai fica por baixo opaco; o que entra sobe de 0 a 1
      if (role === 'in') v.opacity = e;
      break;
    case 'slide-left':
      if (role === 'out') v.dx = -e; else v.dx = 1 - e;
      break;
    case 'slide-right':
      if (role === 'out') v.dx = e; else v.dx = -(1 - e);
      break;
    case 'slide-up':
      if (role === 'out') v.dy = -e; else v.dy = 1 - e;
      break;
    case 'zoom-in':
      if (role === 'out') { v.scale = 1 + e * 0.6; v.opacity = 1; }
      else { v.scale = 0.6 + 0.4 * e; v.opacity = e; }
      break;
    case 'zoom-out':
      if (role === 'out') { v.scale = 1 - e * 0.3; }
      else { v.scale = 1.6 - 0.6 * e; v.opacity = e; }
      break;
    case 'whip': {
      const blur = Math.sin(p * Math.PI);
      v.motionBlur = blur;
      if (role === 'out') { v.dx = -ease('easeIn', Math.min(1, p * 2)); v.opacity = p < 0.5 ? 1 : 0; }
      else { v.dx = 1 - ease('easeOut', Math.max(0, p * 2 - 1)); v.opacity = p < 0.5 ? 0 : 1; }
      break;
    }
    case 'flash':
      if (role === 'out') v.opacity = p < 0.5 ? 1 : 0;
      else { v.opacity = p < 0.5 ? 0 : 1; v.flash = 1 - Math.abs(p - 0.5) * 2; }
      break;
    case 'glitch':
      v.glitch = Math.sin(p * Math.PI);
      if (role === 'out') v.opacity = p < 0.5 ? 1 : 0;
      else v.opacity = p < 0.5 ? 0 : 1;
      break;
    default:
      if (role === 'out') v.opacity = 0;
  }
  return v;
}

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  cut: 'Corte seco', fade: 'Fade (preto)', crossfade: 'Dissolver', 'slide-left': 'Deslizar ←',
  'slide-right': 'Deslizar →', 'slide-up': 'Deslizar ↑', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out',
  whip: 'Chicote', glitch: 'Glitch', flash: 'Flash',
};
