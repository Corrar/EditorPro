/* =====================================================================
   Catálogo da IA = catálogos dos DONOS (engine/biblioteca), nunca listas
   próprias. Cada lista cai num fallback estático se o módulo do dono
   estiver vazio. Quando a sessão FX publicar lib/fx/*_CATALOG, basta
   acrescentar aqui (mesmo formato: id -> rótulo PT-BR).
   ===================================================================== */
import type {
  AudioEffectKind, BlendMode, ClipAnimation, ColorPreset, FilterKind, MaskShape, ShapeKind, SpeedPreset, TextAnimation,
  TransitionKind, VisualEffectKind,
} from '../types';
import { TRANSITION_LABELS } from '../engine/transitions';
import { EFFECT_LABELS } from '../engine/effects';
import { FILTER_LABELS, PRESET_LABELS } from '../engine/filters';
import { TEXT_ANIMATION_LABELS } from '../engine/text';
import { CLIP_ANIMATION_LABELS } from '../engine/animations';
import { AUDIO_EFFECT_LABELS } from '../engine/audioFx';
import { SPEED_PRESET_LABELS } from '../engine/speed';
import { SHAPE_LABELS } from '../engine/shapes';
import { MASK_LABELS } from '../engine/masks';

function keys<K extends string>(labels: Record<K, string> | undefined, fallback: K[]): K[] {
  const k = labels ? (Object.keys(labels) as K[]) : [];
  return k.length ? k : fallback;
}

export const CATALOG = {
  transitions: keys<TransitionKind>(TRANSITION_LABELS, ['cut', 'fade', 'crossfade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'whip', 'glitch', 'flash']),
  effects: keys<VisualEffectKind>(EFFECT_LABELS, ['shake', 'glitch', 'rgb-split', 'zoom-pulse', 'vhs', 'film-grain']),
  filters: keys<FilterKind>(FILTER_LABELS, ['brightness', 'contrast', 'saturation', 'temperature', 'blur', 'vignette']),
  colorPresets: keys<ColorPreset>(PRESET_LABELS, ['none', 'cinematic', 'warm', 'cool', 'vibrant', 'vintage', 'bw', 'moody']),
  textAnimations: keys<TextAnimation>(TEXT_ANIMATION_LABELS, ['none', 'fade', 'pop', 'slide-up', 'typewriter', 'bounce', 'karaoke']),
  clipAnimations: keys<ClipAnimation>(CLIP_ANIMATION_LABELS, ['fade', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'pop']),
  audioEffects: keys<AudioEffectKind>(AUDIO_EFFECT_LABELS, ['noise-reduction', 'normalize', 'voice-enhance', 'robot', 'echo']),
  speedPresets: keys<SpeedPreset>(SPEED_PRESET_LABELS, ['montage', 'hero', 'bullet', 'jump-cut', 'flash-in', 'flash-out']),
  shapes: keys<ShapeKind>(SHAPE_LABELS, ['rect', 'rounded-rect', 'circle', 'triangle', 'star', 'arrow', 'line', 'heart', 'speech-bubble']),
  masks: keys<MaskShape>(MASK_LABELS as Record<MaskShape, string>, ['rect', 'circle', 'heart', 'star', 'line', 'mirror']),
};

export const LABELS: Record<string, Record<string, string>> = {
  transitions: TRANSITION_LABELS, effects: EFFECT_LABELS, filters: FILTER_LABELS, colorPresets: PRESET_LABELS,
  textAnimations: TEXT_ANIMATION_LABELS, clipAnimations: CLIP_ANIMATION_LABELS, audioEffects: AUDIO_EFFECT_LABELS,
  speedPresets: SPEED_PRESET_LABELS, shapes: SHAPE_LABELS, masks: MASK_LABELS,
};

const TITLES: Record<keyof typeof CATALOG, string> = {
  transitions: 'Transições (transitionIn.kind)', effects: 'Efeitos visuais (effects[].kind)', filters: 'Filtros (filters[].kind)',
  colorPresets: 'Predefinições de cor (colorPreset)', textAnimations: 'Animações de texto/legenda (animation)',
  clipAnimations: 'Animações de clipe (animationIn/Out/Loop.kind)', audioEffects: 'Efeitos de áudio (audioEffects[].kind)',
  speedPresets: 'Curvas de velocidade (speedPreset)', shapes: 'Formas (shape)', masks: 'Máscaras (mask.shape)',
};

/** texto do catálogo vivo para o prompt (id = rótulo PT-BR, para mapear o que o usuário fala) */
export function engineCatalogForAI(): string {
  return (Object.keys(CATALOG) as (keyof typeof CATALOG)[])
    .map((k) => `${TITLES[k]}: ${CATALOG[k].map((id) => (LABELS[k]?.[id] ? `${id} (${LABELS[k][id]})` : id)).join(', ')}`)
    .join('\n');
}

export type { BlendMode };
