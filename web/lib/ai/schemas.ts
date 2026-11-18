/* =====================================================================
   Schemas (zod) de saída estruturada do Claude (`output_config.format`).
   São PERMISSIVOS de propósito (op como enum + campos opcionais): guiam o
   modelo; a validação real é validate.ts/sanitize.ts.
   ===================================================================== */
import { z } from 'zod';
import {
  ASPECTS, AUDIO_EFFECTS, BLEND_MODES, CAPTION_PRESETS, CLIP_ANIMATIONS, COLOR_PRESETS, EASINGS, EFFECT_KINDS, FILTER_KINDS, FIT_MODES,
  MARKER_KINDS, MASK_SHAPES, PACINGS, SHAPE_KINDS, SPEED_PRESETS, TEXT_ANIMATIONS, TRANSITIONS,
} from './sanitize';
import { CLIP_TYPES, TRACK_KINDS } from './validate';
import { OP_KINDS } from './validate';

const position = z.object({ x: z.number(), y: z.number() });
const transform = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional().describe('1 = cobre o quadro; 1.1-1.2 = punch-in'),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
});
const keyframe = z.object({ t: z.number().describe('segundos desde o início do clipe'), transform, easing: z.enum(EASINGS).optional() });
const filter = z.object({ kind: z.enum(FILTER_KINDS), value: z.number() });
const transition = z.object({ kind: z.enum(TRANSITIONS), duration: z.number() });
const textStyleShape = {
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  color: z.string().optional(),
  highlightColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  background: z.string().optional(),
  shadow: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  gradient: z.object({ from: z.string(), to: z.string(), angle: z.number() }).optional(),
  backgroundRadius: z.number().optional(),
  opacity: z.number().optional(),
};
const textStyle = z.object(textStyleShape);
const captionStyle = z.object({
  ...textStyleShape,
  preset: z.enum(CAPTION_PRESETS).optional(),
  position: position.optional(),
  animation: z.enum(TEXT_ANIMATIONS).optional(),
  maxWords: z.number().optional(),
});

const effect = z.object({ kind: z.enum(EFFECT_KINDS), intensity: z.number().describe('0..1'), speed: z.number().optional() });
const audioEffect = z.object({ kind: z.enum(AUDIO_EFFECTS), amount: z.number().describe('0..1') });
const clipAnim = z.object({ kind: z.enum(CLIP_ANIMATIONS), duration: z.number() });
const mask = z.object({ shape: z.enum(MASK_SHAPES), x: z.number(), y: z.number(), w: z.number(), h: z.number(), rotation: z.number(), feather: z.number(), invert: z.boolean().optional() });

/** campos de clipe (para add_clip.clip e update_clip.patch) */
const clipFields = {
  // estilo CapCut
  fit: z.enum(FIT_MODES).optional(),
  crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  blendMode: z.enum(BLEND_MODES).optional(),
  mask: mask.nullable().optional(),
  chromaKey: z.object({ color: z.string(), similarity: z.number(), smoothness: z.number() }).nullable().optional(),
  effects: z.array(effect).optional(),
  removeBackground: z.boolean().optional(),
  animationIn: clipAnim.nullable().optional(),
  animationOut: clipAnim.nullable().optional(),
  animationLoop: clipAnim.nullable().optional(),
  audioEffects: z.array(audioEffect).optional(),
  pitch: z.number().optional(),
  reverse: z.boolean().optional(),
  speedCurve: z.array(z.object({ t: z.number(), speed: z.number() })).nullable().optional(),
  speedPreset: z.enum(SPEED_PRESETS).nullable().optional(),
  emoji: z.string().optional(),
  shape: z.enum(SHAPE_KINDS).optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  rotation: z.number().optional(),
  scale: z.number().optional(),
  templateId: z.string().optional(),
  start: z.number().optional(),
  duration: z.number().optional(),
  in: z.number().optional(),
  speed: z.number().optional(),
  volume: z.number().optional(),
  muted: z.boolean().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  style: textStyle.optional(),
  position: position.optional(),
  animation: z.enum(TEXT_ANIMATIONS).optional(),
  transform: transform.optional(),
  keyframes: z.array(keyframe).optional(),
  filters: z.array(filter).optional(),
  colorPreset: z.enum(COLOR_PRESETS).optional(),
  transitionIn: transition.nullable().optional(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  duckUnderVoice: z.boolean().optional(),
};

const word = z.object({ start: z.number(), end: z.number(), text: z.string() });
const segment = z.object({ start: z.number(), end: z.number(), text: z.string(), words: z.array(word).optional() });

export const EditOpSchema = z.object({
  op: z.enum(OP_KINDS as [string, ...string[]]),
  explain: z.string().describe('frase curta em PT-BR mostrada ao usuário enquanto aplica'),
  clipId: z.string().optional(),
  trackId: z.string().optional(),
  segmentId: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  at: z.number().optional(),
  newId: z.string().optional(),
  ripple: z.boolean().optional(),
  enabled: z.boolean().optional(),
  aspect: z.enum(ASPECTS).optional(),
  language: z.string().optional(),
  index: z.number().optional(),
  fromWordId: z.string().optional(),
  toWordId: z.string().optional(),
  padding: z.number().optional(),
  markerId: z.string().optional(),
  marker: z.object({ id: z.string().optional(), t: z.number(), end: z.number().optional(), label: z.string().optional(), color: z.string().optional(), kind: z.enum(MARKER_KINDS).optional(), resolved: z.boolean().optional() }).optional(),
  clip: z.object({ type: z.enum(CLIP_TYPES), id: z.string().optional(), assetId: z.string().optional(), ...clipFields }).optional(),
  patch: z.object({
    ...clipFields, name: z.string().optional(), hidden: z.boolean().optional(), locked: z.boolean().optional(), background: z.string().optional(),
    emphasis: z.array(z.string()).optional(), t: z.number().optional(), end: z.number().optional(), resolved: z.boolean().optional(),
    canvas: z.object({ type: z.enum(['color', 'blur', 'image']), color: z.string().optional(), blur: z.number().optional(), assetId: z.string().optional() }).optional(),
  }).optional(),
  style: captionStyle.optional(),
  segments: z.array(segment).optional(),
  track: z.object({ id: z.string().optional(), kind: z.enum(TRACK_KINDS as [string, ...string[]]), name: z.string().optional() }).optional(),
});

export const EditResponseSchema = z.object({
  reply: z.string().describe('resposta curta em PT-BR para o chat'),
  ops: z.array(EditOpSchema),
  /** só ao aplicar comentários de revisão: uma resposta curta por comentário */
  comments: z.array(z.object({ markerId: z.string(), reply: z.string() })).optional(),
});

export const TranslateSchema = z.object({
  segments: z.array(z.object({ id: z.string(), text: z.string() })),
});

export const StyleSchema = z.object({
  summary: z.string(),
  pacing: z.enum(PACINGS),
  avgShotLength: z.number(),
  aspect: z.enum(ASPECTS).optional(),
  transitions: z.array(z.enum(TRANSITIONS)),
  colorPreset: z.enum(COLOR_PRESETS).optional(),
  zoomPunchIns: z.boolean(),
  captions: captionStyle.extend({ present: z.boolean() }).optional(),
  music: z.object({ present: z.boolean(), energy: z.enum(['low', 'medium', 'high']), genre: z.string().optional() }).optional(),
  textOverlays: z.object({ present: z.boolean(), examples: z.array(z.string()).optional() }).optional(),
  hook: z.string().optional(),
  structure: z.array(z.string()).optional(),
});
