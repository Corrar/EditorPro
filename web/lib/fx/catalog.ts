/* =====================================================================
   CATÁLOGO ÚNICO de efeitos, transições, mesclagens, máscaras e animações
   de clipe (fonte da verdade p/ painéis, IA e /dev/fx). Puro: só dados.
   - label: nome PT-BR mostrado na UI
   - category: aba/agrupamento (estilo CapCut)
   - params: controles a exibir (intensity/speed/color/angle)
   - cssThumb: filtro CSS aproximado p/ miniatura (aplicado sobre uma foto)
   - cost: custo estimado no preview (1 = leve, 2 = médio, 3 = pesado; medido em /dev/fx)
   - render: 'geometry' (transform), 'gl' (shader por pixel), '2d' (canvas), 'css'/'shader' (transição)
   - native: o preview híbrido pode manter o <video> nativo? 'css' = sim, via CSS;
     'overlay' = sim, desenhando só por cima no canvas transparente; 'canvas' = precisa compor no canvas
   ===================================================================== */
import type { BlendMode, ClipAnimation, MaskShape, TransitionKind, VisualEffectKind } from '../types';

export type FxParamKey = 'intensity' | 'speed' | 'color' | 'angle';
export interface FxParamSpec {
  key: FxParamKey;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
}
export type FxCost = 1 | 2 | 3;
export type FxNative = 'css' | 'overlay' | 'canvas';

export type EffectCategory =
  | 'Básico' | 'Lente' | 'Desfoque' | 'Distorção' | 'Glitch' | 'Retrô' | 'Luz' | 'Estilizar'
  | 'Split/Clone' | 'Estrobo' | 'Partículas' | 'Moldura' | 'Festa' | 'IA';

export interface EffectEntry {
  kind: VisualEffectKind;
  label: string;
  category: EffectCategory;
  params: FxParamSpec[];
  cssThumb: string;
  cost: FxCost;
  render: 'geometry' | 'gl' | '2d';
  native: FxNative;
  /** cor padrão quando o efeito aceita cor */
  defaultColor?: string;
}

const P = {
  i: { key: 'intensity', label: 'Intensidade', min: 0, max: 1, step: 0.01, default: 0.6 } as FxParamSpec,
  s: { key: 'speed', label: 'Velocidade', min: 0.1, max: 3, step: 0.05, default: 1 } as FxParamSpec,
  c: (d: string): FxParamSpec => ({ key: 'color', label: 'Cor', default: d }),
  a: (d: number, label = 'Direção'): FxParamSpec => ({ key: 'angle', label, min: 0, max: 360, step: 1, default: d }),
};

type E = [VisualEffectKind, string, EffectCategory, string, FxCost, EffectEntry['render'], FxNative, ('s' | 'c' | 'a')[]?, string?, number?];

/* [kind, rótulo, categoria, cssThumb, custo, render, nativo, params extras, cor padrão, ângulo padrão] */
const EFFECTS: E[] = [
  /* básicos (já existiam) */
  ['shake', 'Tremor', 'Básico', 'none', 1, 'geometry', 'css', ['s']],
  ['zoom-pulse', 'Pulso de zoom', 'Básico', 'none', 1, 'geometry', 'css', ['s']],
  ['zoom-punch', 'Zoom punch', 'Básico', 'contrast(1.1)', 1, 'geometry', 'css', ['s']],
  ['zoom-slow', 'Zoom suave', 'Básico', 'none', 1, 'geometry', 'css', ['s']],
  ['handheld', 'Câmera na mão', 'Básico', 'none', 1, 'geometry', 'css', ['s']],
  ['shake-3d', 'Tremor 3D', 'Básico', 'contrast(1.1)', 1, 'geometry', 'css', ['s']],
  ['beat-pulse', 'Batida', 'Básico', 'saturate(1.2)', 1, 'geometry', 'css', ['s']],
  ['invert', 'Inverter', 'Básico', 'invert(1)', 1, 'gl', 'canvas'],
  ['vignette', 'Vinheta', 'Básico', 'brightness(.85) contrast(1.15)', 1, '2d', 'canvas', ['c'], '#000000'],
  ['black-bars', 'Barras de cinema', 'Moldura', 'contrast(1.1)', 1, '2d', 'overlay'],
  /* lente */
  ['fisheye', 'Olho de peixe', 'Lente', 'contrast(1.05)', 1, 'gl', 'canvas'],
  ['bulge', 'Lente bolha', 'Lente', 'contrast(1.05)', 1, 'gl', 'canvas', ['s']],
  ['pinch', 'Beliscar', 'Lente', 'contrast(1.05)', 1, 'gl', 'canvas', ['s']],
  ['chromatic-aberration', 'Aberração cromática', 'Lente', 'saturate(1.5)', 1, 'gl', 'canvas'],
  ['tilt-shift', 'Miniatura (tilt-shift)', 'Lente', 'saturate(1.35) contrast(1.1)', 2, 'gl', 'canvas'],
  ['focus-center', 'Foco central', 'Lente', 'blur(.6px)', 2, 'gl', 'canvas'],
  /* desfoque */
  ['blur-gauss', 'Desfoque', 'Desfoque', 'blur(2px)', 2, 'gl', 'canvas'],
  ['blur-motion', 'Desfoque de movimento', 'Desfoque', 'blur(1px)', 1, '2d', 'canvas'],
  ['blur-directional', 'Desfoque direcional', 'Desfoque', 'blur(1.2px)', 2, 'gl', 'canvas', ['a'], undefined, 0],
  ['blur-radial', 'Desfoque giratório', 'Desfoque', 'blur(1.2px)', 2, 'gl', 'canvas'],
  ['blur-zoom', 'Desfoque de zoom', 'Desfoque', 'blur(1.2px)', 2, 'gl', 'canvas'],
  /* distorção */
  ['swirl', 'Redemoinho', 'Distorção', 'hue-rotate(20deg)', 1, 'gl', 'canvas', ['s']],
  ['waves', 'Ondas', 'Distorção', 'hue-rotate(-15deg)', 1, 'gl', 'canvas', ['s']],
  ['heat-haze', 'Onda de calor', 'Distorção', 'sepia(.2) saturate(1.3)', 2, 'gl', 'canvas', ['s']],
  ['ripple', 'Ondulação', 'Distorção', 'brightness(1.05)', 1, 'gl', 'canvas', ['s']],
  ['kaleidoscope', 'Caleidoscópio', 'Distorção', 'hue-rotate(90deg)', 1, '2d', 'canvas'],
  ['kaleidoscope-6', 'Caleidoscópio 6', 'Distorção', 'hue-rotate(140deg) saturate(1.3)', 1, 'gl', 'canvas', ['s']],
  /* glitch */
  ['glitch', 'Glitch', 'Glitch', 'hue-rotate(40deg) saturate(1.6)', 2, '2d', 'canvas', ['s']],
  ['glitch-digital', 'Glitch digital', 'Glitch', 'hue-rotate(60deg) saturate(1.8)', 1, 'gl', 'canvas', ['s']],
  ['datamosh', 'Datamosh', 'Glitch', 'saturate(1.6) contrast(1.2)', 1, 'gl', 'canvas', ['s']],
  ['rgb-split', 'RGB split', 'Glitch', 'saturate(1.8) contrast(1.1)', 2, '2d', 'canvas', ['s']],
  ['rgb-wave', 'RGB em onda', 'Glitch', 'saturate(1.8)', 1, 'gl', 'canvas', ['s']],
  ['pixel-sort', 'Pixel sort', 'Glitch', 'contrast(1.3) brightness(1.1)', 2, 'gl', 'canvas'],
  ['pixelate', 'Pixelado', 'Glitch', 'contrast(1.2)', 1, '2d', 'canvas'],
  /* retrô */
  ['vhs', 'VHS', 'Retrô', 'sepia(.25) saturate(1.4) contrast(.9) blur(.4px)', 2, '2d', 'canvas', ['s']],
  ['vhs-2', 'VHS 2', 'Retrô', 'sepia(.3) saturate(1.2) contrast(.92) blur(.3px)', 1, 'gl', 'canvas', ['s']],
  ['crt', 'TV antiga (CRT)', 'Retrô', 'contrast(1.2) saturate(1.2)', 1, 'gl', 'canvas', ['s']],
  ['old-film', 'Filme antigo', 'Retrô', 'sepia(.7) contrast(1.1)', 2, '2d', 'canvas'],
  ['film-8mm', 'Filme 8mm', 'Retrô', 'sepia(.6) contrast(1.15) brightness(.95)', 1, 'gl', 'canvas', ['s']],
  ['film-grain', 'Granulado', 'Retrô', 'contrast(1.1) saturate(.85)', 1, '2d', 'canvas'],
  ['dust-scratches', 'Poeira e riscos', 'Retrô', 'sepia(.2) contrast(1.05)', 1, '2d', 'canvas', ['s']],
  ['night-vision', 'Visão noturna', 'Retrô', 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(3)', 1, 'gl', 'canvas', ['s']],
  /* luz */
  ['light-leak', 'Vazamento de luz', 'Luz', 'sepia(.3) brightness(1.15) saturate(1.3)', 1, '2d', 'overlay', ['s']],
  ['light-leak-2', 'Vazamento quente', 'Luz', 'sepia(.35) brightness(1.2) saturate(1.4)', 1, '2d', 'overlay', ['s']],
  ['light-leak-3', 'Vazamento arco-íris', 'Luz', 'hue-rotate(30deg) brightness(1.15) saturate(1.5)', 1, '2d', 'overlay', ['s']],
  ['lens-flare', 'Lens flare', 'Luz', 'brightness(1.2) contrast(1.05)', 1, '2d', 'overlay', ['s', 'c'], '#FFD296'],
  ['bokeh', 'Bokeh', 'Luz', 'brightness(1.1) saturate(1.2)', 1, '2d', 'overlay', ['s', 'c']],
  ['soft-glow', 'Brilho suave', 'Luz', 'brightness(1.15) contrast(.95)', 2, 'gl', 'canvas'],
  ['bloom', 'Bloom', 'Luz', 'brightness(1.2) saturate(1.1)', 2, 'gl', 'canvas'],
  ['neon-glow', 'Neon', 'Luz', 'contrast(1.4) saturate(2) brightness(.8)', 3, 'gl', 'canvas', ['c'], '#22E6FF'],
  ['neon-edge', 'Contorno neon', 'Luz', 'contrast(1.3) saturate(1.8)', 2, '2d', 'canvas'],
  ['light-sweep', 'Brilho deslizante', 'Luz', 'brightness(1.12)', 1, '2d', 'canvas', ['s']],
  /* estilizar */
  ['cartoon', 'Cartoon', 'Estilizar', 'saturate(1.6) contrast(1.3)', 2, 'gl', 'canvas'],
  ['sketch', 'Esboço', 'Estilizar', 'grayscale(1) contrast(1.6) brightness(1.3)', 2, 'gl', 'canvas'],
  ['halftone', 'Meio-tom', 'Estilizar', 'contrast(1.4) saturate(1.2)', 1, 'gl', 'canvas'],
  ['duotone', 'Duotone', 'Estilizar', 'grayscale(1) sepia(1) hue-rotate(-30deg) saturate(3)', 1, 'gl', 'canvas', ['c'], '#F2681F'],
  ['posterize', 'Posterizar', 'Estilizar', 'contrast(1.5) saturate(1.4)', 1, 'gl', 'canvas'],
  ['ascii', 'ASCII', 'Estilizar', 'grayscale(1) contrast(2) brightness(.7)', 1, 'gl', 'canvas'],
  ['pixel-art', 'Pixel art', 'Estilizar', 'contrast(1.3) saturate(1.3)', 1, 'gl', 'canvas'],
  ['outline', 'Contorno', 'Estilizar', 'contrast(1.4)', 2, 'gl', 'canvas', ['c'], '#FFFFFF'],
  ['thermal', 'Câmera térmica', 'Estilizar', 'invert(1) hue-rotate(180deg) saturate(3)', 1, 'gl', 'canvas'],
  ['rainbow', 'Arco-íris', 'Estilizar', 'hue-rotate(120deg) saturate(1.8)', 1, 'gl', 'canvas', ['s']],
  /* split / clone */
  ['mirror', 'Espelho', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['mirror-vertical', 'Espelho vertical', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['mirror-4', 'Espelho 4', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['split-2', 'Tela dividida 2', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['split-3', 'Tela dividida 3', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['split-4', 'Tela dividida 4', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['split-9', 'Tela dividida 9', 'Split/Clone', 'none', 1, '2d', 'canvas'],
  ['echo-trail', 'Eco de quadros', 'Split/Clone', 'blur(.5px) brightness(1.05)', 1, '2d', 'canvas'],
  /* estrobo */
  ['flash-strobe', 'Estroboscópio', 'Estrobo', 'brightness(1.4)', 1, '2d', 'canvas', ['s']],
  ['strobe-color', 'Estrobo colorido', 'Estrobo', 'hue-rotate(200deg) saturate(2)', 1, '2d', 'canvas', ['s']],
  ['flash-black', 'Piscar', 'Estrobo', 'brightness(.6)', 1, '2d', 'canvas', ['s']],
  ['freeze-flash', 'Flash de entrada', 'Estrobo', 'brightness(1.6)', 1, '2d', 'canvas', ['s']],
  ['vignette-pulse', 'Vinheta pulsante', 'Estrobo', 'brightness(.9) contrast(1.15)', 1, '2d', 'canvas', ['s']],
  /* partículas */
  ['sparkle', 'Brilhos', 'Partículas', 'brightness(1.1)', 1, '2d', 'overlay', ['s']],
  ['snow', 'Neve', 'Partículas', 'brightness(1.1) saturate(.8) hue-rotate(-10deg)', 1, '2d', 'overlay', ['s']],
  ['rain', 'Chuva', 'Partículas', 'brightness(.85) saturate(.7) hue-rotate(10deg)', 1, '2d', 'overlay', ['s', 'a'], undefined, 100],
  ['confetti', 'Confete', 'Partículas', 'saturate(1.4)', 1, '2d', 'overlay', ['s']],
  ['hearts', 'Corações', 'Partículas', 'saturate(1.3) hue-rotate(-20deg)', 1, '2d', 'overlay', ['s', 'c']],
  ['bubbles', 'Bolhas', 'Partículas', 'brightness(1.08) hue-rotate(-20deg)', 1, '2d', 'overlay', ['s']],
  ['fireflies', 'Vaga-lumes', 'Partículas', 'brightness(.9) saturate(1.2)', 1, '2d', 'overlay', ['s', 'c']],
  ['embers', 'Brasas', 'Partículas', 'sepia(.3) saturate(1.5)', 1, '2d', 'overlay', ['s', 'c']],
  /* moldura */
  ['frame-border', 'Borda', 'Moldura', 'none', 1, '2d', 'overlay', ['c'], '#FFFFFF'],
  ['rounded-frame', 'Cantos arredondados', 'Moldura', 'none', 1, '2d', 'canvas', ['c']],
  ['polaroid', 'Polaroid', 'Moldura', 'sepia(.15) contrast(1.05)', 2, '2d', 'canvas', ['s', 'c'], '#FBFAF6'],
  ['film-frame', 'Película', 'Moldura', 'sepia(.25) contrast(1.1)', 1, '2d', 'overlay', ['s']],
  ['cinema-bars-anim', 'Barras animadas', 'Moldura', 'contrast(1.1) saturate(.9)', 1, '2d', 'overlay'],
  ['drop-shadow', 'Sombra projetada', 'Moldura', 'none', 1, '2d', 'canvas', ['c', 'a'], '#000000', 60],
  /* festa */
  ['disco', 'Discoteca', 'Festa', 'saturate(1.6) hue-rotate(280deg)', 1, '2d', 'canvas', ['s']],
  ['countdown', 'Contagem regressiva', 'Festa', 'brightness(.8)', 1, '2d', 'overlay', ['s', 'c'], '#F2681F'],
  /* escrito pela IA em GLSL (VisualEffect.code) — nome exibido: effectDisplayName() */
  ['custom', 'IA: personalizado', 'IA', 'saturate(1.3) hue-rotate(15deg)', 2, 'gl', 'canvas', ['s', 'c']],
];

export const EFFECT_CATALOG: readonly EffectEntry[] = EFFECTS.map(([kind, label, category, cssThumb, cost, render, native, extra, color, angle]) => {
  const params: FxParamSpec[] = [P.i];
  for (const x of extra ?? []) {
    if (x === 's') params.push(P.s);
    else if (x === 'c') params.push(P.c(color ?? '#F2681F'));
    else if (x === 'a') params.push(P.a(angle ?? 0));
  }
  return { kind, label, category, params, cssThumb, cost, render, native, ...(color ? { defaultColor: color } : {}) };
});

export const EFFECT_CATEGORIES: readonly EffectCategory[] = [
  'Básico', 'Lente', 'Desfoque', 'Distorção', 'Glitch', 'Retrô', 'Luz', 'Estilizar', 'Split/Clone', 'Estrobo', 'Partículas', 'Moldura', 'Festa', 'IA',
];

/* ============================ transições ============================ */

export type TransitionCategory = 'Básicas' | 'Câmera' | 'Slide' | 'Máscara' | '3D' | 'Efeitos' | 'Luz' | 'Glitch' | 'Distorção' | 'IA';

export interface TransitionEntry {
  kind: TransitionKind;
  label: string;
  category: TransitionCategory;
  /** 'css' = parâmetros visuais (transitionVisual); 'shader' = mistura WebGL dos dois quadros */
  render: 'css' | 'shader';
  /** duração padrão sugerida (s) */
  duration: number;
  cssThumb: string;
  cost: FxCost;
  native: FxNative;
}

type T = [TransitionKind, string, TransitionCategory, 'css' | 'shader', number, string, FxCost];
const TR: T[] = [
  ['cut', 'Corte seco', 'Básicas', 'css', 0, 'none', 1],
  ['fade', 'Fade (preto)', 'Básicas', 'css', 0.5, 'brightness(.5)', 1],
  ['crossfade', 'Dissolver', 'Básicas', 'css', 0.5, 'opacity(.7)', 1],
  ['dip-black', 'Mergulho preto', 'Básicas', 'css', 0.5, 'brightness(.3)', 1],
  ['dip-white', 'Mergulho branco', 'Básicas', 'css', 0.5, 'brightness(1.7)', 1],
  ['blur', 'Desfoque', 'Básicas', 'css', 0.5, 'blur(2px)', 1],
  ['noise-dissolve', 'Dissolver ruído', 'Básicas', 'shader', 0.6, 'contrast(1.2)', 1],
  ['luma-melt', 'Derreter luz', 'Básicas', 'shader', 0.7, 'brightness(1.1)', 1],
  /* câmera */
  ['zoom-in', 'Zoom in', 'Câmera', 'css', 0.5, 'none', 1],
  ['zoom-out', 'Zoom out', 'Câmera', 'css', 0.5, 'none', 1],
  ['whip', 'Chicote', 'Câmera', 'css', 0.4, 'blur(1px)', 1],
  ['whip-pan', 'Chicote (shader)', 'Câmera', 'shader', 0.45, 'blur(1px)', 2],
  ['whip-left', 'Chicote ←', 'Câmera', 'shader', 0.4, 'blur(1px)', 2],
  ['whip-right', 'Chicote →', 'Câmera', 'shader', 0.4, 'blur(1px)', 2],
  ['whip-up', 'Chicote ↑', 'Câmera', 'shader', 0.4, 'blur(1px)', 2],
  ['whip-down', 'Chicote ↓', 'Câmera', 'shader', 0.4, 'blur(1px)', 2],
  ['zoom-blur', 'Zoom com desfoque', 'Câmera', 'shader', 0.5, 'blur(1px)', 2],
  ['spin-blur', 'Giro com desfoque', 'Câmera', 'shader', 0.5, 'blur(1px)', 2],
  ['cinematic-zoom', 'Zoom cinemático', 'Câmera', 'shader', 0.6, 'contrast(1.1)', 2],
  ['zoom-rotate', 'Zoom e giro', 'Câmera', 'shader', 0.6, 'none', 1],
  ['spin', 'Giro', 'Câmera', 'css', 0.5, 'none', 1],
  ['shake', 'Tremor', 'Câmera', 'css', 0.4, 'none', 1],
  ['camera-flash', 'Flash de câmera', 'Câmera', 'shader', 0.45, 'brightness(1.8)', 1],
  ['shutter', 'Obturador', 'Câmera', 'shader', 0.5, 'brightness(.6)', 1],
  ['stretch', 'Esticar', 'Câmera', 'shader', 0.5, 'none', 1],
  ['squeeze', 'Espremer', 'Câmera', 'shader', 0.5, 'none', 1],
  /* slide */
  ['slide-left', 'Deslizar ←', 'Slide', 'css', 0.5, 'none', 1],
  ['slide-right', 'Deslizar →', 'Slide', 'css', 0.5, 'none', 1],
  ['slide-up', 'Deslizar ↑', 'Slide', 'css', 0.5, 'none', 1],
  ['slide-down', 'Deslizar ↓', 'Slide', 'css', 0.5, 'none', 1],
  ['push-left', 'Empurrar ←', 'Slide', 'css', 0.5, 'none', 1],
  ['push-right', 'Empurrar →', 'Slide', 'css', 0.5, 'none', 1],
  ['push-up', 'Empurrar ↑', 'Slide', 'css', 0.5, 'none', 1],
  ['push-down', 'Empurrar ↓', 'Slide', 'css', 0.5, 'none', 1],
  ['cover-left', 'Cobrir ←', 'Slide', 'css', 0.5, 'none', 1],
  ['cover-right', 'Cobrir →', 'Slide', 'css', 0.5, 'none', 1],
  ['cover-up', 'Cobrir ↑', 'Slide', 'css', 0.5, 'none', 1],
  ['cover-down', 'Cobrir ↓', 'Slide', 'css', 0.5, 'none', 1],
  ['uncover-left', 'Descobrir ←', 'Slide', 'shader', 0.5, 'none', 1],
  ['uncover-up', 'Descobrir ↑', 'Slide', 'shader', 0.5, 'none', 1],
  ['slide-blur-left', 'Deslizar com desfoque ←', 'Slide', 'css', 0.45, 'blur(1px)', 1],
  ['slide-blur-right', 'Deslizar com desfoque →', 'Slide', 'css', 0.45, 'blur(1px)', 1],
  ['film-roll', 'Rolo de filme', 'Slide', 'shader', 0.6, 'sepia(.3)', 1],
  /* máscara */
  ['wipe-left', 'Cortina ←', 'Máscara', 'css', 0.5, 'none', 1],
  ['wipe-right', 'Cortina →', 'Máscara', 'css', 0.5, 'none', 1],
  ['wipe-up', 'Cortina ↑', 'Máscara', 'css', 0.5, 'none', 1],
  ['circle-open', 'Círculo', 'Máscara', 'css', 0.5, 'none', 1],
  ['sdf-iris', 'Íris', 'Máscara', 'shader', 0.6, 'none', 1],
  ['iris-close', 'Íris fechando', 'Máscara', 'shader', 0.6, 'none', 1],
  ['diamond', 'Losango', 'Máscara', 'shader', 0.5, 'none', 1],
  ['luma-star', 'Estrela', 'Máscara', 'shader', 0.6, 'none', 1],
  ['luma-heart', 'Coração', 'Máscara', 'shader', 0.6, 'none', 1],
  ['luma-diagonal', 'Diagonal', 'Máscara', 'shader', 0.5, 'none', 1],
  ['luma-clock', 'Relógio', 'Máscara', 'shader', 0.6, 'none', 1],
  ['doors-open', 'Portas abrindo', 'Máscara', 'shader', 0.6, 'none', 1],
  ['doors-close', 'Portas fechando', 'Máscara', 'shader', 0.6, 'none', 1],
  ['split-open', 'Abrir no meio', 'Máscara', 'shader', 0.5, 'none', 1],
  ['blinds-h', 'Persiana horizontal', 'Máscara', 'shader', 0.6, 'none', 1],
  ['blinds-v', 'Persiana vertical', 'Máscara', 'shader', 0.6, 'none', 1],
  ['checkerboard', 'Xadrez', 'Máscara', 'shader', 0.6, 'none', 1],
  ['squares', 'Quadrados', 'Máscara', 'shader', 0.6, 'none', 1],
  ['polka', 'Bolinhas', 'Máscara', 'shader', 0.6, 'none', 1],
  /* 3D */
  ['cube-left', 'Cubo ←', '3D', 'shader', 0.7, 'none', 1],
  ['cube-right', 'Cubo →', '3D', 'shader', 0.7, 'none', 1],
  ['cube-up', 'Cubo ↑', '3D', 'shader', 0.7, 'none', 1],
  ['flip-x', 'Virar 3D', '3D', 'shader', 0.6, 'none', 1],
  ['flip-y', 'Virar 3D vertical', '3D', 'shader', 0.6, 'none', 1],
  ['page-curl', 'Virar página', '3D', 'shader', 0.8, 'sepia(.1)', 1],
  ['tv-off', 'TV desligando', '3D', 'shader', 0.5, 'brightness(1.3)', 1],
  /* efeitos */
  ['ink', 'Tinta', 'Efeitos', 'shader', 0.8, 'contrast(1.3)', 2],
  ['smoke', 'Fumaça', 'Efeitos', 'shader', 0.8, 'grayscale(.3) brightness(1.1)', 2],
  ['mosaic', 'Mosaico', 'Efeitos', 'shader', 0.6, 'contrast(1.2)', 1],
  ['pixelate', 'Pixelar', 'Efeitos', 'css', 0.5, 'contrast(1.2)', 1],
  ['kaleido', 'Caleidoscópio', 'Efeitos', 'shader', 0.7, 'hue-rotate(90deg)', 1],
  ['dreamy', 'Sonho', 'Efeitos', 'shader', 0.8, 'blur(1px) brightness(1.15)', 2],
  ['wind', 'Vento', 'Efeitos', 'shader', 0.6, 'none', 1],
  ['cross-warp-morph', 'Metamorfose', 'Efeitos', 'shader', 0.7, 'none', 2],
  ['domain-warp', 'Distorção fluida', 'Efeitos', 'shader', 0.8, 'none', 3],
  ['ridged-burn', 'Queima em brasa', 'Efeitos', 'shader', 0.8, 'sepia(.5) saturate(2)', 3],
  ['film-burn', 'Filme queimado', 'Efeitos', 'css', 0.6, 'sepia(.6) brightness(1.3)', 1],
  ['burn-2', 'Queimar filme 2', 'Efeitos', 'shader', 0.7, 'sepia(.6) saturate(2) brightness(1.2)', 2],
  /* luz */
  ['flash', 'Flash', 'Luz', 'css', 0.4, 'brightness(1.8)', 1],
  ['flash-through-white', 'Flash branco suave', 'Luz', 'shader', 0.6, 'brightness(1.6)', 1],
  ['light-leak', 'Vazamento de luz', 'Luz', 'shader', 0.7, 'sepia(.3) brightness(1.3)', 1],
  ['flare', 'Luz / flare', 'Luz', 'shader', 0.6, 'brightness(1.4)', 1],
  /* glitch */
  ['glitch', 'Glitch', 'Glitch', 'css', 0.4, 'hue-rotate(40deg) saturate(1.6)', 2],
  ['glitch-2', 'Glitch 2', 'Glitch', 'shader', 0.45, 'hue-rotate(60deg) saturate(2)', 1],
  ['digital-glitch', 'Glitch digital', 'Glitch', 'shader', 0.5, 'hue-rotate(80deg) saturate(1.8)', 1],
  ['rgb-split', 'RGB split', 'Glitch', 'css', 0.4, 'saturate(1.8)', 2],
  ['chromatic-split', 'Separação cromática', 'Glitch', 'shader', 0.5, 'saturate(1.8)', 1],
  ['pixel-sort', 'Pixel sort', 'Glitch', 'shader', 0.6, 'contrast(1.3)', 2],
  /* distorção */
  ['ripple-waves', 'Ondas', 'Distorção', 'shader', 0.7, 'none', 1],
  ['wave', 'Onda', 'Distorção', 'shader', 0.6, 'none', 1],
  ['swirl', 'Swirl', 'Distorção', 'shader', 0.6, 'hue-rotate(20deg)', 1],
  ['swirl-vortex', 'Redemoinho', 'Distorção', 'shader', 0.7, 'hue-rotate(30deg)', 2],
  ['gravitational-lens', 'Lente gravitacional', 'Distorção', 'shader', 0.7, 'contrast(1.2)', 1],
  ['thermal-distortion', 'Distorção térmica', 'Distorção', 'shader', 0.7, 'sepia(.3) saturate(1.5)', 2],
  /* escrita pela IA em GLSL (Transition.code); se não compilar, vira dissolver */
  ['custom', 'IA: personalizada', 'IA', 'shader', 0.6, 'saturate(1.3) hue-rotate(15deg)', 2],
];

export const TRANSITION_CATALOG: readonly TransitionEntry[] = TR.map(([kind, label, category, render, duration, cssThumb, cost]) => ({
  kind, label, category, render, duration, cssThumb, cost, native: render === 'css' ? 'css' : 'canvas',
}));

export const TRANSITION_CATEGORIES: readonly TransitionCategory[] = ['Básicas', 'Câmera', 'Slide', 'Máscara', '3D', 'Efeitos', 'Luz', 'Glitch', 'Distorção', 'IA'];

/* ============================ mesclagem ============================ */

export interface BlendEntry { kind: BlendMode; label: string; group: 'Normal' | 'Escurecer' | 'Clarear' | 'Contraste' | 'Diferença' | 'Cor'; op: GlobalCompositeOperation }

export const BLEND_CATALOG: readonly BlendEntry[] = [
  { kind: 'normal', label: 'Normal', group: 'Normal', op: 'source-over' },
  { kind: 'darken', label: 'Escurecer', group: 'Escurecer', op: 'darken' },
  { kind: 'multiply', label: 'Multiplicar', group: 'Escurecer', op: 'multiply' },
  { kind: 'color-burn', label: 'Superexposição de cor', group: 'Escurecer', op: 'color-burn' },
  { kind: 'lighten', label: 'Clarear', group: 'Clarear', op: 'lighten' },
  { kind: 'screen', label: 'Tela', group: 'Clarear', op: 'screen' },
  { kind: 'color-dodge', label: 'Subexposição de cor', group: 'Clarear', op: 'color-dodge' },
  { kind: 'add', label: 'Adicionar', group: 'Clarear', op: 'lighter' },
  { kind: 'overlay', label: 'Sobrepor', group: 'Contraste', op: 'overlay' },
  { kind: 'soft-light', label: 'Luz suave', group: 'Contraste', op: 'soft-light' },
  { kind: 'hard-light', label: 'Luz forte', group: 'Contraste', op: 'hard-light' },
  { kind: 'difference', label: 'Diferença', group: 'Diferença', op: 'difference' },
  { kind: 'exclusion', label: 'Exclusão', group: 'Diferença', op: 'exclusion' },
  { kind: 'hue', label: 'Matiz', group: 'Cor', op: 'hue' },
  { kind: 'saturation', label: 'Saturação', group: 'Cor', op: 'saturation' },
  { kind: 'color', label: 'Cor', group: 'Cor', op: 'color' },
  { kind: 'luminosity', label: 'Luminosidade', group: 'Cor', op: 'luminosity' },
];

/* ============================ máscaras ============================ */

export interface MaskEntry {
  kind: MaskShape;
  label: string;
  /** usa o campo radius / text */
  radius?: boolean;
  text?: boolean;
  /** forma suave por gradiente (feather sem filtro de desfoque) */
  gradient?: boolean;
  /** caixa padrão ao criar */
  defaults: { x: number; y: number; w: number; h: number; rotation: number; feather: number };
}

const box = (w: number, h: number, feather = 0.1) => ({ x: 0.5, y: 0.5, w, h, rotation: 0, feather });

export const MASK_CATALOG: readonly MaskEntry[] = [
  { kind: 'line', label: 'Linha', defaults: box(1, 0.02, 0.05) },
  { kind: 'mirror', label: 'Espelho', defaults: box(1, 0.4, 0.05) },
  { kind: 'linear', label: 'Gradiente linear', gradient: true, defaults: box(1, 0.3, 0.6) },
  { kind: 'radial', label: 'Gradiente radial', gradient: true, defaults: box(0.6, 0.6, 0.6) },
  { kind: 'circle', label: 'Círculo', defaults: box(0.6, 0.34) },
  { kind: 'rect', label: 'Retângulo', defaults: box(0.7, 0.5) },
  { kind: 'rounded-rect', label: 'Retângulo arredondado', radius: true, defaults: box(0.7, 0.5) },
  { kind: 'diamond', label: 'Losango', defaults: box(0.6, 0.34) },
  { kind: 'heart', label: 'Coração', defaults: box(0.6, 0.34) },
  { kind: 'star', label: 'Estrela', defaults: box(0.6, 0.34) },
  { kind: 'text', label: 'Texto', text: true, defaults: box(0.9, 0.25, 0) },
];

/* ============================ animações de clipe ============================ */

export type ClipAnimSlot = 'in' | 'out' | 'loop';
export interface ClipAnimationEntry {
  kind: ClipAnimation;
  label: string;
  /** onde faz sentido (entrada/saída/loop) */
  slots: ClipAnimSlot[];
  /** duração padrão (s) */
  duration: number;
  native: FxNative;
}

type A = [ClipAnimation, string, ClipAnimSlot[], number];
const IO: ClipAnimSlot[] = ['in', 'out'], ALL: ClipAnimSlot[] = ['in', 'out', 'loop'], LOOP: ClipAnimSlot[] = ['loop'];
const AN: A[] = [
  ['fade', 'Esmaecer', ALL, 0.5], ['zoom-in', 'Zoom in', ALL, 0.5], ['zoom-out', 'Zoom out', ALL, 0.5],
  ['slide-left', 'Deslizar ←', ALL, 0.5], ['slide-right', 'Deslizar →', ALL, 0.5], ['slide-up', 'Deslizar ↑', ALL, 0.5],
  ['slide-down', 'Deslizar ↓', ALL, 0.5], ['spin', 'Girar', ALL, 0.6], ['bounce', 'Quicar', ALL, 0.6], ['pop', 'Pop', ALL, 0.4],
  ['shake', 'Tremer', ALL, 0.5], ['swing', 'Balançar', ALL, 0.7], ['blur', 'Desfocar', ALL, 0.5], ['flip', 'Virar', ALL, 0.6],
  ['rotate-3d', 'Rotação 3D', ALL, 0.7], ['slide-blur-left', 'Deslizar com desfoque ←', IO, 0.45],
  ['slide-blur-right', 'Deslizar com desfoque →', IO, 0.45], ['slide-blur-up', 'Deslizar com desfoque ↑', IO, 0.45],
  ['spin-zoom', 'Girar e zoom', IO, 0.6], ['drop', 'Queda', IO, 0.6], ['elastic', 'Elástico', IO, 0.8], ['rise', 'Subir', IO, 0.6],
  ['roll', 'Rolar', IO, 0.7], ['zoom-blur', 'Zoom com desfoque', IO, 0.5], ['whirl', 'Rodopio', IO, 0.7], ['squash', 'Amassar', IO, 0.5],
  ['jelly', 'Gelatina', ALL, 0.8], ['tilt', 'Inclinar', ALL, 0.6],
  ['pulse', 'Pulsar', LOOP, 0.8], ['breathe', 'Respirar', LOOP, 2.4], ['wiggle', 'Sacudir', LOOP, 0.6],
  ['heartbeat', 'Batimento', LOOP, 1], ['float', 'Flutuar', LOOP, 2.4], ['pendulum', 'Pêndulo', LOOP, 1.6],
];

const CSS_ANIMS = new Set<ClipAnimation>(['fade', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'spin', 'bounce', 'pop', 'shake', 'swing', 'flip', 'rotate-3d', 'spin-zoom', 'drop', 'elastic', 'rise', 'roll', 'whirl', 'squash', 'jelly', 'tilt', 'pulse', 'breathe', 'wiggle', 'heartbeat', 'float', 'pendulum']);

export const CLIP_ANIMATION_CATALOG: readonly ClipAnimationEntry[] = AN.map(([kind, label, slots, duration]) => ({
  kind, label, slots, duration, native: CSS_ANIMS.has(kind) ? 'css' : 'canvas',
}));

/* ============================ consultas ============================ */

const byKind = <K extends string, V extends { kind: K }>(list: readonly V[]) => {
  const m = new Map<K, V>();
  for (const v of list) m.set(v.kind, v);
  return m;
};
const EFFECT_MAP = byKind(EFFECT_CATALOG), TRANSITION_MAP = byKind(TRANSITION_CATALOG);
const ANIM_MAP = byKind(CLIP_ANIMATION_CATALOG), BLEND_MAP = byKind(BLEND_CATALOG), MASK_MAP = byKind(MASK_CATALOG);

export const effectEntry = (k: VisualEffectKind) => EFFECT_MAP.get(k);
export const transitionEntry = (k: TransitionKind) => TRANSITION_MAP.get(k);
export const clipAnimationEntry = (k: ClipAnimation) => ANIM_MAP.get(k);
export const blendEntry = (k: BlendMode) => BLEND_MAP.get(k);
export const maskEntry = (k: MaskShape) => MASK_MAP.get(k);

const labels = <K extends string>(list: readonly { kind: K; label: string }[]) =>
  Object.fromEntries(list.map((e) => [e.kind, e.label])) as Record<K, string>;

export const FX_EFFECT_LABELS = labels(EFFECT_CATALOG);
export const FX_TRANSITION_LABELS = labels(TRANSITION_CATALOG);
export const FX_BLEND_LABELS = labels(BLEND_CATALOG);
export const FX_MASK_LABELS = labels(MASK_CATALOG);
export const FX_CLIP_ANIMATION_LABELS = labels(CLIP_ANIMATION_CATALOG);

/** nome p/ a UI de um efeito aplicado ('custom' → "IA: <name>"; kind desconhecido não derruba a UI) */
export function effectDisplayName(e: { kind: VisualEffectKind | string; name?: string }): string {
  if (e.kind === 'custom') return `IA: ${(e.name ?? '').trim() || 'efeito personalizado'}`;
  return EFFECT_MAP.get(e.kind as VisualEffectKind)?.label ?? String(e.kind);
}

/** nome p/ a UI de uma transição aplicada ('custom' → "IA: <name>") */
export function transitionDisplayName(t: { kind: TransitionKind | string; name?: string }): string {
  if (t.kind === 'custom') return `IA: ${(t.name ?? '').trim() || 'transição personalizada'}`;
  return TRANSITION_MAP.get(t.kind as TransitionKind)?.label ?? String(t.kind);
}

/** listas de kinds (p/ validação da IA: sanitize.ts) */
export const ALL_EFFECT_KINDS = EFFECT_CATALOG.map((e) => e.kind);
export const ALL_TRANSITION_KINDS = TRANSITION_CATALOG.map((e) => e.kind);
export const ALL_BLEND_MODES = BLEND_CATALOG.map((e) => e.kind);
export const ALL_MASK_SHAPES = MASK_CATALOG.map((e) => e.kind);
export const ALL_CLIP_ANIMATIONS = CLIP_ANIMATION_CATALOG.map((e) => e.kind);
