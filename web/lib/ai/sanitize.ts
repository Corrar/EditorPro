/* =====================================================================
   Sanitização de valores vindos da IA (JSON não confiável).
   Puro, sem dependências de navegador/servidor — testado em vitest.
   ===================================================================== */
import { fontDef } from '../library/fonts';
import type {
  AspectRatio, AudioEffect, AudioEffectKind, BlendMode, CaptionPreset, CaptionSegment, CaptionStyle, CaptionWord, ChromaKey,
  ClipAnimation, ColorPreset, Crop, Easing, Filter, FilterKind, FitMode, Keyframe, Mask, MaskShape, ShapeKind, SpeedPoint,
  SpeedPreset, StyleProfile, TextAnimation, TextStyle, Transform, Transition, TransitionKind, VisualEffect, VisualEffectKind,
  ColorGrade, ColorWheel, CurvePoint, HslBand, MaskKeyframe, MotionMode, ReferenceTemplate, ShotMotion, StyleMotion,
} from '../types';
import { uid } from '../util';
// listas derivadas dos catálogos dos donos (engine/biblioteca) — ver catalogs.ts
import { CATALOG } from './catalogs';

export const ASPECTS: AspectRatio[] = ['9:16', '16:9', '1:1', '4:5'];
export const COLOR_PRESETS: ColorPreset[] = CATALOG.colorPresets;
export const TRANSITIONS: TransitionKind[] = CATALOG.transitions;
export const FILTER_KINDS: FilterKind[] = CATALOG.filters;
export const TEXT_ANIMATIONS: TextAnimation[] = CATALOG.textAnimations;
export const EFFECT_KINDS: VisualEffectKind[] = CATALOG.effects;
export const BLEND_MODES: BlendMode[] = CATALOG.blendModes;
export const MASK_SHAPES: MaskShape[] = CATALOG.masks;
export const FIT_MODES: FitMode[] = ['cover', 'contain', 'fill'];
export const SPEED_PRESETS: SpeedPreset[] = CATALOG.speedPresets;
export const AUDIO_EFFECTS: AudioEffectKind[] = CATALOG.audioEffects;
export const CLIP_ANIMATIONS: ClipAnimation[] = CATALOG.clipAnimations;
export const SHAPE_KINDS: ShapeKind[] = CATALOG.shapes;
export const MARKER_KINDS = ['user', 'beat', 'chapter', 'comment'] as const;
export const CAPTION_PRESETS: CaptionPreset[] = ['classic', 'bold-pop', 'karaoke', 'minimal', 'boxed', 'neon'];
export const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export const PACINGS: StyleProfile['pacing'][] = ['slow', 'medium', 'fast', 'very-fast'];

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** número finito (aceita string numérica) ou undefined */
export function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

export function clampNum(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.min(max, Math.max(min, n));
}

/** arredonda tempo para milissegundos (evita lixo de ponto flutuante) */
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function str(v: unknown, max = 500): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

export function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent)$/i;
const NAMED: Record<string, string> = {
  branco: '#FFFFFF', branca: '#FFFFFF', white: '#FFFFFF', preto: '#000000', preta: '#000000', black: '#000000',
  amarelo: '#FFD23F', amarela: '#FFD23F', yellow: '#FFD23F', vermelho: '#FF3B30', vermelha: '#FF3B30', red: '#FF3B30',
  verde: '#2ED573', green: '#2ED573', azul: '#3B82F6', blue: '#3B82F6', rosa: '#FF4FA3', pink: '#FF4FA3',
  laranja: '#D9641E', orange: '#D9641E', roxo: '#8B5CF6', roxa: '#8B5CF6', purple: '#8B5CF6', ciano: '#22D3EE', cyan: '#22D3EE',
  dourado: '#F5C542', dourada: '#F5C542', gold: '#F5C542',
};

export function color(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s === '') return '';
  if (COLOR_RE.test(s)) return s;
  return NAMED[s.toLowerCase()];
}

export function sanitizeTransform(v: unknown, base?: Transform): Partial<Transform> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<Transform> = {};
  const x = clampNum(v.x, -2, 2); if (x !== undefined) out.x = x;
  const y = clampNum(v.y, -2, 2); if (y !== undefined) out.y = y;
  const scale = clampNum(v.scale, 0.1, 5); if (scale !== undefined) out.scale = scale;
  const rotation = clampNum(v.rotation, -360, 360); if (rotation !== undefined) out.rotation = rotation;
  const opacity = clampNum(v.opacity, 0, 1); if (opacity !== undefined) out.opacity = opacity;
  if (!Object.keys(out).length) return undefined;
  return base ? { ...base, ...out } : out;
}

/* ---------- keyframes universais (Keyframe.props) ---------- */
const PROP_PATH = /^[a-zA-Z][a-zA-Z0-9]{0,30}(\.[a-zA-Z0-9]{1,30}){0,3}$/;
const FORBIDDEN_SEG = new Set(['__proto__', 'prototype', 'constructor', 'id', 'type', 'assetId', 'start', 'duration', 'in', 'code', 'svg', 'keyframes']);

/**
 * props de keyframe: caminho simples ('volume', 'style.color', 'effects.0.intensity') -> número ou cor '#RRGGBB'.
 * Aceita objeto {path: valor} ou lista [{path, value}] (formato do schema). Até 16 por keyframe.
 */
export function sanitizeKeyframeProps(v: unknown): Record<string, number | string> | undefined {
  const pairs: [string, unknown][] = Array.isArray(v)
    ? v.filter(isObj).map((x) => [String(x.path ?? ''), x.value])
    : isObj(v) ? Object.entries(v) : [];
  const out: Record<string, number | string> = {};
  for (const [path, val] of pairs.slice(0, 16)) {
    if (!PROP_PATH.test(path) || path.split('.').some((seg) => FORBIDDEN_SEG.has(seg))) continue;
    if (typeof val === 'number' && Number.isFinite(val)) out[path] = r3(Math.max(-1e5, Math.min(1e5, val)));
    else { const c = color(val); if (c) out[path] = c; }
  }
  return Object.keys(out).length ? out : undefined;
}

/* ---------- efeitos/transições escritos pela IA (GLSL) ---------- */
export const MAX_SHADER_CHARS = 16 * 1024; // igual ao SHADER_MAX_CHARS da fx
function shaderCode(v: unknown, entry: 'effect' | 'transition'): string | undefined {
  if (typeof v !== 'string') return undefined;
  const code = v.replace(/\r\n/g, '\n').trim();
  if (code.length < 20 || code.length > MAX_SHADER_CHARS) return undefined;
  if (!new RegExp(`vec4\\s+${entry}\\s*\\(`).test(code)) return undefined;
  return code;
}
function shaderParams(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.slice(0, 8).map((x) => clampNum(x, -1e4, 1e4)).filter((x): x is number => x !== undefined).map(r3);
  return out.length ? out : undefined;
}

export function sanitizeKeyframes(v: unknown, clipDuration: number): Keyframe[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Keyframe[] = [];
  for (const k of v) {
    if (!isObj(k)) continue;
    const t = clampNum(k.t, 0, Math.max(0, clipDuration));
    const transform = sanitizeTransform(k.transform);
    const props = sanitizeKeyframeProps(k.props);
    if (t === undefined || (!transform && !props)) continue;
    // keyframe de câmera (escala/posição/rotação) da IA sem easing: easeInOut (linear arranca e para no tranco)
    const camera = !!transform && (['scale', 'x', 'y', 'rotation'] as const).some((key) => typeof transform[key] === 'number');
    const easing = oneOf(k.easing, EASINGS) ?? (camera ? 'easeInOut' : undefined);
    out.push({ t: r3(t), transform: transform ?? {}, ...(props ? { props } : {}), ...(easing ? { easing } : {}) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, 64);
}

/** zoom mínimo de uma mudança de escala "suave" (s) e variação máxima de escala por segundo */
export const MIN_ZOOM_RAMP = 0.6;
/** 0,14/s com easing cúbico (pico 3× a média) = ~7,5 px/quadro de borda a 30 fps em 1080 */
export const MAX_SMOOTH_SCALE_RATE = 0.14;

/**
 * Suaviza o movimento de câmera da IA (quando o modelo/pedido NÃO é zoom em pancada):
 * trechos de escala com |Δscale|/Δt > MAX_SMOOTH_SCALE_RATE ou mais curtos que 0,4 s são esticados
 * (o keyframe de chegada vai para frente, sem passar do fim do clipe nem do próximo keyframe de escala)
 * e ganham easeInOut. Puro; não mexe em props.
 */
export function smoothKeyframes(kfs: Keyframe[], clipDuration: number): Keyframe[] {
  const out = kfs.map((k) => ({ ...k, transform: { ...k.transform } })).sort((a, b) => a.t - b.t);
  const idx = out.map((k, i) => (typeof k.transform.scale === 'number' ? i : -1)).filter((i) => i >= 0);
  for (let j = 1; j < idx.length; j++) {
    const a = out[idx[j - 1]], c = out[idx[j]];
    const ds = Math.abs((c.transform.scale as number) - (a.transform.scale as number));
    if (ds < 1e-4) continue;
    const span = c.t - a.t;
    const need = Math.max(0.4, MIN_ZOOM_RAMP * Math.min(1, ds / 0.06), ds / MAX_SMOOTH_SCALE_RATE);
    if (span >= need - 1e-6) { c.easing ??= 'easeInOut'; continue; }
    const next = j + 1 < idx.length ? out[idx[j + 1]].t - 0.05 : clipDuration;
    const target = Math.min(a.t + need, next, clipDuration);
    if (target > c.t) {
      // keyframe só de escala: anda; com outras props, o trecho mantém o tempo e só ganha easing
      const onlyScale = !c.props && Object.keys(c.transform).every((key) => key === 'scale');
      if (onlyScale) c.t = r3(target);
    }
    c.easing = 'easeInOut';
  }
  return out.sort((a, b) => a.t - b.t);
}

export function sanitizeFilters(v: unknown): Filter[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<FilterKind>();
  const out: Filter[] = [];
  for (const f of v) {
    if (!isObj(f)) continue;
    const kind = oneOf(f.kind, FILTER_KINDS);
    const value = clampNum(f.value, -1, 1);
    if (!kind || value === undefined || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, value });
  }
  return out;
}

export function sanitizeTransition(v: unknown, clipDuration = Infinity): Transition | undefined {
  if (!isObj(v)) return undefined;
  if (v.kind === 'custom') {
    const code = shaderCode(v.code, 'transition');
    if (!code) return undefined;
    const maxD = Math.max(0.05, Math.min(3, clipDuration / 2));
    const easing = oneOf(v.easing, EASINGS);
    const params = shaderParams(v.params);
    const name = str(v.name, 40);
    return { kind: 'custom', duration: r3(clampNum(v.duration, 0.05, maxD) ?? Math.min(0.6, maxD)), code, ...(name ? { name } : {}), ...(params ? { params } : {}), ...(easing ? { easing } : {}) };
  }
  const kind = oneOf(v.kind, TRANSITIONS);
  if (!kind) return undefined;
  const maxD = Math.max(0.05, Math.min(1.5, clipDuration / 2));
  const duration = clampNum(v.duration, 0.05, maxD) ?? Math.min(0.4, maxD);
  const easing = oneOf(v.easing, EASINGS);
  return { kind, duration: r3(duration), ...(easing ? { easing } : {}) };
}

/** TextStyle parcial (só campos válidos) */
export function sanitizeTextStyle(v: unknown): Partial<TextStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<TextStyle> = {};
  const fontFamily = str(v.fontFamily, 60); if (fontFamily) out.fontFamily = fontDef(fontFamily)?.family ?? fontFamily;
  const fontSize = clampNum(v.fontSize, 16, 260); if (fontSize !== undefined) out.fontSize = Math.round(fontSize);
  const fontWeight = clampNum(v.fontWeight, 100, 900); if (fontWeight !== undefined) out.fontWeight = Math.round(fontWeight / 100) * 100;
  const c = color(v.color); if (c) out.color = c;
  const hc = color(v.highlightColor); if (hc !== undefined) out.highlightColor = hc;
  const sc = color(v.strokeColor); if (sc !== undefined) out.strokeColor = sc;
  const sw = clampNum(v.strokeWidth, 0, 30); if (sw !== undefined) out.strokeWidth = sw;
  const bg = color(v.background); if (bg !== undefined) out.background = bg;
  const shadow = bool(v.shadow); if (shadow !== undefined) out.shadow = shadow;
  const uppercase = bool(v.uppercase); if (uppercase !== undefined) out.uppercase = uppercase;
  const align = oneOf(v.align, ['left', 'center', 'right'] as const); if (align) out.align = align;
  const italic = bool(v.italic); if (italic !== undefined) out.italic = italic;
  const underline = bool(v.underline); if (underline !== undefined) out.underline = underline;
  const ls = clampNum(v.letterSpacing, -10, 60); if (ls !== undefined) out.letterSpacing = ls;
  const lh = clampNum(v.lineHeight, 0.7, 3); if (lh !== undefined) out.lineHeight = lh;
  const br = clampNum(v.backgroundRadius, 0, 80); if (br !== undefined) out.backgroundRadius = br;
  const op = clampNum(v.opacity, 0, 1); if (op !== undefined) out.opacity = op;
  const shc = color(v.shadowColor); if (shc !== undefined) out.shadowColor = shc;
  const shb = clampNum(v.shadowBlur, 0, 120); if (shb !== undefined) out.shadowBlur = shb;
  if (isObj(v.shadowOffset)) out.shadowOffset = { x: clampNum(v.shadowOffset.x, -80, 80) ?? 0, y: clampNum(v.shadowOffset.y, -80, 80) ?? 0 };
  const bp = clampNum(v.backgroundPadding, 0, 120); if (bp !== undefined) out.backgroundPadding = bp;
  if (isObj(v.glow)) {
    const gc = color(v.glow.color);
    if (gc) out.glow = { color: gc, blur: clampNum(v.glow.blur, 0, 120) ?? 24 };
  } else if (v.glow === null) out.glow = undefined;
  if (isObj(v.gradient)) {
    const from = color(v.gradient.from); const to = color(v.gradient.to);
    if (from && to) out.gradient = { from, to, angle: clampNum(v.gradient.angle, -360, 360) ?? 90 };
  } else if (v.gradient === null) out.gradient = undefined;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizePosition(v: unknown, base?: { x: number; y: number }): { x: number; y: number } | undefined {
  if (!isObj(v)) return undefined;
  const x = clampNum(v.x, 0, 1);
  const y = clampNum(v.y, 0, 1);
  if (x === undefined && y === undefined) return undefined;
  return { x: x ?? base?.x ?? 0.5, y: y ?? base?.y ?? 0.5 };
}

export function sanitizeCaptionStyle(v: unknown, base?: CaptionStyle): Partial<CaptionStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<CaptionStyle> = { ...(sanitizeTextStyle(v) ?? {}) };
  const preset = oneOf(v.preset, CAPTION_PRESETS); if (preset) out.preset = preset;
  const position = sanitizePosition(v.position, base?.position); if (position) out.position = position;
  const animation = oneOf(v.animation, TEXT_ANIMATIONS); if (animation) out.animation = animation;
  const maxWords = clampNum(v.maxWords, 1, 12); if (maxWords !== undefined) out.maxWords = Math.round(maxWords);
  if (isObj(v.wordBox)) {
    const wc = color(v.wordBox.color);
    if (wc) out.wordBox = { color: wc, radius: clampNum(v.wordBox.radius, 0, 60) ?? 12, padding: clampNum(v.wordBox.padding, 0, 60) ?? 10 };
  } else if (v.wordBox === null) out.wordBox = undefined;
  const as = clampNum(v.activeScale, 0.5, 2); if (as !== undefined) out.activeScale = as;
  const io = clampNum(v.inactiveOpacity, 0, 1); if (io !== undefined) out.inactiveOpacity = io;
  const ae = bool(v.autoEmoji); if (ae !== undefined) out.autoEmoji = ae;
  const lines = clampNum(v.lines, 1, 2); if (lines !== undefined) out.lines = Math.round(lines) as 1 | 2;
  const jit = clampNum(v.jitter, 0, 15); if (jit !== undefined) out.jitter = jit;
  return Object.keys(out).length ? out : undefined;
}

/** perfil de estilo do vídeo-exemplo, sempre completo e válido */
export function sanitizeStyleProfile(v: unknown): StyleProfile | undefined {
  if (!isObj(v)) return undefined;
  const avg = clampNum(v.avgShotLength, 0.2, 60) ?? 3;
  const pacing = oneOf(v.pacing, PACINGS) ?? (avg < 1.2 ? 'very-fast' : avg < 2.5 ? 'fast' : avg < 5 ? 'medium' : 'slow');
  const transitions = Array.isArray(v.transitions)
    ? [...new Set(v.transitions.map((t) => oneOf(t, TRANSITIONS)).filter((t): t is TransitionKind => !!t))]
    : [];
  const out: StyleProfile = {
    summary: str(v.summary, 600) ?? 'Estilo do vídeo-exemplo',
    pacing,
    avgShotLength: r3(avg),
    transitions: transitions.length ? transitions : ['cut'],
    zoomPunchIns: bool(v.zoomPunchIns) ?? false,
  };
  const aspect = oneOf(v.aspect, ASPECTS); if (aspect) out.aspect = aspect;
  const cp = oneOf(v.colorPreset, COLOR_PRESETS); if (cp) out.colorPreset = cp;
  if (isObj(v.captions)) {
    const present = bool(v.captions.present) ?? false;
    out.captions = { present, ...(sanitizeCaptionStyle(v.captions) ?? {}) };
  }
  if (isObj(v.music)) {
    out.music = {
      present: bool(v.music.present) ?? false,
      energy: oneOf(v.music.energy, ['low', 'medium', 'high'] as const) ?? 'medium',
      ...(str(v.music.genre, 60) ? { genre: str(v.music.genre, 60) } : {}),
    };
  }
  if (isObj(v.textOverlays)) {
    const examples = Array.isArray(v.textOverlays.examples)
      ? v.textOverlays.examples.map((e) => str(e, 80)).filter((e): e is string => !!e).slice(0, 8)
      : undefined;
    out.textOverlays = { present: bool(v.textOverlays.present) ?? false, ...(examples?.length ? { examples } : {}) };
  }
  const hook = str(v.hook, 300); if (hook) out.hook = hook;
  if (Array.isArray(v.structure)) {
    const s = v.structure.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 10);
    if (s.length) out.structure = s;
  }
  const motion = sanitizeStyleMotion(v.motion); if (motion) out.motion = motion;
  const template = sanitizeTemplate(v.template); if (template) out.template = template;
  return out;
}

export const MOTION_MODES: MotionMode[] = ['static', 'smooth-push', 'push-pull', 'punch', 'pan', 'handheld', 'mixed'];

export function sanitizeStyleMotion(v: unknown): StyleMotion | undefined {
  if (!isObj(v)) return undefined;
  const kind = oneOf(v.kind, MOTION_MODES);
  if (!kind) return undefined;
  const out: StyleMotion = { kind };
  const z = clampNum(v.zoomPerShot, 0.7, 1.6); if (z !== undefined) out.zoomPerShot = r3(z);
  const e = oneOf(v.easing, EASINGS); if (e) out.easing = e;
  const pr = clampNum(v.punchRate, 0, 600); if (pr !== undefined) out.punchRate = r3(pr);
  return out;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === 'string' && HEX6.test(v) ? v.toUpperCase() : undefined);
const unit = (v: unknown) => clampNum(v, 0, 1);

/** molde medido do vídeo modelo: tudo limitado (listas, faixas, cores) */
export function sanitizeTemplate(v: unknown): ReferenceTemplate | undefined {
  if (!isObj(v) || !isObj(v.motion) || !isObj(v.color)) return undefined;
  const shots = (Array.isArray(v.shots) ? v.shots : []).filter(isObj).slice(0, 400)
    .map((s) => ({ start: clampNum(s.start, 0, 36000), end: clampNum(s.end, 0, 36000) }))
    .filter((s): s is { start: number; end: number } => s.start !== undefined && s.end !== undefined && s.end > s.start)
    .map((s) => ({ start: r3(s.start), end: r3(s.end) }));
  if (!shots.length) return undefined;
  const st = isObj(v.shotStats) ? v.shotStats : {};
  const durs = shots.map((s) => s.end - s.start).sort((a, b) => a - b);
  const q = (f: number) => durs[Math.min(durs.length - 1, Math.floor(f * durs.length))];
  const shotStats = {
    median: r3(clampNum(st.median, 0.05, 600) ?? q(0.5)),
    p10: r3(clampNum(st.p10, 0.05, 600) ?? q(0.1)),
    p90: r3(clampNum(st.p90, 0.05, 600) ?? q(0.9)),
  };
  const m = v.motion;
  const perShot: ShotMotion[] = (Array.isArray(m.perShot) ? m.perShot : []).filter(isObj).slice(0, 400).flatMap((s) => {
    const start = clampNum(s.start, 0, 36000), end = clampNum(s.end, 0, 36000);
    if (start === undefined || end === undefined || end <= start) return [];
    return [{
      start: r3(start), end: r3(end),
      zoomTotal: r3(clampNum(s.zoomTotal, 0.5, 2) ?? 1),
      panX: r3(clampNum(s.panX, -1, 1) ?? 0),
      panY: r3(clampNum(s.panY, -1, 1) ?? 0),
      peakOverMean: r3(clampNum(s.peakOverMean, 0, 100) ?? 1),
      easing: oneOf(s.easing, EASINGS) ?? 'easeInOut',
      punches: Math.round(clampNum(s.punches, 0, 100) ?? 0),
    }];
  });
  const motion: ReferenceTemplate['motion'] = {
    mode: oneOf(m.mode, MOTION_MODES) ?? 'static',
    avgZoomPerShot: r3(clampNum(m.avgZoomPerShot, 0.7, 1.6) ?? 1),
    easing: oneOf(m.easing, EASINGS) ?? 'easeInOut',
    perShot,
  };
  const dir = oneOf(m.direction, ['in', 'out', 'alternate'] as const); if (dir) motion.direction = dir;
  const pf = unit(m.punchFrequency); if (pf !== undefined) motion.punchFrequency = r3(pf);
  const transitions = (Array.isArray(v.transitions) ? v.transitions : []).filter(isObj).slice(0, 12).flatMap((t) => {
    const kind = oneOf(t.kind, TRANSITIONS);
    return kind ? [{ kind, duration: r3(clampNum(t.duration, 0, 3) ?? 0), frequency: r3(unit(t.frequency) ?? 0) }] : [];
  });
  const c = v.color;
  const color: ReferenceTemplate['color'] = {
    r: r3(unit(c.r) ?? 0.5), g: r3(unit(c.g) ?? 0.5), b: r3(unit(c.b) ?? 0.5), sat: r3(unit(c.sat) ?? 0.3), lum: r3(unit(c.lum) ?? 0.5),
  };
  const sd = unit(c.lumSd); if (sd !== undefined) color.lumSd = r3(sd);
  if (Array.isArray(c.hist16) && c.hist16.length === 3) {
    const h = c.hist16.map((ch) => (Array.isArray(ch) ? ch.slice(0, 16).map((x) => r3(unit(x) ?? 0)) : []));
    if (h.every((ch) => ch.length === 16)) color.hist16 = h;
  }
  const out: ReferenceTemplate = { shots, shotStats, motion, transitions: transitions.length ? transitions : [{ kind: 'cut', duration: 0, frequency: 1 }], color };
  if (isObj(v.captions) && isObj(v.captions.region)) {
    const y0 = unit(v.captions.region.y0), y1 = unit(v.captions.region.y1);
    const textColor = hex(v.captions.textColor);
    if (y0 !== undefined && y1 !== undefined && y1 > y0 && textColor) {
      const cap: NonNullable<ReferenceTemplate['captions']> = {
        region: { y0: r3(y0), y1: r3(y1) },
        textColor,
        boxColor: hex(v.captions.boxColor) ?? null,
        heightPx1920: Math.round(clampNum(v.captions.heightPx1920, 10, 600) ?? 80),
      };
      const up = bool(v.captions.uppercase); if (up !== undefined) cap.uppercase = up;
      const w = clampNum(v.captions.wordsPerChunk, 1, 12); if (w !== undefined) cap.wordsPerChunk = Math.round(w);
      out.captions = cap;
    }
  }
  const cob = unit(v.cutsOnBeats); if (cob !== undefined) out.cutsOnBeats = r3(cob);
  return out;
}

/* ---------- transcrição ---------- */

export interface TranscriptOptions {
  /** duração da mídia (limite superior dos tempos) */
  duration: number;
  /** segmento mais longo permitido (divide acima disso) */
  maxSegment?: number;
  maxWordsPerSegment?: number;
}

/** "1:02.5" | "62.5" | 62.5 -> 62.5 */
export function parseTime(v: unknown): number | undefined {
  const n = num(v);
  if (n !== undefined) return n;
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)$/);
  if (!m) return undefined;
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3].replace(',', '.'));
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

/** distribui palavras uniformemente (ponderadas pelo tamanho) dentro de [start,end] */
export function distributeWords(text: string, start: number, end: number): CaptionWord[] {
  const words = splitWords(text);
  if (!words.length || end <= start) return [];
  const weights = words.map((w) => Math.max(2, w.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return words.map((w, i) => {
    const d = ((end - start) * weights[i]) / total;
    const word = { start: r3(t), end: r3(i === words.length - 1 ? end : t + d), text: w };
    t += d;
    return word;
  });
}

/**
 * valida a transcrição vinda da IA: converte tempos, ordena, prende ao intervalo da mídia,
 * garante palavras dentro do segmento (sintetiza se faltarem) e divide segmentos longos.
 * Tempos continuam NA MÍDIA (conversão p/ timeline é em timemap.ts).
 */
export function sanitizeTranscript(raw: unknown, opts: TranscriptOptions): CaptionSegment[] {
  const list = isObj(raw) && Array.isArray(raw.segments) ? raw.segments : Array.isArray(raw) ? raw : [];
  const D = Math.max(0, opts.duration || 0) || Infinity;
  const maxSeg = opts.maxSegment ?? 8;
  const maxWords = opts.maxWordsPerSegment ?? 14;
  const segs: CaptionSegment[] = [];

  for (const s of list) {
    if (!isObj(s)) continue;
    let text = str(s.text, 400);
    let start = parseTime(s.start);
    let end = parseTime(s.end);
    let words: CaptionWord[] = [];
    if (Array.isArray(s.words)) {
      for (const w of s.words) {
        if (!isObj(w)) continue;
        const wt = str(w.text, 40);
        let ws = parseTime(w.start);
        let we = parseTime(w.end);
        if (!wt || ws === undefined) continue;
        if (we === undefined || we <= ws) we = ws + 0.25;
        ws = Math.max(0, Math.min(ws, D));
        we = Math.max(0, Math.min(we, D));
        if (we - ws < 0.01) continue;
        words.push({ start: r3(ws), end: r3(we), text: wt });
      }
      words.sort((a, b) => a.start - b.start);
      // remove sobreposição entre palavras consecutivas
      for (let i = 1; i < words.length; i++) {
        if (words[i].start < words[i - 1].end) words[i - 1] = { ...words[i - 1], end: words[i].start };
      }
      words = words.filter((w) => w.end - w.start >= 0.01);
    }
    if (start === undefined && words.length) start = words[0].start;
    if (end === undefined && words.length) end = words[words.length - 1].end;
    if (!text && words.length) text = words.map((w) => w.text).join(' ');
    if (!text || start === undefined) continue;
    if (end === undefined || end <= start) end = start + Math.max(0.6, splitWords(text).length * 0.35);
    start = Math.max(0, Math.min(start, D));
    end = Math.max(0, Math.min(end, D));
    if (end - start < 0.05) continue;
    if (words.length) {
      start = Math.min(start, words[0].start);
      end = Math.max(end, words[words.length - 1].end);
      words = words.filter((w) => w.start >= start! - 1e-6 && w.end <= end! + 1e-6);
    }
    if (!words.length) words = distributeWords(text, start, end);
    const emphasis = Array.isArray(s.emphasis) ? s.emphasis.map((e) => str(e, 40)).filter((e): e is string => !!e).slice(0, 6) : undefined;
    segs.push({ id: uid('cap'), start: r3(start), end: r3(end), text, words, ...(emphasis?.length ? { emphasis } : {}) });
  }

  segs.sort((a, b) => a.start - b.start);
  // sem sobreposição entre segmentos
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start < segs[i - 1].end) {
      const prev = segs[i - 1];
      const cut = segs[i].start;
      segs[i - 1] = { ...prev, end: cut, words: prev.words?.filter((w) => w.start < cut).map((w) => ({ ...w, end: Math.min(w.end, cut) })) };
    }
  }
  const valid = segs.filter((s) => s.end - s.start >= 0.05 && (s.words?.length ?? 0) > 0);
  return valid.flatMap((s) => splitSegment(s, maxSeg, maxWords));
}

/** divide segmentos longos (em palavras) para legendas legíveis */
export function splitSegment(s: CaptionSegment, maxSeg: number, maxWords: number): CaptionSegment[] {
  const words = s.words ?? [];
  if ((s.end - s.start <= maxSeg && words.length <= maxWords) || words.length < 2) return [s];
  const out: CaptionSegment[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      id: out.length === 0 ? s.id : uid('cap'),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
      words: cur,
      ...(s.emphasis ? { emphasis: s.emphasis.filter((e) => cur.some((w) => w.text.toLowerCase().includes(e.toLowerCase()))) } : {}),
    });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || w.end - cur[0].start > maxSeg)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text) && cur.length >= 3) flush();
  }
  flush();
  return out;
}


/* ---------- campos estilo CapCut (efeitos, máscaras, áudio, velocidade) ---------- */

export function sanitizeEffects(v: unknown): VisualEffect[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: VisualEffect[] = [];
  const seen = new Set<VisualEffectKind>();
  for (const e of v) {
    if (!isObj(e)) continue;
    if (e.kind === 'custom') {
      // efeito inventado pela IA (GLSL); vários permitidos, cada um com seu código
      const code = shaderCode(e.code, 'effect');
      if (!code) continue;
      const params = shaderParams(e.params);
      const name = str(e.name, 40);
      const c = color(e.color);
      const speed = clampNum(e.speed, 0, 2);
      out.push({ kind: 'custom', intensity: clampNum(e.intensity, 0, 1) ?? 1, code, ...(name ? { name } : {}), ...(params ? { params } : {}), ...(c ? { color: c } : {}), ...(speed !== undefined ? { speed } : {}) });
      continue;
    }
    const kind = oneOf(e.kind, EFFECT_KINDS);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    const speed = clampNum(e.speed, 0, 2);
    const c = color(e.color);
    const angle = clampNum(e.angle, -360, 360);
    out.push({
      kind, intensity: clampNum(e.intensity, 0, 1) ?? 0.6,
      ...(speed !== undefined ? { speed } : {}), ...(c ? { color: c } : {}), ...(angle !== undefined ? { angle: r3(angle) } : {}),
    });
  }
  return out.slice(0, 8);
}

export function sanitizeAudioEffects(v: unknown): AudioEffect[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: AudioEffect[] = [];
  const seen = new Set<AudioEffectKind>();
  for (const e of v) {
    if (!isObj(e)) continue;
    const kind = oneOf(e.kind, AUDIO_EFFECTS);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, amount: clampNum(e.amount, 0, 1) ?? 0.7 });
  }
  return out.slice(0, 6);
}

/** keyframes da máscara (Power Window animada): até 32, tempos crescentes, valores limitados */
function maskKeyframes(v: unknown): MaskKeyframe[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MaskKeyframe[] = [];
  for (const k of v.slice(0, 32)) {
    if (!isObj(k)) continue;
    const t = clampNum(k.t, 0, 24 * 3600);
    if (t === undefined) continue;
    const kf: MaskKeyframe = { t: r3(t) };
    for (const [key, lo, hi] of [['x', 0, 1], ['y', 0, 1], ['w', 0.02, 2], ['h', 0.02, 2], ['rotation', -360, 360], ['feather', 0, 1]] as const) {
      const x = clampNum(k[key], lo, hi); if (x !== undefined) kf[key] = r3(x);
    }
    const e = oneOf(k.easing, EASINGS); if (e) kf.easing = e;
    out.push(kf);
  }
  out.sort((a, b) => a.t - b.t);
  const dedup = out.filter((k, i) => i === 0 || k.t > out[i - 1].t);
  return dedup.length ? dedup : undefined;
}

export function sanitizeMask(v: unknown): Mask | undefined {
  if (!isObj(v)) return undefined;
  const shape = oneOf(v.shape, MASK_SHAPES);
  if (!shape) return undefined;
  return {
    shape,
    x: clampNum(v.x, 0, 1) ?? 0.5, y: clampNum(v.y, 0, 1) ?? 0.5,
    w: clampNum(v.w, 0.02, 2) ?? 0.6, h: clampNum(v.h, 0.02, 2) ?? 0.6,
    rotation: clampNum(v.rotation, -360, 360) ?? 0,
    feather: clampNum(v.feather, 0, 1) ?? 0.1,
    ...(bool(v.invert) ? { invert: true } : {}),
    ...(clampNum(v.radius, 0, 1) !== undefined ? { radius: clampNum(v.radius, 0, 1)! } : {}),
    ...(shape === 'text' && str(v.text, 60) ? { text: str(v.text, 60)! } : {}),
    ...(maskKeyframes(v.keyframes) ? { keyframes: maskKeyframes(v.keyframes)! } : {}),
  };
}

export function sanitizeChroma(v: unknown): ChromaKey | undefined {
  if (!isObj(v)) return undefined;
  return { color: color(v.color) || '#00FF00', similarity: clampNum(v.similarity, 0, 1) ?? 0.4, smoothness: clampNum(v.smoothness, 0, 1) ?? 0.1 };
}

export function sanitizeCrop(v: unknown): Crop | undefined {
  if (!isObj(v)) return undefined;
  const x = clampNum(v.x, 0, 0.95) ?? 0;
  const y = clampNum(v.y, 0, 0.95) ?? 0;
  const w = clampNum(v.w, 0.05, 1 - x) ?? 1 - x;
  const h = clampNum(v.h, 0.05, 1 - y) ?? 1 - y;
  return { x, y, w, h };
}

export function sanitizeSpeedCurve(v: unknown): SpeedPoint[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const pts = v
    .filter(isObj)
    .map((p) => ({ t: clampNum(p.t, 0, 1), speed: clampNum(p.speed, 0.1, 10) }))
    .filter((p): p is SpeedPoint => p.t !== undefined && p.speed !== undefined)
    .sort((a, b) => a.t - b.t);
  return pts.length >= 2 ? pts.slice(0, 16) : undefined;
}

export function sanitizeClipAnim(v: unknown, clipDuration: number): { kind: ClipAnimation; duration: number } | undefined {
  if (!isObj(v)) return undefined;
  const kind = oneOf(v.kind, CLIP_ANIMATIONS);
  if (!kind) return undefined;
  return { kind, duration: r3(clampNum(v.duration, 0.1, Math.max(0.1, Math.min(3, clipDuration))) ?? Math.min(0.5, clipDuration / 2)) };
}

/** campos VisualExtras (vídeo/imagem/sticker/forma); null/undefined explícito remove o campo */
export function sanitizeVisualExtras(v: Record<string, unknown>, clipDuration: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fit = oneOf(v.fit, FIT_MODES); if (fit) out.fit = fit;
  for (const k of ['flipH', 'flipV', 'removeBackground'] as const) { const b = bool(v[k]); if (b !== undefined) out[k] = b; }
  const bm = oneOf(v.blendMode, BLEND_MODES); if (bm) out.blendMode = bm;
  const parsers: [string, (x: unknown) => unknown][] = [
    ['crop', sanitizeCrop], ['mask', sanitizeMask], ['chromaKey', sanitizeChroma], ['effects', sanitizeEffects],
    ['animationIn', (x) => sanitizeClipAnim(x, clipDuration)], ['animationOut', (x) => sanitizeClipAnim(x, clipDuration)],
    ['animationLoop', (x) => sanitizeClipAnim(x, clipDuration)],
  ];
  for (const [k, fn] of parsers) {
    if (!(k in v)) continue;
    if (v[k] === null) { out[k] = undefined; continue; }
    const val = fn(v[k]);
    if (val !== undefined) out[k] = val;
  }
  return out;
}

/** campos AudioExtras (vídeo/áudio) */
export function sanitizeAudioExtras(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fx = v.audioEffects === null ? [] : sanitizeAudioEffects(v.audioEffects); if (fx) out.audioEffects = fx;
  const pitch = clampNum(v.pitch, -12, 12); if (pitch !== undefined) out.pitch = Math.round(pitch * 10) / 10;
  const rev = bool(v.reverse); if (rev !== undefined) out.reverse = rev;
  if (v.speedCurve === null) out.speedCurve = undefined;
  else { const sc = sanitizeSpeedCurve(v.speedCurve); if (sc) out.speedCurve = sc; }
  if (v.speedPreset === null) out.speedPreset = undefined;
  else { const sp = oneOf(v.speedPreset, SPEED_PRESETS); if (sp) out.speedPreset = sp; }
  return out;
}

/* ---------- correção de cor (ColorGrade, estilo DaVinci) ---------- */
const HSL_BANDS: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const n11 = (v: unknown) => clampNum(v, -1, 1);

function sanitizeWheel(v: unknown): ColorWheel | undefined {
  if (!isObj(v)) return undefined;
  const w = { r: n11(v.r) ?? 0, g: n11(v.g) ?? 0, b: n11(v.b) ?? 0, y: n11(v.y) ?? 0 };
  return w.r || w.g || w.b || w.y ? { r: r3(w.r), g: r3(w.g), b: r3(w.b), y: r3(w.y) } : undefined;
}

function sanitizeCurve(v: unknown): CurvePoint[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const pts = v.filter(isObj).map((p) => ({ x: clampNum(p.x, 0, 1), y: clampNum(p.y, 0, 1) }))
    .filter((p): p is CurvePoint => p.x !== undefined && p.y !== undefined)
    .sort((a, b) => a.x - b.x).slice(0, 16).map((p) => ({ x: r3(p.x), y: r3(p.y) }));
  return pts.length >= 2 ? pts : undefined;
}

/** ColorGrade parcial e válido (null = remover a correção). Só campos conhecidos, valores limitados. */
export function sanitizeColorGrade(v: unknown): ColorGrade | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const out: ColorGrade = {};
  for (const k of ['lift', 'gamma', 'gain', 'offset'] as const) { const w = sanitizeWheel(v[k]); if (w) out[k] = w; }
  for (const k of ['exposure', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows'] as const) {
    const x = n11(v[k]); if (x !== undefined && x !== 0) out[k] = r3(x);
  }
  const pivot = clampNum(v.pivot, 0, 1); if (pivot !== undefined) out.pivot = r3(pivot);
  const mix = clampNum(v.mix, 0, 1); if (mix !== undefined) out.mix = r3(mix);
  if (isObj(v.curves)) {
    const c: NonNullable<ColorGrade['curves']> = {};
    for (const k of ['master', 'r', 'g', 'b'] as const) { const cv = sanitizeCurve((v.curves as Record<string, unknown>)[k]); if (cv) c[k] = cv; }
    if (Object.keys(c).length) out.curves = c;
  }
  if (isObj(v.hsl)) {
    const h: NonNullable<ColorGrade['hsl']> = {};
    for (const b of HSL_BANDS) {
      const a = (v.hsl as Record<string, unknown>)[b];
      if (isObj(a)) { const adj = { hue: r3(n11(a.hue) ?? 0), sat: r3(n11(a.sat) ?? 0), lum: r3(n11(a.lum) ?? 0) }; if (adj.hue || adj.sat || adj.lum) h[b] = adj; }
    }
    if (Object.keys(h).length) out.hsl = h;
  }
  if (isObj(v.lut)) { const id = str(v.lut.id, 80); if (id && /^[\w.:-]+$/.test(id) && !id.includes('..')) out.lut = { id, intensity: clampNum(v.lut.intensity, 0, 1) ?? 1 }; }
  return Object.keys(out).length ? out : undefined;
}

/**
 * update_clip.colorGrade da IA MESCLA com a correção atual (não apaga LUT/curvas/rodas do usuário).
 * Só muda os campos enviados; 0 ou null num campo remove esse campo; null no todo é tratado por quem chama.
 */
export function mergeColorGrade(cur: ColorGrade | undefined, raw: unknown): ColorGrade | undefined {
  if (!isObj(raw)) return cur;
  const add = sanitizeColorGrade(raw) ?? {};
  const out: ColorGrade = { ...(cur ?? {}) };
  const o = out as Record<string, unknown>;
  for (const k of ['exposure', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows', 'pivot', 'mix'] as const) {
    if (raw[k] === null || raw[k] === 0) delete o[k];
    else if (add[k] !== undefined) o[k] = add[k];
  }
  for (const k of ['lift', 'gamma', 'gain', 'offset'] as const) {
    if (raw[k] === null || (isObj(raw[k]) && !add[k])) delete o[k];
    else if (add[k]) o[k] = add[k];
  }
  if (raw.lut === null) delete out.lut; else if (add.lut) out.lut = add.lut;
  if (raw.curves === null) delete out.curves;
  else if (isObj(raw.curves)) {
    const c = { ...(cur?.curves ?? {}) } as Record<string, unknown>;
    for (const k of ['master', 'r', 'g', 'b'] as const) {
      if ((raw.curves as Record<string, unknown>)[k] === null) delete c[k];
      else if (add.curves?.[k]) c[k] = add.curves[k];
    }
    if (Object.keys(c).length) out.curves = c as ColorGrade['curves']; else delete out.curves;
  }
  if (raw.hsl === null) delete out.hsl;
  else if (isObj(raw.hsl)) {
    const h = { ...(cur?.hsl ?? {}) } as Record<string, unknown>;
    for (const b of HSL_BANDS) {
      const v = (raw.hsl as Record<string, unknown>)[b];
      if (v === null || (isObj(v) && !add.hsl?.[b])) delete h[b];
      else if (add.hsl?.[b]) h[b] = add.hsl[b];
    }
    if (Object.keys(h).length) out.hsl = h as ColorGrade['hsl']; else delete out.hsl;
  }
  return Object.keys(out).length ? out : undefined;
}
