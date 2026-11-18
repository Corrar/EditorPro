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
  menu: { x: number; y: number; clipId: Id } | null;
  captionSel: Id | null;
  set: (patch: Partial<Omit<TimelineUi, 'set'>>) => void;
}

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
  set: (patch) => set(patch),
}));

/* ---------- layout vertical (alturas fixas => sem medir DOM) ---------- */

export const HEADER_W = 184;
export const RULER_H = 30;
export const ROW_H: Record<TrackKind | 'captions' | 'new', number> = {
  video: 66,
  text: 38,
  audio: 50,
  captions: 34,
  new: 34,
};
export const ROW_GAP = 4;

export interface RowInfo {
  id: Id; // trackId, 'captions' ou 'new'
  kind: TrackKind | 'captions' | 'new';
  track?: Track;
  top: number; // relativo ao topo da área de trilhas (abaixo da régua)
  height: number;
}

/**
 * ordem visual: legendas no topo, depois trilhas de vídeo/texto da camada
 * mais alta para a mais baixa, depois áudio, e a faixa "nova trilha".
 */
export function rowLayout(p: Project, withNewRow: boolean): RowInfo[] {
  const rows: RowInfo[] = [];
  let y = ROW_GAP;
  const push = (r: Omit<RowInfo, 'top' | 'height'>) => {
    const height = ROW_H[r.kind];
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
