/* parâmetros visuais de cada transição (puro). progress 0..1; role 'out' = clipe que sai, 'in' = que entra */
import type { TransitionKind } from '../types';
import { ease } from './easing';

export interface TransitionVisual {
  opacity: number;
  /** deslocamento em fração do quadro */
  dx: number;
  dy: number;
  scale: number;
  rotation: number; // graus
  /** desfoque de movimento horizontal, 0..1 */
  motionBlur: number;
  /** desfoque gaussiano, 0..1 */
  blur: number;
  /** flash branco por cima (só aplicado uma vez, no clipe que entra), 0..1 */
  flash: number;
  /** intensidade do glitch, 0..1 */
  glitch: number;
  /** mergulho de cor sobre o quadro (dip to black/white) */
  dip?: { color: string; alpha: number };
  /** revelação recortada do clipe que entra */
  reveal?: { kind: 'wipe-left' | 'wipe-right' | 'wipe-up' | 'circle'; progress: number };
  pixelate: number; // 0..1
  shake: number; // 0..1
  rgbSplit: number; // 0..1
  burn: number; // 0..1 (queimado de filme)
}

export const NEUTRAL_TRANSITION: TransitionVisual = {
  opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, motionBlur: 0, blur: 0, flash: 0, glitch: 0,
  pixelate: 0, shake: 0, rgbSplit: 0, burn: 0,
};

/** troca seca no meio: sai na 1ª metade, entra na 2ª */
const swapAtMid = (v: TransitionVisual, p: number, role: 'in' | 'out') => {
  v.opacity = role === 'out' ? (p < 0.5 ? 1 : 0) : (p < 0.5 ? 0 : 1);
};

export function transitionVisual(kind: TransitionKind, progress: number, role: 'in' | 'out'): TransitionVisual {
  const p = Math.min(1, Math.max(0, progress));
  const e = ease('easeInOut', p);
  const bell = Math.sin(p * Math.PI); // 0 → 1 → 0
  const v: TransitionVisual = { ...NEUTRAL_TRANSITION };
  switch (kind) {
    case 'fade':
      // fade via preto: sai até metade, entra na segunda metade
      if (role === 'out') v.opacity = p < 0.5 ? 1 - p * 2 : 0;
      else v.opacity = p < 0.5 ? 0 : (p - 0.5) * 2;
      break;
    case 'crossfade':
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
    case 'slide-down':
      if (role === 'out') v.dy = e; else v.dy = -(1 - e);
      break;
    case 'zoom-in':
      if (role === 'out') v.scale = 1 + e * 0.6;
      else { v.scale = 0.6 + 0.4 * e; v.opacity = e; }
      break;
    case 'zoom-out':
      if (role === 'out') v.scale = 1 - e * 0.3;
      else { v.scale = 1.6 - 0.6 * e; v.opacity = e; }
      break;
    case 'whip':
      v.motionBlur = bell;
      if (role === 'out') { v.dx = -ease('easeIn', Math.min(1, p * 2)); v.opacity = p < 0.5 ? 1 : 0; }
      else { v.dx = 1 - ease('easeOut', Math.max(0, p * 2 - 1)); v.opacity = p < 0.5 ? 0 : 1; }
      break;
    case 'flash':
      swapAtMid(v, p, role);
      if (role === 'in') v.flash = 1 - Math.abs(p - 0.5) * 2;
      break;
    case 'glitch':
      v.glitch = bell;
      swapAtMid(v, p, role);
      break;
    case 'dip-black':
    case 'dip-white':
      swapAtMid(v, p, role);
      if (role === 'in') v.dip = { color: kind === 'dip-black' ? '#000000' : '#ffffff', alpha: 1 - Math.abs(p - 0.5) * 2 };
      break;
    case 'blur':
      v.blur = bell;
      if (role === 'in') v.opacity = e;
      break;
    case 'spin':
      if (role === 'out') { v.rotation = e * 180; v.scale = 1 - e * 0.6; v.opacity = p < 0.5 ? 1 : 0; }
      else { v.rotation = -(1 - e) * 180; v.scale = 0.4 + 0.6 * e; v.opacity = p < 0.5 ? 0 : 1; }
      v.motionBlur = bell * 0.4;
      break;
    case 'wipe-left':
    case 'wipe-right':
    case 'wipe-up':
      if (role === 'in') v.reveal = { kind, progress: e };
      break;
    case 'circle-open':
      if (role === 'in') v.reveal = { kind: 'circle', progress: e };
      break;
    case 'pixelate':
      v.pixelate = bell;
      swapAtMid(v, p, role);
      break;
    case 'shake':
      v.shake = bell;
      swapAtMid(v, p, role);
      break;
    case 'rgb-split':
      v.rgbSplit = bell;
      swapAtMid(v, p, role);
      break;
    case 'film-burn':
      if (role === 'in') { v.burn = bell; v.opacity = e; }
      break;
    default:
      if (role === 'out') v.opacity = 0;
  }
  return v;
}

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
  cut: 'Corte seco', fade: 'Fade (preto)', crossfade: 'Dissolver', 'slide-left': 'Deslizar ←',
  'slide-right': 'Deslizar →', 'slide-up': 'Deslizar ↑', 'slide-down': 'Deslizar ↓', 'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out', whip: 'Chicote', glitch: 'Glitch', flash: 'Flash', 'dip-black': 'Mergulho preto',
  'dip-white': 'Mergulho branco', blur: 'Desfoque', spin: 'Giro', 'wipe-left': 'Cortina ←', 'wipe-right': 'Cortina →',
  'wipe-up': 'Cortina ↑', 'circle-open': 'Círculo', pixelate: 'Pixelar', shake: 'Tremor', 'rgb-split': 'RGB split',
  'film-burn': 'Filme queimado',
};

export const ALL_TRANSITIONS = Object.keys(TRANSITION_LABELS) as TransitionKind[];
