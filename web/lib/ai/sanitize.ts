/* =====================================================================
   Sanitização de valores vindos da IA (JSON não confiável).
   Puro, sem dependências de navegador/servidor — testado em vitest.
   ===================================================================== */
import type {
  AspectRatio, AudioEffect, AudioEffectKind, BlendMode, CaptionPreset, CaptionSegment, CaptionStyle, CaptionWord, ChromaKey,
  ClipAnimation, ColorPreset, Crop, Easing, Filter, FilterKind, FitMode, Keyframe, Mask, MaskShape, ShapeKind, SpeedPoint,
  SpeedPreset, StyleProfile, TextAnimation, TextStyle, Transform, Transition, TransitionKind, VisualEffect, VisualEffectKind,
} from '../types';
import { uid } from '../util';

export const ASPECTS: AspectRatio[] = ['9:16', '16:9', '1:1', '4:5'];
export const COLOR_PRESETS: ColorPreset[] = ['none', 'cinematic', 'warm', 'cool', 'vibrant', 'vintage', 'bw', 'moody'];
export const TRANSITIONS: TransitionKind[] = [
  'cut', 'fade', 'crossfade', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'whip', 'glitch', 'flash',
  'slide-down', 'dip-black', 'dip-white', 'blur', 'spin', 'wipe-left', 'wipe-right', 'wipe-up', 'circle-open', 'pixelate',
  'shake', 'rgb-split', 'film-burn',
];
export const FILTER_KINDS: FilterKind[] = [
  'brightness', 'contrast', 'saturation', 'temperature', 'blur', 'vignette', 'grain', 'bw', 'sepia',
  'exposure', 'highlights', 'shadows', 'tint', 'hue', 'sharpen', 'fade',
];
export const TEXT_ANIMATIONS: TextAnimation[] = [
  'none', 'fade', 'pop', 'slide-up', 'typewriter', 'bounce', 'karaoke',
  'slide-down', 'slide-left', 'slide-right', 'zoom', 'blur', 'wave', 'glitch', 'flicker', 'spin',
];
export const EFFECT_KINDS: VisualEffectKind[] = [
  'shake', 'glitch', 'rgb-split', 'zoom-pulse', 'vhs', 'film-grain', 'light-leak', 'pixelate', 'mirror', 'kaleidoscope',
  'blur-motion', 'flash-strobe', 'old-film', 'vignette-pulse', 'sparkle', 'soft-glow', 'neon-edge', 'black-bars',
];
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'difference'];
export const MASK_SHAPES: MaskShape[] = ['rect', 'circle', 'heart', 'star', 'line', 'mirror'];
export const FIT_MODES: FitMode[] = ['cover', 'contain', 'fill'];
export const SPEED_PRESETS: SpeedPreset[] = ['montage', 'hero', 'bullet', 'jump-cut', 'flash-in', 'flash-out'];
export const AUDIO_EFFECTS: AudioEffectKind[] = [
  'noise-reduction', 'normalize', 'voice-enhance', 'chipmunk', 'deep', 'robot', 'echo', 'reverb', 'telephone', 'megaphone', 'bass-boost',
];
export const CLIP_ANIMATIONS: ClipAnimation[] = [
  'fade', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'spin', 'bounce', 'pop', 'shake', 'swing', 'blur', 'flip',
];
export const SHAPE_KINDS: ShapeKind[] = ['rect', 'rounded-rect', 'circle', 'triangle', 'star', 'arrow', 'line', 'heart', 'speech-bubble'];
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

export function sanitizeKeyframes(v: unknown, clipDuration: number): Keyframe[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Keyframe[] = [];
  for (const k of v) {
    if (!isObj(k)) continue;
    const t = clampNum(k.t, 0, Math.max(0, clipDuration));
    const transform = sanitizeTransform(k.transform);
    if (t === undefined || !transform) continue;
    const easing = oneOf(k.easing, EASINGS);
    out.push({ t: r3(t), transform, ...(easing ? { easing } : {}) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, 64);
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
  const kind = oneOf(v.kind, TRANSITIONS);
  if (!kind) return undefined;
  const maxD = Math.max(0.05, Math.min(1.5, clipDuration / 2));
  const duration = clampNum(v.duration, 0.05, maxD) ?? Math.min(0.4, maxD);
  return { kind, duration: r3(duration) };
}

/** TextStyle parcial (só campos válidos) */
export function sanitizeTextStyle(v: unknown): Partial<TextStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<TextStyle> = {};
  const fontFamily = str(v.fontFamily, 60); if (fontFamily) out.fontFamily = fontFamily;
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
    const kind = oneOf(e.kind, EFFECT_KINDS);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    const speed = clampNum(e.speed, 0, 2);
    out.push({ kind, intensity: clampNum(e.intensity, 0, 1) ?? 0.6, ...(speed !== undefined ? { speed } : {}) });
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
