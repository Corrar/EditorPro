/* filtros e predefinições de cor (puro: só monta descrições; o desenho fica em draw.ts) */
import type { ColorPreset, Filter, FilterKind } from '../types';

export const COLOR_PRESETS: Record<ColorPreset, Filter[]> = {
  none: [],
  cinematic: [
    { kind: 'contrast', value: 0.18 }, { kind: 'saturation', value: -0.12 },
    { kind: 'temperature', value: 0.12 }, { kind: 'vignette', value: 0.45 },
  ],
  warm: [{ kind: 'temperature', value: 0.4 }, { kind: 'saturation', value: 0.1 }, { kind: 'brightness', value: 0.03 }],
  cool: [{ kind: 'temperature', value: -0.4 }, { kind: 'contrast', value: 0.06 }],
  vibrant: [{ kind: 'saturation', value: 0.45 }, { kind: 'contrast', value: 0.12 }, { kind: 'brightness', value: 0.03 }],
  vintage: [
    { kind: 'sepia', value: 0.45 }, { kind: 'contrast', value: -0.08 }, { kind: 'saturation', value: -0.2 },
    { kind: 'grain', value: 0.35 }, { kind: 'vignette', value: 0.5 }, { kind: 'fade', value: 0.35 },
  ],
  bw: [{ kind: 'bw', value: 1 }, { kind: 'contrast', value: 0.15 }],
  moody: [
    { kind: 'brightness', value: -0.1 }, { kind: 'contrast', value: 0.22 }, { kind: 'saturation', value: -0.3 },
    { kind: 'temperature', value: -0.12 }, { kind: 'vignette', value: 0.6 },
  ],
};

export const FILTER_LABELS: Record<FilterKind, string> = {
  brightness: 'Brilho', contrast: 'Contraste', saturation: 'Saturação', temperature: 'Temperatura', blur: 'Desfoque',
  vignette: 'Vinheta', grain: 'Granulado', bw: 'Preto e branco', sepia: 'Sépia', exposure: 'Exposição',
  highlights: 'Realces', shadows: 'Sombras', tint: 'Matiz (verde↔magenta)', hue: 'Tom', sharpen: 'Nitidez', fade: 'Desbotado',
};

export const PRESET_LABELS: Record<ColorPreset, string> = {
  none: 'Nenhum', cinematic: 'Cinemático', warm: 'Quente', cool: 'Frio', vibrant: 'Vibrante',
  vintage: 'Vintage', bw: 'P&B', moody: 'Dramático',
};

export function presetFilters(preset: ColorPreset | undefined): Filter[] {
  return preset ? COLOR_PRESETS[preset] ?? [] : [];
}

export interface ResolvedFilters {
  /** string para ctx.filter ('none' quando nada) */
  css: string;
  /** -1..1: >0 quente (laranja), <0 frio (azul) */
  temperature: number;
  vignette: number; // 0..1
  grain: number; // 0..1
  /** -1..1: >0 magenta, <0 verde */
  tint: number;
  highlights: number; // -1..1
  shadows: number; // -1..1
  sharpen: number; // 0..1
  fade: number; // 0..1 (preto "lavado")
}

/** precisa de processamento por pixel (WebGL/CPU)? */
export function needsPixelGrade(f: ResolvedFilters): boolean {
  return !!(f.highlights || f.shadows || f.sharpen);
}

/** soma preset + filtros do clipe (ajustes somam, efeitos pegam o máximo) e monta o ctx.filter */
export function resolveFilters(filters: Filter[] | undefined, preset?: ColorPreset, scale = 1): ResolvedFilters {
  const acc: Partial<Record<FilterKind, number>> = {};
  const add = (f: Filter) => {
    const v = Number.isFinite(f.value) ? f.value : 0;
    if (['brightness', 'contrast', 'saturation', 'temperature', 'exposure', 'highlights', 'shadows', 'tint', 'hue'].includes(f.kind)) {
      acc[f.kind] = (acc[f.kind] ?? 0) + v;
    } else acc[f.kind] = Math.max(acc[f.kind] ?? 0, v);
  };
  presetFilters(preset).forEach(add);
  (filters ?? []).forEach(add);
  const parts: string[] = [];
  const b = clampN(acc.brightness ?? 0, -1, 1);
  const c = clampN(acc.contrast ?? 0, -1, 1);
  const s = clampN(acc.saturation ?? 0, -1, 1);
  const ex = clampN(acc.exposure ?? 0, -1, 1);
  const bright = (1 + b) * Math.pow(2, ex * 1.5);
  if (b || ex) parts.push(`brightness(${round(bright)})`);
  if (c) parts.push(`contrast(${round(1 + c)})`);
  if (s) parts.push(`saturate(${round(1 + s)})`);
  if (acc.bw) parts.push(`grayscale(${round(clampN(acc.bw, 0, 1))})`);
  if (acc.sepia) parts.push(`sepia(${round(clampN(acc.sepia, 0, 1))})`);
  if (acc.hue) parts.push(`hue-rotate(${Math.round(clampN(acc.hue, -1, 1) * 180)}deg)`);
  if (acc.blur) parts.push(`blur(${round(clampN(acc.blur, 0, 1) * 24 * scale)}px)`);
  return {
    css: parts.length ? parts.join(' ') : 'none',
    temperature: clampN(acc.temperature ?? 0, -1, 1),
    vignette: clampN(acc.vignette ?? 0, 0, 1),
    grain: clampN(acc.grain ?? 0, 0, 1),
    tint: clampN(acc.tint ?? 0, -1, 1),
    highlights: clampN(acc.highlights ?? 0, -1, 1),
    shadows: clampN(acc.shadows ?? 0, -1, 1),
    sharpen: clampN(acc.sharpen ?? 0, 0, 1),
    fade: clampN(acc.fade ?? 0, 0, 1),
  };
}

const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round = (v: number) => Math.round(v * 1000) / 1000;
