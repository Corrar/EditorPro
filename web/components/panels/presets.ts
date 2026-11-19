/* =====================================================================
   Painéis — presets e helpers puros (testados em presets.test.ts).
   ===================================================================== */
import { DEFAULT_TEXT_STYLE, makeTextClip } from '@/lib/defaults';
import type {
  CaptionPreset, CaptionStyle, ColorPreset, Filter, FilterKind, Keyframe, TextAnimation, TextClip, TransitionKind,
  VideoClip, ImageClip, AudioClip,
} from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { FILTER_LABELS, PRESET_LABELS } from '@/lib/engine/filters';
import { TEXT_ANIMATION_LABELS } from '@/lib/engine/text';
import { ALL_TRANSITIONS, TRANSITION_LABELS } from '@/lib/engine/transitions';
import { SPEED_PRESETS as ENGINE_SPEED_PRESETS, SPEED_PRESET_LABELS, curveIntegral } from '@/lib/engine/speed';
import { CLIP_ANIMATION_LABELS } from '@/lib/engine/animations';
import { EFFECT_LABELS } from '@/lib/engine/effects';
import { MASK_LABELS } from '@/lib/engine/masks';
import { SHAPE_LABELS } from '@/lib/engine/shapes';
import { AUDIO_EFFECT_LABELS } from '@/lib/engine/audioFx';
import { CAPTION_PRESET_LABELS } from '@/lib/engine/captions';

/** lista {id,label} a partir de um mapa de rótulos do engine */
const fromLabels = <K extends string>(m: Record<K, string>) => (Object.keys(m) as K[]).map((id) => ({ id, label: m[id] }));

/* ---------- fontes ---------- */
export const FONTS: { family: string; label: string }[] = [
  { family: 'Poppins', label: 'Poppins' },
  { family: 'Montserrat', label: 'Montserrat' },
  { family: 'Anton', label: 'Anton' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono' },
  { family: 'Georgia', label: 'Georgia (serifa)' },
  { family: 'Impact', label: 'Impact' },
];
export const WEIGHTS = [400, 500, 600, 700, 800, 900];

/* ---------- animações de texto ---------- */
export const TEXT_ANIMATIONS: { id: TextAnimation; label: string }[] = (['none', 'fade', 'pop', 'slide-up', 'typewriter', 'bounce', 'karaoke'] as TextAnimation[]).map((id) => ({ id, label: TEXT_ANIMATION_LABELS[id] }));

/* ---------- modelos de texto ---------- */
export interface TextTemplate { id: string; label: string; desc: string; make: (start: number) => TextClip }

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'title', label: 'Título', desc: 'Grande, no centro',
    make: (t) => makeTextClip('SEU TÍTULO AQUI', t, 3, {
      label: 'título', templateId: 'title', position: { x: 0.5, y: 0.42 }, animation: 'pop', animationOut: 'fade',
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Anton', fontSize: 132, fontWeight: 400, uppercase: true, strokeWidth: 0, shadow: true },
    }),
  },
  {
    id: 'subtitle', label: 'Subtítulo', desc: 'Linha de apoio',
    make: (t) => makeTextClip('um subtítulo que explica', t, 3, {
      label: 'subtítulo', templateId: 'subtitle', position: { x: 0.5, y: 0.52 }, animation: 'fade',
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 54, fontWeight: 500, strokeWidth: 0, shadow: true, letterSpacing: 2 },
    }),
  },
  {
    id: 'hook', label: 'Gancho', desc: 'Frase de impacto no topo',
    make: (t) => makeTextClip('Você precisa ver isso 👀', t, 2.5, {
      label: 'gancho', templateId: 'hook', position: { x: 0.5, y: 0.2 }, animation: 'bounce',
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 88, fontWeight: 900, background: '#D9641E', backgroundRadius: 18, strokeWidth: 0, shadow: false },
    }),
  },
  {
    id: 'lower-third', label: 'Lower third', desc: 'Nome + função, canto inferior',
    make: (t) => makeTextClip('Bruno Silva\nFundador', t, 4, {
      label: 'nome na tela', templateId: 'lower-third', position: { x: 0.32, y: 0.86 }, animation: 'slide-right', animationOut: 'fade',
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 52, fontWeight: 700, align: 'left', background: 'rgba(0,0,0,0.6)', backgroundRadius: 12, strokeWidth: 0, shadow: false, lineHeight: 1.25 },
    }),
  },
  {
    id: 'cta', label: 'CTA “Siga”', desc: 'Chamada para ação no fim',
    make: (t) => makeTextClip('Siga para mais dicas →', t, 3, {
      label: 'CTA', templateId: 'cta', position: { x: 0.5, y: 0.8 }, animation: 'slide-up', animationLoop: 'wave',
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 72, fontWeight: 800, color: '#1C1F22', background: '#FFFFFF', backgroundRadius: 40, strokeWidth: 0, shadow: true },
    }),
  },
  {
    id: 'counter', label: 'Contador', desc: 'Número grande (top 3, passo 1)',
    make: (t) => makeTextClip('#1', t, 2, {
      label: 'contador', templateId: 'counter', position: { x: 0.2, y: 0.18 }, animation: 'zoom',
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Anton', fontSize: 180, fontWeight: 400, gradient: { from: '#FFD23F', to: '#D9641E', angle: 90 }, strokeWidth: 0 },
    }),
  },
  {
    id: 'quote', label: 'Citação', desc: 'Frase entre aspas, itálico',
    make: (t) => makeTextClip('“A simplicidade é o último grau de sofisticação.”', t, 4, {
      label: 'citação', templateId: 'quote', position: { x: 0.5, y: 0.5 }, animation: 'typewriter',
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Georgia', fontSize: 64, fontWeight: 500, italic: true, strokeWidth: 0, shadow: true, lineHeight: 1.3 },
    }),
  },
  {
    id: 'price', label: 'Preço', desc: 'Oferta em destaque',
    make: (t) => makeTextClip('R$ 49,90', t, 3, {
      label: 'preço', templateId: 'price', position: { x: 0.5, y: 0.62 }, animation: 'pop', animationLoop: 'flicker',
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Montserrat', fontSize: 120, fontWeight: 900, color: '#1C1F22', background: '#FFD23F', backgroundRadius: 24, strokeWidth: 0 },
    }),
  },
  {
    id: 'plain', label: 'Texto simples', desc: 'Branco com contorno',
    make: (t) => makeTextClip('Digite seu texto', t, 2.5, { label: 'texto', templateId: 'plain', position: { x: 0.5, y: 0.5 }, animation: 'fade' }),
  },
];

/* ---------- presets de legenda ---------- */
export interface CaptionPresetDef { id: CaptionPreset; label: string; style: Partial<CaptionStyle> }

export const CAPTION_PRESETS: CaptionPresetDef[] = [
  { id: 'classic', label: CAPTION_PRESET_LABELS['classic'], style: { preset: 'classic', fontFamily: 'Poppins', fontWeight: 600, fontSize: 56, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 3, background: '', shadow: true, uppercase: false, animation: 'none', maxWords: 8 } },
  { id: 'bold-pop', label: CAPTION_PRESET_LABELS['bold-pop'], style: { preset: 'bold-pop', fontFamily: 'Poppins', fontWeight: 900, fontSize: 80, color: '#FFFFFF', highlightColor: '#FFD23F', strokeColor: '#000000', strokeWidth: 8, background: '', shadow: true, uppercase: true, animation: 'pop', maxWords: 3 } },
  { id: 'karaoke', label: CAPTION_PRESET_LABELS['karaoke'], style: { preset: 'karaoke', fontFamily: 'Montserrat', fontWeight: 900, fontSize: 70, color: '#FFFFFF', highlightColor: '#3BE37A', strokeColor: '#000000', strokeWidth: 6, background: '', shadow: true, uppercase: true, animation: 'karaoke', maxWords: 4 } },
  { id: 'minimal', label: CAPTION_PRESET_LABELS['minimal'], style: { preset: 'minimal', fontFamily: 'Poppins', fontWeight: 500, fontSize: 48, color: '#FFFFFF', highlightColor: '#FFFFFF', strokeColor: '#000000', strokeWidth: 0, background: '', shadow: true, uppercase: false, animation: 'fade', maxWords: 6 } },
  { id: 'boxed', label: CAPTION_PRESET_LABELS['boxed'], style: { preset: 'boxed', fontFamily: 'Poppins', fontWeight: 800, fontSize: 62, color: '#1C1F22', highlightColor: '#D9641E', strokeColor: '#000000', strokeWidth: 0, background: '#FFFFFF', shadow: false, uppercase: false, animation: 'pop', maxWords: 4 } },
  { id: 'neon', label: CAPTION_PRESET_LABELS['neon'], style: { preset: 'neon', fontFamily: 'Montserrat', fontWeight: 900, fontSize: 72, color: '#FFFFFF', highlightColor: '#FF3DCB', strokeColor: '#00E5FF', strokeWidth: 4, background: '', shadow: true, uppercase: true, animation: 'bounce', maxWords: 3 } },
];

export function captionPreset(id: CaptionPreset): CaptionPresetDef {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[1];
}

/* ---------- cor ---------- */
export const COLOR_PRESETS: { id: ColorPreset; label: string; css: string }[] = [
  { id: 'none', label: PRESET_LABELS['none'], css: 'none' },
  { id: 'cinematic', label: PRESET_LABELS['cinematic'], css: 'contrast(1.15) saturate(.85) sepia(.12) hue-rotate(-8deg)' },
  { id: 'warm', label: PRESET_LABELS['warm'], css: 'sepia(.28) saturate(1.25) brightness(1.03)' },
  { id: 'cool', label: PRESET_LABELS['cool'], css: 'saturate(1.05) hue-rotate(12deg) brightness(1.02) contrast(1.05)' },
  { id: 'vibrant', label: PRESET_LABELS['vibrant'], css: 'saturate(1.6) contrast(1.08)' },
  { id: 'vintage', label: PRESET_LABELS['vintage'], css: 'sepia(.45) contrast(.9) brightness(1.05) saturate(.8)' },
  { id: 'bw', label: PRESET_LABELS['bw'], css: 'grayscale(1) contrast(1.1)' },
  { id: 'moody', label: PRESET_LABELS['moody'], css: 'brightness(.85) contrast(1.2) saturate(.7)' },
];

export const FILTER_DEFS: { kind: FilterKind; label: string; min: number; max: number }[] = [
  { kind: 'brightness', label: FILTER_LABELS['brightness'], min: -1, max: 1 },
  { kind: 'contrast', label: FILTER_LABELS['contrast'], min: -1, max: 1 },
  { kind: 'saturation', label: FILTER_LABELS['saturation'], min: -1, max: 1 },
  { kind: 'temperature', label: FILTER_LABELS['temperature'], min: -1, max: 1 },
  { kind: 'blur', label: FILTER_LABELS['blur'], min: 0, max: 1 },
  { kind: 'vignette', label: FILTER_LABELS['vignette'], min: 0, max: 1 },
  { kind: 'grain', label: FILTER_LABELS['grain'], min: 0, max: 1 },
  { kind: 'bw', label: FILTER_LABELS['bw'], min: 0, max: 1 },
  { kind: 'sepia', label: FILTER_LABELS['sepia'], min: 0, max: 1 },
];

export function filterValue(filters: Filter[] | undefined, kind: FilterKind): number {
  return filters?.find((f) => f.kind === kind)?.value ?? 0;
}

/** define o valor do filtro; 0 remove (neutro) */
export function setFilter(filters: Filter[] | undefined, kind: FilterKind, value: number): Filter[] {
  const rest = (filters ?? []).filter((f) => f.kind !== kind);
  return Math.abs(value) < 1e-3 ? rest : [...rest, { kind, value: Math.round(value * 100) / 100 }];
}

/** CSS aproximado dos filtros (só para miniaturas/amostras na UI; o engine faz o real) */
export function filtersToCss(filters: Filter[] | undefined, preset?: ColorPreset): string {
  const parts: string[] = [];
  const pc = COLOR_PRESETS.find((p) => p.id === preset);
  if (pc && pc.css !== 'none') parts.push(pc.css);
  for (const f of filters ?? []) {
    const v = f.value;
    if (f.kind === 'brightness') parts.push(`brightness(${(1 + v * 0.6).toFixed(2)})`);
    else if (f.kind === 'contrast') parts.push(`contrast(${(1 + v * 0.7).toFixed(2)})`);
    else if (f.kind === 'saturation') parts.push(`saturate(${Math.max(0, 1 + v).toFixed(2)})`);
    else if (f.kind === 'temperature') parts.push(v >= 0 ? `sepia(${(v * 0.35).toFixed(2)})` : `hue-rotate(${(v * -20).toFixed(0)}deg)`);
    else if (f.kind === 'blur') parts.push(`blur(${(v * 4).toFixed(1)}px)`);
    else if (f.kind === 'bw') parts.push(`grayscale(${v.toFixed(2)})`);
    else if (f.kind === 'sepia') parts.push(`sepia(${v.toFixed(2)})`);
  }
  return parts.join(' ') || 'none';
}

/* ---------- transições ---------- */
export const TRANSITIONS: { kind: TransitionKind; label: string }[] = ALL_TRANSITIONS.map((kind) => ({ kind, label: TRANSITION_LABELS[kind] }));

/* ---------- velocidade / keyframes ---------- */

/** mudar a velocidade mantém o mesmo trecho da mídia: duração = duração × velAntiga / velNova */
export function retimeForSpeed(c: Pick<VideoClip | AudioClip, 'duration' | 'speed'>, speed: number): { speed: number; duration: number } {
  const s = Math.max(0.1, Math.min(8, speed));
  const old = c.speed > 0 ? c.speed : 1;
  return { speed: s, duration: Math.max(0.05, (c.duration * old) / s) };
}

/**
 * "zoom punch-in" no tempo de timeline `at`: entra rápido (≈0,12 s), segura, e volta.
 * Mescla com keyframes existentes fora da janela do punch.
 */
export function punchInKeyframes(c: VideoClip | ImageClip, at: number, opts: { scale?: number; hold?: number } = {}): Keyframe[] {
  const scale = opts.scale ?? 1.25;
  const hold = opts.hold ?? 1.1;
  const base = c.transform?.scale ?? DEFAULT_TRANSFORM.scale;
  const rel = Math.max(0, Math.min(c.duration - 0.05, at - c.start));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const t0 = r(rel);
  const t1 = r(Math.min(c.duration, rel + 0.12));
  const t2 = r(Math.min(c.duration, rel + 0.12 + hold));
  const t3 = r(Math.min(c.duration, t2 + 0.3));
  const punch: Keyframe[] = [
    { t: t0, transform: { scale: base }, easing: 'easeOut' },
    { t: t1, transform: { scale: r(base * scale) }, easing: 'linear' },
  ];
  if (t2 > t1) punch.push({ t: t2, transform: { scale: r(base * scale) }, easing: 'easeInOut' });
  if (t3 > t2) punch.push({ t: t3, transform: { scale: base } });
  const keep = (c.keyframes ?? []).filter((k) => k.t < t0 - 1e-3 || k.t > t3 + 1e-3);
  return [...keep, ...punch].sort((a, b) => a.t - b.t);
}

/** segundos com 1 casa → "0:03.4" e parse inverso ("1:02.5", "62.5") */
export function parseTimeInput(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return null;
  const parts = v.split(':');
  if (parts.length > 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !isFinite(n) || n < 0)) return null;
  return parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0];
}

/* ---------- curvas de velocidade (CapCut) ---------- */
import type { SpeedPoint, SpeedPreset, ClipAnimation, VisualEffectKind, BlendMode, MaskShape, ShapeKind, AudioEffectKind } from '@/lib/types';

export const SPEED_PRESETS: { id: SpeedPreset; label: string; points: SpeedPoint[] }[] = (Object.keys(ENGINE_SPEED_PRESETS) as SpeedPreset[]).map((id) => ({ id, label: SPEED_PRESET_LABELS[id], points: ENGINE_SPEED_PRESETS[id] }));

/** velocidade média de uma curva (trapézios) — duração na timeline = trecho da mídia / média */
export function meanSpeed(points: SpeedPoint[]): number {
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (!pts.length) return 1;
  if (pts.length === 1) return pts[0].speed;
  return curveIntegral(pts, 1);
}

/** aplica (ou remove) curva mantendo o mesmo trecho da mídia (com curva o engine ignora `speed`) */
export function retimeForCurve(c: { duration: number; speed: number; speedCurve?: SpeedPoint[] }, curve: SpeedPoint[] | undefined): { duration: number; speedCurve: SpeedPoint[] | undefined } {
  const constSpeed = c.speed > 0 ? c.speed : 1;
  const src = c.duration * (c.speedCurve && c.speedCurve.length >= 2 ? meanSpeed(c.speedCurve) : constSpeed);
  const rate = curve && curve.length >= 2 ? meanSpeed(curve) : constSpeed;
  return { duration: Math.max(0.05, src / rate), speedCurve: curve };
}

/* ---------- animações de clipe ---------- */
export const CLIP_ANIMATIONS: { id: ClipAnimation; label: string }[] = fromLabels(CLIP_ANIMATION_LABELS);

export const TEXT_ANIMATIONS_ALL: { id: TextAnimation; label: string }[] = fromLabels(TEXT_ANIMATION_LABELS);

/* ---------- efeitos visuais ---------- */
export const VISUAL_EFFECTS: { id: VisualEffectKind; label: string; css: string }[] = [
  { id: 'shake', label: EFFECT_LABELS['shake'], css: 'none' },
  { id: 'glitch', label: EFFECT_LABELS['glitch'], css: 'hue-rotate(40deg) saturate(1.6)' },
  { id: 'rgb-split', label: EFFECT_LABELS['rgb-split'], css: 'saturate(1.8) contrast(1.1)' },
  { id: 'zoom-pulse', label: EFFECT_LABELS['zoom-pulse'], css: 'none' },
  { id: 'vhs', label: EFFECT_LABELS['vhs'], css: 'sepia(.25) saturate(1.4) contrast(.9) blur(.4px)' },
  { id: 'film-grain', label: EFFECT_LABELS['film-grain'], css: 'contrast(1.1) saturate(.85)' },
  { id: 'light-leak', label: EFFECT_LABELS['light-leak'], css: 'sepia(.3) brightness(1.15) saturate(1.3)' },
  { id: 'pixelate', label: EFFECT_LABELS['pixelate'], css: 'contrast(1.2)' },
  { id: 'mirror', label: EFFECT_LABELS['mirror'], css: 'none' },
  { id: 'kaleidoscope', label: EFFECT_LABELS['kaleidoscope'], css: 'hue-rotate(90deg)' },
  { id: 'blur-motion', label: EFFECT_LABELS['blur-motion'], css: 'blur(1.5px)' },
  { id: 'flash-strobe', label: EFFECT_LABELS['flash-strobe'], css: 'brightness(1.4)' },
  { id: 'old-film', label: EFFECT_LABELS['old-film'], css: 'sepia(.7) contrast(1.1)' },
  { id: 'vignette-pulse', label: EFFECT_LABELS['vignette-pulse'], css: 'brightness(.85)' },
  { id: 'sparkle', label: EFFECT_LABELS['sparkle'], css: 'brightness(1.1) saturate(1.2)' },
  { id: 'soft-glow', label: EFFECT_LABELS['soft-glow'], css: 'brightness(1.12) contrast(.92) saturate(1.1)' },
  { id: 'neon-edge', label: EFFECT_LABELS['neon-edge'], css: 'invert(.15) saturate(2.2) hue-rotate(200deg)' },
  { id: 'black-bars', label: EFFECT_LABELS['black-bars'], css: 'contrast(1.05)' },
];

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiplicar' }, { id: 'screen', label: 'Tela' },
  { id: 'overlay', label: 'Sobrepor' }, { id: 'darken', label: 'Escurecer' }, { id: 'lighten', label: 'Clarear' },
  { id: 'add', label: 'Adicionar' }, { id: 'difference', label: 'Diferença' },
];

export const MASK_SHAPES: { id: MaskShape; label: string }[] = fromLabels(MASK_LABELS);

export const SHAPES: { id: ShapeKind; label: string }[] = fromLabels(SHAPE_LABELS);

export const AUDIO_EFFECTS: { id: AudioEffectKind; label: string }[] = fromLabels(AUDIO_EFFECT_LABELS);

/** ajustes finos (aba Ajustes) — todos -1..1 exceto os de intensidade */
export const ADJUST_DEFS: { kind: FilterKind; label: string; min: number; max: number }[] = [
  { kind: 'exposure', label: FILTER_LABELS['exposure'], min: -1, max: 1 },
  { kind: 'brightness', label: FILTER_LABELS['brightness'], min: -1, max: 1 },
  { kind: 'contrast', label: FILTER_LABELS['contrast'], min: -1, max: 1 },
  { kind: 'highlights', label: FILTER_LABELS['highlights'], min: -1, max: 1 },
  { kind: 'shadows', label: FILTER_LABELS['shadows'], min: -1, max: 1 },
  { kind: 'saturation', label: FILTER_LABELS['saturation'], min: -1, max: 1 },
  { kind: 'temperature', label: FILTER_LABELS['temperature'], min: -1, max: 1 },
  { kind: 'tint', label: FILTER_LABELS['tint'], min: -1, max: 1 },
  { kind: 'hue', label: FILTER_LABELS['hue'], min: -1, max: 1 },
  { kind: 'sharpen', label: FILTER_LABELS['sharpen'], min: 0, max: 1 },
  { kind: 'vignette', label: FILTER_LABELS['vignette'], min: 0, max: 1 },
  { kind: 'fade', label: FILTER_LABELS['fade'], min: 0, max: 1 },
  { kind: 'grain', label: FILTER_LABELS['grain'], min: 0, max: 1 },
  { kind: 'blur', label: FILTER_LABELS['blur'], min: 0, max: 1 },
];

/** proporções de recorte (w/h relativos ao quadro da mídia) */
export function cropForRatio(mediaW: number, mediaH: number, ratio: number | null): { x: number; y: number; w: number; h: number } {
  if (!ratio || !mediaW || !mediaH) return { x: 0, y: 0, w: 1, h: 1 };
  const mr = mediaW / mediaH;
  if (mr > ratio) { const w = ratio / mr; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  const h = mr / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}
