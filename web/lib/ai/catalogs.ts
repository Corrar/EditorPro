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
import { BUILTIN_LOOKS } from '../color/luts';
import { MUSIC_CATALOG } from '../music/catalog';
// catálogo da sessão FX (fonte da verdade p/ efeitos, transições, blend, máscaras e animações de clipe)
import {
  ALL_BLEND_MODES, ALL_CLIP_ANIMATIONS, ALL_EFFECT_KINDS, ALL_MASK_SHAPES, ALL_TRANSITION_KINDS,
  FX_BLEND_LABELS, FX_CLIP_ANIMATION_LABELS, FX_EFFECT_LABELS, FX_MASK_LABELS, FX_TRANSITION_LABELS,
} from '../fx/catalog';

/** lista da FX (se publicada) -> rótulos do engine -> fallback */
function pick<K extends string>(fx: readonly K[] | undefined, labels: Record<K, string> | undefined, fallback: K[]): K[] {
  return fx?.length ? [...new Set(fx)] : keys(labels, fallback);
}

function keys<K extends string>(labels: Record<K, string> | undefined, fallback: K[]): K[] {
  const k = labels ? (Object.keys(labels) as K[]) : [];
  return k.length ? k : fallback;
}

export const CATALOG = {
  transitions: pick<TransitionKind>(ALL_TRANSITION_KINDS, TRANSITION_LABELS, ['cut', 'fade', 'crossfade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'whip', 'glitch', 'flash']),
  effects: pick<VisualEffectKind>(ALL_EFFECT_KINDS, EFFECT_LABELS, ['shake', 'glitch', 'rgb-split', 'zoom-pulse', 'vhs', 'film-grain']),
  filters: keys<FilterKind>(FILTER_LABELS, ['brightness', 'contrast', 'saturation', 'temperature', 'blur', 'vignette']),
  colorPresets: keys<ColorPreset>(PRESET_LABELS, ['none', 'cinematic', 'warm', 'cool', 'vibrant', 'vintage', 'bw', 'moody']),
  textAnimations: keys<TextAnimation>(TEXT_ANIMATION_LABELS, ['none', 'fade', 'pop', 'slide-up', 'typewriter', 'bounce', 'karaoke']),
  clipAnimations: pick<ClipAnimation>(ALL_CLIP_ANIMATIONS, CLIP_ANIMATION_LABELS, ['fade', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'pop']),
  audioEffects: keys<AudioEffectKind>(AUDIO_EFFECT_LABELS, ['noise-reduction', 'normalize', 'voice-enhance', 'robot', 'echo']),
  speedPresets: keys<SpeedPreset>(SPEED_PRESET_LABELS, ['montage', 'hero', 'bullet', 'jump-cut', 'flash-in', 'flash-out']),
  shapes: keys<ShapeKind>(SHAPE_LABELS, ['rect', 'rounded-rect', 'circle', 'triangle', 'star', 'arrow', 'line', 'heart', 'speech-bubble']),
  blendModes: pick<BlendMode>(ALL_BLEND_MODES, undefined, ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'difference']),
  masks: pick<MaskShape>(ALL_MASK_SHAPES, MASK_LABELS as Record<MaskShape, string>, ['rect', 'circle', 'heart', 'star', 'line', 'mirror']),
};

export const LABELS: Record<string, Record<string, string>> = {
  transitions: { ...TRANSITION_LABELS, ...FX_TRANSITION_LABELS }, effects: { ...EFFECT_LABELS, ...FX_EFFECT_LABELS },
  filters: FILTER_LABELS, colorPresets: PRESET_LABELS,
  textAnimations: TEXT_ANIMATION_LABELS, clipAnimations: { ...CLIP_ANIMATION_LABELS, ...FX_CLIP_ANIMATION_LABELS },
  audioEffects: AUDIO_EFFECT_LABELS, speedPresets: SPEED_PRESET_LABELS, shapes: SHAPE_LABELS,
  blendModes: FX_BLEND_LABELS, masks: { ...MASK_LABELS, ...FX_MASK_LABELS },
};

const TITLES: Record<keyof typeof CATALOG, string> = {
  transitions: 'Transições (transitionIn.kind)', effects: 'Efeitos visuais (effects[].kind)', filters: 'Filtros (filters[].kind)',
  colorPresets: 'Predefinições de cor (colorPreset)', textAnimations: 'Animações de texto/legenda (animation)',
  clipAnimations: 'Animações de clipe (animationIn/Out/Loop.kind)', audioEffects: 'Efeitos de áudio (audioEffects[].kind)',
  speedPresets: 'Curvas de velocidade (speedPreset)', shapes: 'Formas (shape)', masks: 'Máscaras (mask.shape)',
  blendModes: 'Modos de mesclagem (blendMode)',
};

/** looks de cor estilo DaVinci (sessão "cor"): usados em colorGrade.lut {id, intensity} */
export const COLOR_LOOKS = (BUILTIN_LOOKS ?? []).map((l) => ({ id: l.id, name: l.name }));

/** texto do catálogo vivo para o prompt (id = rótulo PT-BR, para mapear o que o usuário fala) */
export function engineCatalogForAI(): string {
  const lines = (Object.keys(CATALOG) as (keyof typeof CATALOG)[])
    .map((k) => `${TITLES[k]}: ${CATALOG[k].map((id) => (LABELS[k]?.[id] ? `${id} (${LABELS[k][id]})` : id)).join(', ')}`);
  if (MUSIC_CATALOG.length) lines.push(`Músicas livres (add_music.musicId; geradas no aparelho, sem direitos autorais): ${MUSIC_CATALOG.map((t) => `${t.id} (${t.name}; ${t.genre}, ${t.mood}, ${t.bpm} BPM)`).join(', ')}`);
  if (COLOR_LOOKS.length) lines.push(`Looks de cor (colorGrade.lut.id, intensity 0–1): ${COLOR_LOOKS.map((l) => `${l.id} (${l.name})`).join(', ')}`);
  return lines.join('\n');
}

export type { BlendMode };
