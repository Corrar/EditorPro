/* =====================================================================
   JSON Schemas de saída estruturada (Gemini `responseJsonSchema`).
   Espelham lib/types.ts e lib/ops.ts. O servidor ainda valida tudo
   (validate.ts/sanitize.ts) — o schema só guia o modelo.
   ===================================================================== */
import { ASPECTS, CAPTION_PRESETS, COLOR_PRESETS, EASINGS, FILTER_KINDS, PACINGS, TEXT_ANIMATIONS, TRANSITIONS } from './sanitize';

type S = Record<string, unknown>;

const n = (description?: string): S => ({ type: 'number', ...(description ? { description } : {}) });
const s = (description?: string): S => ({ type: 'string', ...(description ? { description } : {}) });
const b = (description?: string): S => ({ type: 'boolean', ...(description ? { description } : {}) });
const e = (values: readonly string[], description?: string): S => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const obj = (properties: Record<string, S>, required: string[] = []): S => ({ type: 'object', properties, required, additionalProperties: false });
const arr = (items: S, maxItems?: number): S => ({ type: 'array', items, ...(maxItems ? { maxItems } : {}) });

const position = obj({ x: n('0..1'), y: n('0..1 (0 = topo)') });
const transform = obj({ x: n(), y: n(), scale: n('1 = cobre o quadro; 1.1-1.2 = punch-in'), rotation: n(), opacity: n() });
const keyframe = obj({ t: n('segundos relativos ao início do clipe'), transform, easing: e(EASINGS) }, ['t', 'transform']);
const filter = obj({ kind: e(FILTER_KINDS), value: n('-1..1') }, ['kind', 'value']);
const transition = obj({ kind: e(TRANSITIONS), duration: n('0.2-0.8 s') }, ['kind', 'duration']);
const textStyle = {
  fontFamily: s(), fontSize: n('px relativos a 1920 de altura (60-110 típico)'), fontWeight: n(), color: s('hex'),
  highlightColor: s('hex'), strokeColor: s('hex'), strokeWidth: n(), background: s("cor da caixa ou ''"),
  shadow: b(), uppercase: b(), align: e(['left', 'center', 'right']),
};
const captionStyle = obj({
  ...textStyle, preset: e(CAPTION_PRESETS), position, animation: e(TEXT_ANIMATIONS), maxWords: n('1-3 = estilo TikTok'),
});

const clip = obj(
  {
    type: e(['video', 'image', 'audio', 'text']),
    id: s('opcional'), assetId: s('obrigatório p/ video/image/audio'),
    start: n('início na timeline (s)'), duration: n('duração na timeline (s)'), in: n('ponto de entrada na mídia (s)'),
    speed: n(), volume: n('0..2'), label: s(),
    text: s('p/ type=text'), style: obj(textStyle), position, animation: e(TEXT_ANIMATIONS),
    transform, keyframes: arr(keyframe, 32), filters: arr(filter, 9), colorPreset: e(COLOR_PRESETS), transitionIn: transition,
    fadeIn: n(), fadeOut: n(), duckUnderVoice: b(),
  },
  ['type', 'start'],
);

const clipPatch = obj({
  start: n(), duration: n(), in: n(), speed: n(), volume: n(), muted: b(), label: s(),
  text: s(), style: obj(textStyle), position, animation: e(TEXT_ANIMATIONS),
  transform, keyframes: arr(keyframe, 32), filters: arr(filter, 9), colorPreset: e(COLOR_PRESETS), transitionIn: transition,
  fadeIn: n(), fadeOut: n(), duckUnderVoice: b(),
});

const word = obj({ start: n(), end: n(), text: s() }, ['start', 'end', 'text']);
const segment = obj({ start: n(), end: n(), text: s(), words: arr(word), emphasis: arr(s()) }, ['start', 'end', 'text']);

const explain = s('frase curta em PT-BR mostrada ao usuário enquanto aplica');
const opVariant = (op: string, props: Record<string, S>, required: string[]): S =>
  obj({ op: e([op]), explain, ...props }, ['op', 'explain', ...required]);

export const EDIT_SCHEMA: S = obj(
  {
    reply: s('resposta curta em PT-BR para o chat'),
    ops: arr(
      {
        anyOf: [
          opVariant('ripple_delete', { start: n(), end: n() }, ['start', 'end']),
          opVariant('split_clip', { clipId: s(), at: n(), newId: s() }, ['clipId', 'at']),
          opVariant('trim_clip', { clipId: s(), start: n(), end: n() }, ['clipId']),
          opVariant('remove_clip', { clipId: s(), ripple: b() }, ['clipId']),
          opVariant('move_clip', { clipId: s(), start: n(), trackId: s() }, ['clipId', 'start']),
          opVariant('update_clip', { clipId: s(), patch: clipPatch }, ['clipId', 'patch']),
          opVariant('add_clip', { trackId: s(), clip }, ['trackId', 'clip']),
          opVariant('set_caption_style', { style: captionStyle }, ['style']),
          opVariant('toggle_captions', { enabled: b() }, ['enabled']),
          opVariant('update_caption', { segmentId: s(), patch: obj({ start: n(), end: n(), text: s(), emphasis: arr(s()) }) }, ['segmentId', 'patch']),
          opVariant('set_captions', { segments: arr(segment), language: s() }, ['segments']),
          opVariant('set_aspect', { aspect: e(ASPECTS) }, ['aspect']),
          opVariant('add_track', { track: obj({ id: s(), kind: e(['video', 'audio', 'text']), name: s() }, ['kind']), index: n() }, ['track']),
          opVariant('update_track', { trackId: s(), patch: obj({ name: s(), muted: b(), hidden: b(), locked: b() }) }, ['trackId', 'patch']),
          opVariant('remove_track', { trackId: s() }, ['trackId']),
          opVariant('set_project', { patch: obj({ name: s(), background: s() }) }, ['patch']),
        ],
      },
      60,
    ),
  },
  ['reply', 'ops'],
);

export const STYLE_SCHEMA: S = obj(
  {
    summary: s('descrição do estilo em PT-BR, 1-3 frases'),
    pacing: e(PACINGS),
    avgShotLength: n('duração média de cada tomada em segundos'),
    aspect: e(ASPECTS),
    transitions: arr(e(TRANSITIONS), 6),
    colorPreset: e(COLOR_PRESETS),
    zoomPunchIns: b('há zooms rápidos/punch-ins em frases-chave?'),
    captions: obj({ present: b(), ...textStyle, preset: e(CAPTION_PRESETS), position, animation: e(TEXT_ANIMATIONS), maxWords: n() }, ['present']),
    music: obj({ present: b(), energy: e(['low', 'medium', 'high']), genre: s() }, ['present', 'energy']),
    textOverlays: obj({ present: b(), examples: arr(s(), 8) }, ['present']),
    hook: s('como o vídeo prende nos 3 primeiros segundos'),
    structure: arr(s(), 10),
  },
  ['summary', 'pacing', 'avgShotLength', 'transitions', 'zoomPunchIns'],
);

export const TRANSCRIPT_SCHEMA: S = obj(
  {
    language: s(),
    segments: arr(segment),
  },
  ['segments'],
);
