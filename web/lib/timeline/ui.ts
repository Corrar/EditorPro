'use client';
/* =====================================================================
   Estado LOCAL da timeline (não é documento, não entra no desfazer):
   ímã, rolagem visível, prévia de arraste, linha de encaixe, menu.
   Fica separado do store global para que arrastar/rolar não
   re-renderize o resto do editor.
   ===================================================================== */
import { create } from 'zustand';
import type { Id, Project, Seconds, Track, TrackKind } from '../types';

export type DragPreview =
  | {
      mode: 'move';
      ids: Id[];
      primary: Id;
      /** deslocamento de tempo aplicado a todos */
      delta: Seconds;
      /** trilha de destino do clipe principal (só arraste simples) */
      trackId?: Id;
      /** soltar cria trilha nova */
      newTrack?: boolean;
    }
  | { mode: 'trim-start' | 'trim-end'; id: Id; start: Seconds; end: Seconds }
  | { mode: 'cap-move' | 'cap-start' | 'cap-end'; id: Id; start: Seconds; end: Seconds };

export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TimelineUi {
  snapping: boolean;
  scrollLeft: number;
  viewW: number;
  drag: DragPreview | null;
  snapLine: Seconds | null;
  /** destaque ao arrastar mídia da biblioteca */
  dropHint: { t: Seconds; rowId?: Id } | null;
  marquee: Marquee | null;
  /** touch = aberto por toque longo (ignora o "soltar" do dedo logo depois) */
  menu: { x: number; y: number; clipId: Id; touch?: boolean } | null;
  captionSel: Id | null;
  dims: Dims;
  /** menu "⋯" da toolbar compacta / popover de trilha compacta */
  overflowOpen: boolean;
  trackPop: { id: Id; x: number; y: number } | null;
  set: (patch: Partial<Omit<TimelineUi, 'set'>>) => void;
}



/* ---------- dimensões (dependem do contêiner e do tipo de ponteiro) ---------- */

export type RowKind = TrackKind | 'captions' | 'new';

export interface Dims {
  /** contêiner estreito (< 600px): cabeçalhos viram ícones, toolbar compacta */
  compact: boolean;
  /** contêiner baixo (< 180px): régua simplificada */
  short: boolean;
  /** ponteiro grosso (toque): alvos maiores */
  coarse: boolean;
  headerW: number;
  rulerH: number;
  rowH: Record<RowKind, number>;
}

export const COMPACT_W = 600;
export const SHORT_H = 180;

export function dimsFor(width: number, height: number, coarse: boolean): Dims {
  const compact = width > 0 && width < COMPACT_W;
  const short = height > 0 && height < SHORT_H;
  const k = compact || short ? 0.74 : 1;
  const touch = coarse ? 1.08 : 1;
  const h = (v: number) => Math.round(v * k * touch);
  return {
    compact,
    short,
    coarse,
    headerW: compact ? 52 : 184,
    rulerH: short ? 16 : coarse ? 34 : 30,
    rowH: { video: h(66), text: h(38), audio: h(50), captions: h(34), new: h(34) },
  };
}

/* ---------- layout vertical (alturas fixas => sem medir DOM) ---------- */

/** valores padrão (desktop, contêiner largo) — mantidos por compatibilidade */
export const HEADER_W = 184;
export const RULER_H = 30;
export const ROW_H: Record<RowKind, number> = dimsFor(1200, 400, false).rowH;
export const ROW_GAP = 4;

export interface RowInfo {
  id: Id; // trackId, 'captions' ou 'new'
  kind: RowKind;
  track?: Track;
  top: number; // relativo ao topo da área de trilhas (abaixo da régua)
  height: number;
}

/**
 * ordem visual: legendas no topo, depois trilhas de vídeo/texto da camada
 * mais alta para a mais baixa, depois áudio, e a faixa "nova trilha".
 */
export function rowLayout(p: Project, withNewRow: boolean, rowH: Record<RowKind, number> = ROW_H): RowInfo[] {
  const rows: RowInfo[] = [];
  let y = ROW_GAP;
  const push = (r: Omit<RowInfo, 'top' | 'height'>) => {
    const height = rowH[r.kind];
    rows.push({ ...r, top: y, height });
    y += height + ROW_GAP;
  };
  push({ id: 'captions', kind: 'captions' });
  const visualTracks = [...p.tracks].filter((t) => t.kind !== 'audio').reverse();
  for (const t of visualTracks) push({ id: t.id, kind: t.kind, track: t });
  for (const t of p.tracks) if (t.kind === 'audio') push({ id: t.id, kind: 'audio', track: t });
  if (withNewRow) push({ id: 'new', kind: 'new' });
  return rows;
}

export function rowsHeight(rows: RowInfo[]): number {
  const last = rows[rows.length - 1];
  return last ? last.top + last.height + ROW_GAP : 0;
}

export function rowAtY(rows: RowInfo[], y: number): RowInfo | undefined {
  for (const r of rows) if (y >= r.top - ROW_GAP / 2 && y < r.top + r.height + ROW_GAP / 2) return r;
  if (rows.length && y >= rows[rows.length - 1].top) return rows[rows.length - 1];
  return undefined;
}

/* store criado no fim do módulo: depende de dimsFor/constantes acima */
export const useTimelineUi = create<TimelineUi>((set) => ({
  snapping: true,
  scrollLeft: 0,
  viewW: 1000,
  drag: null,
  snapLine: null,
  dropHint: null,
  marquee: null,
  menu: null,
  captionSel: null,
  dims: dimsFor(1200, 400, false),
  overflowOpen: false,
  trackPop: null,
  set: (patch) => set(patch),
}));

export const useDims = () => useTimelineUi((s) => s.dims);
