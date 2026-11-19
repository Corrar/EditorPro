'use client';
/* =====================================================================
   Estado LOCAL da timeline (não é documento, não entra no desfazer):
   ímã, rolagem visível, prévia de arraste, linha de encaixe, menu.
   Fica separado do store global para que arrastar/rolar não
   re-renderize o resto do editor.
   ===================================================================== */
import type { ClipOverride, MonitorFrame, TrimTool } from './trim';
import { create } from 'zustand';
import type { Id, Project, Seconds, Track, TrackKind } from '../types';
import type { ClipboardItem } from './edit';

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
  | { mode: 'cap-move' | 'cap-start' | 'cap-end'; id: Id; start: Seconds; end: Seconds }
  | { mode: 'marker'; id: Id; t: Seconds; end?: Seconds }
  | { mode: 'keyframe'; clipId: Id; index: number; t: Seconds }
  /** trims profissionais: valores provisórios dos clipes tocados + quadros do monitor */
  | { mode: 'pro'; tool: TrimTool; clipId: Id; over: Record<Id, ClipOverride>; frames: [MonitorFrame | null, MonitorFrame | null]; delta: Seconds };

export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type EditTool = 'select' | 'blade' | 'ripple' | 'roll' | 'slip' | 'slide';
export const TRIM_TOOLS: EditTool[] = ['ripple', 'roll', 'slip', 'slide'];
export const TOOL_LABEL: Record<EditTool, string> = {
  select: 'Seleção', blade: 'Lâmina', ripple: 'Ripple', roll: 'Roll', slip: 'Slip', slide: 'Slide',
};

export interface TimelineUi {
  snapping: boolean;
  scrollLeft: number;
  viewW: number;
  /** altura visível da área rolável (p/ esticar as trilhas no celular) */
  viewH: number;
  drag: DragPreview | null;
  snapLine: Seconds | null;
  /** destaque ao arrastar mídia da biblioteca */
  dropHint: { t: Seconds; rowId?: Id } | null;
  marquee: Marquee | null;
  /** touch = aberto por toque longo (ignora o "soltar" do dedo logo depois) */
  menu: { x: number; y: number; clipId?: Id; capId?: Id; touch?: boolean } | null;
  /** modo seleção de trecho na régua (toque não tem Shift) */
  rangeMode: boolean;
  /** trilha sob o cabeçalho arrastado (reordenar) */
  reorderOver: Id | null;
  captionSel: Id | null;
  /** trilha principal magnética (fecha buracos na 1ª trilha de vídeo) */
  magnetic: boolean;
  /** ao soltar sobre outro clipe: inserir (empurra) ou sobrescrever (substitui) */
  dropMode: 'insert' | 'overwrite';
  /** área de transferência local (copiar/colar) */
  clipboard: ClipboardItem[];
  /** trecho selecionado na régua (Shift+arrastar) */
  range: { start: Seconds; end: Seconds } | null;
  /** popover de marcador/comentário aberto */
  markerPop: { id: Id; x: number; y: number; isNew?: boolean } | null;
  /** popover do trecho selecionado */
  rangePop: { x: number; y: number } | null;
  /** popover de "+ trilha" / velocidade */
  addTrackOpen: boolean;
  speedPop: { x: number; y: number } | null;
  showMinimap: boolean;
  dims: Dims;
  /** menu "⋯" da toolbar compacta / popover de trilha compacta */
  overflowOpen: boolean;
  trackPop: { id: Id; x: number; y: number } | null;
  /** ferramenta ativa (estilo DaVinci): Seleção (A), Lâmina (B) e trims (T alterna) */
  tool: EditTool;
  /** tela de ajuda de atalhos (?) */
  helpOpen: boolean;
  /** shuttle J/K/L: velocidade atual (0 = parado; negativo = ré) */
  shuttle: number;
  /** posição do cursor da lâmina (prévia do corte) */
  bladeAt: { t: Seconds; clipId: Id } | null;
  set: (patch: Partial<Omit<TimelineUi, 'set'>>) => void;
}



/* ---------- dimensões (dependem do contêiner e do tipo de ponteiro) ---------- */

export type RowKind = TrackKind | 'captions' | 'new';

export interface Dims {
  /** contêiner estreito (< 600px): cabeçalhos viram ícones, toolbar compacta */
  compact: boolean;
  /** toolbar estreita (< 820px): barra compacta com "⋯" mesmo com cabeçalhos completos */
  barCompact: boolean;
  /**
   * modo celular estilo CapCut (= compact): playhead FIXO no centro, a timeline rola por baixo.
   * headerW vira a metade da largura (espaço antes do t=0, onde ficam "Capa" e "Editar com IA").
   */
  center: boolean;
  /** contêiner baixo (< 180px): régua simplificada */
  short: boolean;
  /** ponteiro grosso (toque): alvos maiores */
  coarse: boolean;
  headerW: number;
  rulerH: number;
  rowH: Record<RowKind, number>;
}

export const COMPACT_W = 600;
export const BAR_COMPACT_W = 820;
export const SHORT_H = 180;

export function dimsFor(width: number, height: number, coarse: boolean): Dims {
  const compact = width > 0 && width < COMPACT_W;
  const short = height > 0 && height < SHORT_H;
  const k = compact || short ? 0.74 : 1;
  const touch = coarse ? 1.08 : 1;
  const h = (v: number) => Math.round(v * k * touch);
  return {
    compact,
    barCompact: compact || (width > 0 && width < BAR_COMPACT_W),
    center: compact,
    short,
    coarse,
    headerW: compact ? Math.round(width / 2) : 204,
    rulerH: short ? 16 : coarse ? 34 : 30,
    rowH: compact
      ? // CapCut: trilha principal com tira de miniaturas grande (~56px), demais finas
        { video: 62, text: 34, audio: 40, overlay: 36, effect: 30, captions: 30, new: 30 }
      : { video: h(66), text: h(38), audio: h(50), overlay: h(42), effect: h(32), captions: h(34), new: h(34) },
  };
}

/* ---------- layout vertical (alturas fixas => sem medir DOM) ---------- */

/** valores padrão (desktop, contêiner largo) — mantidos por compatibilidade */
export const HEADER_W = 204;
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

/**
 * no compacto, estica as alturas das trilhas para preencher a altura disponível
 * (sem sobra vazia embaixo), no máximo 1,6x.
 */
export function fillRowHeights(rowH: Record<RowKind, number>, p: Project, available: number, maxK = 1.6): Record<RowKind, number> {
  const base = rowsHeight(rowLayout(p, false, rowH));
  if (available <= 0 || base <= 0 || available <= base) return rowH;
  const k = Math.min(maxK, available / base);
  const out = { ...rowH };
  for (const key of Object.keys(out) as RowKind[]) if (key !== 'new') out[key] = Math.floor(out[key] * k);
  return out;
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
  viewH: 300,
  drag: null,
  snapLine: null,
  dropHint: null,
  marquee: null,
  menu: null,
  captionSel: null,
  magnetic: true,
  rangeMode: false,
  reorderOver: null,
  dropMode: 'insert',
  clipboard: [],
  range: null,
  markerPop: null,
  rangePop: null,
  addTrackOpen: false,
  speedPop: null,
  showMinimap: true,
  dims: dimsFor(1200, 400, false),
  overflowOpen: false,
  trackPop: null,
  tool: 'select',
  helpOpen: false,
  shuttle: 0,
  bladeAt: null,
  set: (patch) => set(patch),
}));

export const useDims = () => useTimelineUi((s) => s.dims);

/**
 * janela de tempo a renderizar (virtualização horizontal): a tela visível + 1 tela de cada lado,
 * quantizada por "página" — só muda (e re-renderiza as trilhas) quando a rolagem cruza uma página.
 */
export function visibleWindow(page: number, viewW: number, headerW: number, zoom: number): [Seconds, Seconds] {
  const w = Math.max(200, viewW);
  const x0 = (page - 1) * w - headerW;
  const x1 = (page + 2) * w;
  return [Math.max(0, x0 / zoom), x1 / zoom];
}

export function useVisibleWindow(zoom: number): [Seconds, Seconds] {
  const page = useTimelineUi((s) => Math.floor(s.scrollLeft / Math.max(200, s.viewW)));
  const viewW = useTimelineUi((s) => s.viewW);
  const headerW = useTimelineUi((s) => s.dims.headerW);
  return visibleWindow(page, viewW, headerW, zoom);
}
