/* =====================================================================
   Biblioteca · looks de cor tipo LUT (dono: sessão "biblioteca").
   Cada look é uma combinação de Filter[] (+ opcionalmente um colorPreset
   nativo do engine, expandido em filtros). A intensidade 0..1 interpola a
   partir do neutro (0 = sem efeito, 1 = look completo). Puro.
   ===================================================================== */
import type { ColorPreset, Filter, FilterKind, Id, Project, Seconds } from '../types';
import type { EditOp } from '../ops';
import { findClip, projectDuration } from '../ops';
import { COLOR_PRESETS } from '../engine/filters';
import { makeAdjustmentClip } from '../defaults';
import { uid } from '../util';

export type LookCategory = 'cinema' | 'filme' | 'pb' | 'cor';

export const LOOK_CATEGORY_LABELS: Record<LookCategory, string> = { cinema: 'Cinema', filme: 'Filme', pb: 'P&B', cor: 'Cor' };

export interface LookDef {
  id: string;
  name: string;
  category: LookCategory;
  filters: Filter[];
  /** preset nativo somado (expandido em filtros ao calcular) */
  preset?: ColorPreset;
  /** duas cores p/ a amostra quando não há quadro */
  swatch: [string, string];
  description: string;
}

const f = (kind: FilterKind, value: number): Filter => ({ kind, value });

export const LOOKS: LookDef[] = [
  { id: 'teal-laranja', name: 'Azul e laranja', category: 'cinema', swatch: ['#1F6F78', '#F29A4A'], description: 'Sombras frias, pele quente — clássico de cinema.',
    filters: [f('contrast', 0.2), f('saturation', 0.08), f('temperature', 0.18), f('tint', -0.08), f('shadows', -0.12), f('highlights', 0.06), f('hue', -0.03), f('vignette', 0.35)] },
  { id: 'filme-quente', name: 'Filme quente', category: 'filme', swatch: ['#8C4A1E', '#F4C27A'], description: 'Tons dourados e granulado leve.',
    filters: [f('temperature', 0.38), f('contrast', 0.1), f('saturation', 0.05), f('fade', 0.18), f('grain', 0.25), f('vignette', 0.3)] },
  { id: 'filme-frio', name: 'Filme frio', category: 'filme', swatch: ['#203A55', '#A9C6DE'], description: 'Azulado, contido e levemente lavado.',
    filters: [f('temperature', -0.36), f('contrast', 0.12), f('saturation', -0.15), f('fade', 0.15), f('grain', 0.2)] },
  { id: 'matte', name: 'Desbotado matte', category: 'filme', swatch: ['#5A5550', '#D8D0C4'], description: 'Pretos lavados e cores suaves.',
    filters: [f('fade', 0.45), f('contrast', -0.12), f('saturation', -0.2), f('shadows', 0.15)] },
  { id: 'pb-contraste', name: 'P&B contraste', category: 'pb', swatch: ['#0E0E0E', '#F2F2F2'], description: 'Preto e branco duro e dramático.',
    filters: [f('bw', 1), f('contrast', 0.35), f('shadows', -0.15), f('vignette', 0.4)] },
  { id: 'pb-suave', name: 'P&B suave', category: 'pb', swatch: ['#3A3A3A', '#DADADA'], description: 'Preto e branco delicado e lavado.',
    filters: [f('bw', 1), f('contrast', -0.05), f('fade', 0.28), f('grain', 0.15)] },
  { id: 'vintage-70', name: 'Vintage 70s', category: 'filme', swatch: ['#7A5A2C', '#E9C27B'], description: 'Sépia, granulado e bordas escuras.', preset: 'vintage',
    filters: [f('temperature', 0.2), f('tint', 0.06)] },
  { id: 'pastel', name: 'Pastel', category: 'cor', swatch: ['#F3C6D3', '#BFE3E0'], description: 'Claro, suave e pouco contraste.',
    filters: [f('brightness', 0.08), f('contrast', -0.15), f('saturation', -0.1), f('fade', 0.2), f('tint', 0.05)] },
  { id: 'vibrante', name: 'Vibrante', category: 'cor', swatch: ['#FF3D7F', '#2BD4FF'], description: 'Cores saturadas e vivas.',
    filters: [f('saturation', 0.5), f('contrast', 0.15), f('sharpen', 0.25), f('brightness', 0.03)] },
  { id: 'noir', name: 'Noir', category: 'pb', swatch: ['#000000', '#8A8A8A'], description: 'Escuro, P&B e vinheta pesada.',
    filters: [f('bw', 1), f('contrast', 0.45), f('brightness', -0.12), f('vignette', 0.75), f('grain', 0.3)] },
  { id: 'verao', name: 'Verão', category: 'cor', swatch: ['#FFB347', '#5ED6F2'], description: 'Quente, luminoso e saturado.',
    filters: [f('temperature', 0.25), f('saturation', 0.25), f('brightness', 0.06), f('highlights', 0.08)] },
  { id: 'inverno', name: 'Inverno', category: 'cor', swatch: ['#A8C8E8', '#F0F4F8'], description: 'Frio, claro e dessaturado.',
    filters: [f('temperature', -0.42), f('saturation', -0.25), f('brightness', 0.05), f('contrast', 0.05)] },
  { id: 'por-do-sol', name: 'Pôr do sol', category: 'cor', swatch: ['#FF7A3D', '#B24A8C'], description: 'Laranja e magenta de fim de tarde.',
    filters: [f('temperature', 0.45), f('tint', 0.15), f('saturation', 0.15), f('contrast', 0.08), f('vignette', 0.3)] },
  { id: 'neon-noturno', name: 'Neon noturno', category: 'cinema', swatch: ['#3A1C71', '#00E5FF'], description: 'Noite magenta/ciano com contraste.',
    filters: [f('temperature', -0.25), f('tint', 0.25), f('saturation', 0.35), f('contrast', 0.22), f('brightness', -0.05), f('vignette', 0.4)] },
  { id: 'natural-mais', name: 'Natural+', category: 'cor', swatch: ['#6E8B5A', '#E8D3B0'], description: 'Correção sutil: um pouco mais de vida.',
    filters: [f('contrast', 0.08), f('saturation', 0.12), f('sharpen', 0.15), f('highlights', -0.05), f('shadows', 0.05)] },
  { id: 'cinema-verde', name: 'Cinema verde', category: 'cinema', swatch: ['#2F4A2C', '#C9D6A3'], description: 'Tom esverdeado de suspense.',
    filters: [f('tint', -0.25), f('temperature', -0.05), f('contrast', 0.18), f('saturation', -0.18), f('fade', 0.1), f('vignette', 0.45)] },
];

const BY_ID = new Map(LOOKS.map((l) => [l.id, l]));

export function lookDef(id: string): LookDef | undefined {
  return BY_ID.get(id);
}

/** filtros do look na intensidade (0..1). intensidade 0 => [] */
export function lookFilters(id: string, intensity = 1): Filter[] {
  const def = lookDef(id);
  const k = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1));
  if (!def || k <= 0) return [];
  const all = [...(def.preset ? COLOR_PRESETS[def.preset] ?? [] : []), ...def.filters];
  // soma filtros repetidos do mesmo tipo (preset + look) antes de escalar
  const acc = new Map<FilterKind, number>();
  for (const x of all) acc.set(x.kind, (acc.get(x.kind) ?? 0) + x.value);
  return [...acc].map(([kind, value]) => ({ kind, value: round(value * k) }));
}

/** tenta reconhecer qual look (e intensidade) está aplicado num conjunto de filtros */
export function detectLook(filters: Filter[] | undefined): { id: string; intensity: number } | null {
  if (!filters?.length) return null;
  for (const def of LOOKS) {
    const full = lookFilters(def.id, 1);
    if (full.length !== filters.length) continue;
    const ref = full.find((x) => Math.abs(x.value) > 0.05);
    const cur = ref && filters.find((x) => x.kind === ref.kind);
    if (!ref || !cur) continue;
    const k = cur.value / ref.value;
    if (k <= 0 || k > 1.0001) continue;
    if (full.every((x) => { const c = filters.find((y) => y.kind === x.kind); return c && Math.abs(c.value - x.value * k) < 0.01; })) {
      return { id: def.id, intensity: Math.round(k * 100) / 100 };
    }
  }
  return null;
}

/** aplica o look nos clipes visuais (substitui os filtros e zera o preset nativo) */
export function lookClipOps(p: Project, clipIds: Id[], id: string, intensity = 1): EditOp[] {
  const def = lookDef(id);
  const filters = lookFilters(id, intensity);
  const ops: EditOp[] = [];
  for (const clipId of clipIds) {
    const found = findClip(p, clipId);
    if (!found) continue;
    const t = found.clip.type;
    if (t !== 'video' && t !== 'image' && t !== 'adjustment') continue;
    ops.push({ op: 'update_clip', clipId, patch: { filters, colorPreset: 'none' }, explain: def ? `Look “${def.name}” (${Math.round(intensity * 100)}%)` : 'Removendo look' });
  }
  return ops;
}

/**
 * Look como camada de ajuste (não destrutivo, afeta tudo abaixo): cria a
 * trilha de efeito logo acima da trilha de vídeo mais alta se preciso.
 */
export function lookAdjustmentOps(p: Project, id: string, intensity = 1, range?: { start: Seconds; duration: Seconds }): EditOp[] {
  const def = lookDef(id);
  if (!def) return [];
  const start = range?.start ?? 0;
  const duration = range?.duration ?? Math.max(1, projectDuration(p) - start);
  const ops: EditOp[] = [];
  let lastVisual = -1;
  p.tracks.forEach((t, i) => { if (t.kind === 'video' || t.kind === 'overlay') lastVisual = i; });
  // reaproveita trilha de efeito livre logo acima do vídeo
  let trackId = p.tracks.find((t, i) => t.kind === 'effect' && !t.locked && i > lastVisual
    && !t.clips.some((c) => c.start < start + duration && c.start + c.duration > start))?.id;
  if (!trackId) {
    trackId = uid('track_effect');
    const n = p.tracks.filter((t) => t.kind === 'effect').length + 1;
    ops.push({ op: 'add_track', track: { id: trackId, kind: 'effect', name: `Ajuste ${n}` }, index: lastVisual + 1, explain: 'Nova camada de ajuste' });
  }
  const clip = makeAdjustmentClip(start, duration, { filters: lookFilters(id, intensity), label: `Look · ${def.name}` });
  ops.push({ op: 'add_clip', trackId, clip, explain: `Look “${def.name}” em camada de ajuste` });
  return ops;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
