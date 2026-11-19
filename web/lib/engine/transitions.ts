/* parâmetros visuais de cada transição (puro). progress 0..1; role 'out' = clipe que sai, 'in' = que entra */
import type { TransitionKind } from '../types';
import { ease } from './easing';
import { isShaderTransition } from './shaderTransitions';
import { FX_TRANSITION_LABELS } from '../fx/catalog';

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
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const e = ease('easeInOut', p);
  const bell = Math.sin(p * Math.PI); // 0 → 1 → 0
  const v: TransitionVisual = { ...NEUTRAL_TRANSITION };
  // transições em shader: o compositor WebGL faz a mistura; aqui fica o fallback (dissolver)
  if (isShaderTransition(kind)) {
    if (role === 'in') v.opacity = e;
    return v;
  }
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
    /* empurrar: os dois andam juntos */
    case 'push-left': v.dx = role === 'out' ? -e : 1 - e; break;
    case 'push-right': v.dx = role === 'out' ? e : -(1 - e); break;
    case 'push-up': v.dy = role === 'out' ? -e : 1 - e; break;
    case 'push-down': v.dy = role === 'out' ? e : -(1 - e); break;
    /* cobrir: o que entra desliza por cima; o que sai fica parado e escurece um pouco */
    case 'cover-left': if (role === 'in') v.dx = 1 - e; else v.opacity = 1 - 0.3 * e; break;
    case 'cover-right': if (role === 'in') v.dx = -(1 - e); else v.opacity = 1 - 0.3 * e; break;
    case 'cover-up': if (role === 'in') v.dy = 1 - e; else v.opacity = 1 - 0.3 * e; break;
    case 'cover-down': if (role === 'in') v.dy = -(1 - e); else v.opacity = 1 - 0.3 * e; break;
    /* deslizar com desfoque (CSS: translate + blur) */
    case 'slide-blur-left':
    case 'slide-blur-right': {
      const dir = kind === 'slide-blur-left' ? -1 : 1;
      v.dx = role === 'out' ? dir * e : -dir * (1 - e);
      v.blur = bell;
      break;
    }
    default:
      if (role === 'out') v.opacity = 0;
  }
  return v;
}

/** rótulos PT-BR (derivados do catálogo único em lib/fx/catalog.ts) */
export const TRANSITION_LABELS: Record<TransitionKind, string> = FX_TRANSITION_LABELS;

export const ALL_TRANSITIONS = Object.keys(TRANSITION_LABELS) as TransitionKind[];
