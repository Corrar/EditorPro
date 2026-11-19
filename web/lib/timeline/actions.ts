'use client';
/* =====================================================================
   Timeline — ações de edição de alto nível (API pública do módulo).
   Usam o store global (useEditor) + estado local (useTimelineUi) e
   despacham UMA lista de ops (1 desfazer). Aplicam a trilha magnética.
   Outros módulos podem importar daqui (ex.: engine chama freezeFrame).
   ===================================================================== */
import { useMemo } from 'react';
import type { Clip, Id, MediaAsset, Marker, Project, Seconds, Track, TrackKind } from '../types';
import { applyOps, clipEnd, findClip, TRACK_NAMES, type EditOp } from '../ops';
import { useEditor } from '../store';
import { emit } from '../events';
import { formatTime, uid } from '../util';
import {
  copyItems, deleteOps, detachAudioOps, duplicateWithGroups, mainTrackId, packOps, pasteOps, speedOps, splitOps,
} from './edit';
import { useTimelineUi } from './ui';
import { captureFrame } from '../media/tools';
import { freezeFrameOps as placeFreezeFrameOps } from '../media/place';
import { keyframeToggleOps } from './keyframes';
import { expandLinks, linkOps, splitAllOps, unlinkOps } from './trim';
import { nudgeOps } from './nav';
import { relinkSplitOps, syncLinkedAfterPack } from './links';

const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => emit('ep:toast', { text, kind });

/** acrescenta o "fecha buracos" da trilha principal se ela mudou (modo magnético) */
export function withMagnet(p: Project, ops0: EditOp[], force = false): EditOp[] {
  // cortes em clipes vinculados: cada pedaço fica vinculado só ao seu par
  const ops = ops0.length ? [...ops0, ...relinkSplitOps(p, ops0)] : ops0;
  if (!ops.length || (!force && !useTimelineUi.getState().magnetic)) return ops;
  const mainId = mainTrackId(p);
  if (!mainId) return ops;
  const { project: next } = applyOps(p, ops);
  const before = p.tracks.find((t) => t.id === mainId);
  const after = next.tracks.find((t) => t.id === mainId);
  if (!after || before === after) return ops;
  const pack = packOps(after);
  // o reempacotamento leva junto o áudio vinculado (A/V em sincronia)
  return [...ops, ...pack, ...syncLinkedAfterPack(p, ops, pack, mainId)];
}

/** despacha com magnetismo */
export function commit(ops: EditOp[]): boolean {
  if (!ops.length) return false;
  const st = useEditor.getState();
  st.dispatch(withMagnet(st.project, ops));
  return true;
}

export function splitAtPlayhead(ids?: Id[]) {
  const st = useEditor.getState();
  const ops = splitOps(st.project, ids ?? st.selection, st.playhead);
  if (!ops.length) return toast('Posicione o cursor sobre um clipe para dividir');
  commit(ops);
}

export function removeClips(ids?: Id[], ripple = false) {
  const st = useEditor.getState();
  const targets = ids ?? st.selection;
  if (!targets.length) {
    const cap = useTimelineUi.getState().captionSel;
    if (cap && st.project.captions.enabled) {
      st.dispatch({ op: 'set_captions', segments: st.project.captions.segments.filter((s) => s.id !== cap) });
      useTimelineUi.getState().set({ captionSel: null });
    }
    return;
  }
  const ops = deleteOps(st.project, targets, ripple);
  if (!ops.length) return toast('Clipe travado — destrave a trilha para excluir');
  commit(ops);
  st.select([]);
}

export function duplicateClips(ids?: Id[]) {
  const st = useEditor.getState();
  const { ops, newIds } = duplicateWithGroups(st.project, ids ?? st.selection);
  if (!ops.length) return;
  commit(ops);
  st.select(newIds);
}

export function copyClips(ids?: Id[]) {
  const st = useEditor.getState();
  const items = copyItems(st.project, ids ?? st.selection);
  if (!items.length) return;
  useTimelineUi.getState().set({ clipboard: items });
  toast(items.length === 1 ? 'Clipe copiado' : `${items.length} clipes copiados`, 'ok');
}

export function cutClips(ids?: Id[]) {
  copyClips(ids);
  removeClips(ids, false);
}

export function pasteClips(at?: Seconds) {
  const st = useEditor.getState();
  const items = useTimelineUi.getState().clipboard;
  if (!items.length) return toast('Nada copiado ainda (Ctrl+C)');
  const { ops, newIds } = pasteOps(st.project, items, at ?? st.playhead);
  commit(ops);
  st.select(newIds);
}

export function detachAudio(ids?: Id[]) {
  const st = useEditor.getState();
  const ops = (ids ?? st.selection).flatMap((id) => detachAudioOps(useEditor.getState().project, id));
  if (!ops.length) return toast('Selecione um clipe de vídeo para separar o áudio');
  st.dispatch(ops);
}

export function setSpeed(speed: number, ids?: Id[]) {
  const st = useEditor.getState();
  const ops = (ids ?? st.selection).flatMap((id) => {
    const f = findClip(st.project, id);
    const asset = f && 'assetId' in f.clip && f.clip.assetId ? st.assets[f.clip.assetId] : undefined;
    return speedOps(st.project, id, speed, asset?.duration);
  });
  if (!ops.length) return toast('Selecione um clipe de vídeo ou áudio');
  commit(ops);
}

/**
 * Congelar quadro no playhead: captura o quadro (lib/media captureFrame, já ingere o asset de imagem)
 * e aplica as ops do shell (lib/media/place freezeFrameOps). Pode receber um asset de imagem pronto.
 */
export async function freezeFrame(imageAsset?: MediaAsset, opts: { clipId?: Id; hold?: Seconds } = {}) {
  const st = useEditor.getState();
  const t = st.playhead;
  const target =
    opts.clipId ??
    st.selection.find((id) => {
      const f = findClip(st.project, id);
      return f?.clip.type === 'video' && t > f.clip.start && t < clipEnd(f.clip);
    }) ??
    st.project.tracks.flatMap((tr) => (tr.hidden ? [] : tr.clips)).find((c) => c.type === 'video' && t > c.start && t < clipEnd(c))?.id;
  const f = target ? findClip(st.project, target) : null;
  if (!f || f.clip.type !== 'video' || t <= f.clip.start || t >= clipEnd(f.clip)) return toast('Posicione o cursor sobre um clipe de vídeo para congelar o quadro');
  if (f.track.locked) return toast('Clipe travado — destrave a trilha');
  const clip = f.clip;
  try {
    let frame = imageAsset;
    if (!frame) {
      const src = st.assets[clip.assetId];
      if (!src) return toast('Mídia do clipe não encontrada', 'error');
      toast('Capturando quadro…');
      frame = await captureFrame(src, clip.in + (t - clip.start) * (clip.speed || 1));
    }
    if (!useEditor.getState().assets[frame.id]) useEditor.getState().addAsset(frame);
    const hold = opts.hold ?? 2;
    const ops = placeFreezeFrameOps(useEditor.getState().project, clip.id, t, frame, hold);
    if (!ops.length) return;
    useEditor.getState().dispatch(ops);
    toast(`Quadro congelado por ${hold}s`, 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Não consegui capturar o quadro', 'error');
  }
}

/* ---------- trilhas ---------- */

export function addTrack(kind: TrackKind) {
  const st = useEditor.getState();
  const n = st.project.tracks.filter((t) => t.kind === kind).length + 1;
  const id = uid(`track_${kind}`);
  st.dispatch({ op: 'add_track', track: { id, kind, name: `${TRACK_NAMES[kind]} ${n}` } });
  return id;
}

/* ---------- marcadores / comentários ---------- */

export const MARKER_COLORS = ['#D9641E', '#E0A32E', '#2E8C7A', '#3B7DD8', '#C2477A', '#6E5BB8'];

export function addMarker(kind: Marker['kind'] = 'user', patch: Partial<Marker> = {}): Id {
  const st = useEditor.getState();
  const id = uid(kind === 'comment' ? 'cmt' : 'mk');
  const marker: Marker = {
    id,
    t: st.playhead,
    kind,
    color: kind === 'comment' ? '#D9641E' : MARKER_COLORS[(st.project.markers?.length ?? 0) % MARKER_COLORS.length],
    ...(kind === 'comment' ? { resolved: false } : {}),
    ...patch,
  };
  st.dispatch({ op: 'add_marker', marker });
  return id;
}

/* ---------- keyframes ---------- */

export function toggleKeyframe(ids?: Id[]) {
  const st = useEditor.getState();
  const ops = (ids ?? st.selection).flatMap((id) => keyframeToggleOps(st.project, id, st.playhead));
  if (!ops.length) return toast('Selecione um clipe visual e posicione o cursor sobre ele');
  st.dispatch(ops);
}

/* ---------- "apontar para qualquer coisa" (contexto do chat) ---------- */

function clipLabel(p: Project, c: Clip): string {
  const f = findClip(p, c.id);
  const idx = f ? f.track.clips.findIndex((x) => x.id === c.id) + 1 : 0;
  const nm = c.type === 'text' ? `“${c.text.slice(0, 18)}”` : `${f ? f.track.name : 'Clipe'} · clipe ${idx}`;
  return `${nm} · ${formatTime(c.start)}–${formatTime(clipEnd(c))}`;
}

export function askAiAboutClips(ids?: Id[]) {
  const st = useEditor.getState();
  const clips = (ids ?? st.selection).map((id) => findClip(st.project, id)?.clip).filter((c): c is Clip => !!c);
  if (!clips.length) return;
  const label = clips.length === 1 ? clipLabel(st.project, clips[0]) : `${clips.length} clipes · ${formatTime(Math.min(...clips.map((c) => c.start)))}–${formatTime(Math.max(...clips.map(clipEnd)))}`;
  st.setChatContext({ clipIds: clips.map((c) => c.id), label });
  toast('Contexto enviado ao chat — escreva o que quer mudar', 'ok');
}

export function askAiAboutRange(start: Seconds, end: Seconds) {
  useEditor.getState().setChatContext({ range: { start, end }, label: `Trecho ${formatTime(start)}–${formatTime(end)}` });
  toast('Trecho enviado ao chat — escreva o que quer mudar', 'ok');
}

export function askAiAboutCaption(segmentId: Id) {
  const st = useEditor.getState();
  const s = st.project.captions.segments.find((x) => x.id === segmentId);
  if (!s) return;
  st.setChatContext({ segmentId, range: { start: s.start, end: s.end }, label: `Legenda “${s.text.slice(0, 22)}” · ${formatTime(s.start)}` });
  toast('Legenda enviada ao chat — escreva o que quer mudar', 'ok');
}


/* ---------- seleção (p/ a barra contextual do shell) ---------- */

export function clearSelection() {
  useEditor.getState().select([]);
  useTimelineUi.getState().set({ captionSel: null, menu: null });
}

export interface SelectedClipInfo {
  /** primeiro clipe selecionado (o "principal") */
  clip: Clip;
  track: Track;
  /** tipo do clipe principal: 'video' | 'audio' | 'text' | 'image' | 'sticker' | 'shape' | 'adjustment' */
  kind: Clip['type'];
  /** todos os ids selecionados (grupo/multi) */
  ids: Id[];
  count: number;
}

/**
 * Clipe selecionado na timeline (ou null). Seletores com referências estáveis:
 * só re-renderiza quando a seleção ou o próprio clipe mudam.
 */
export function useSelectedClip(): SelectedClipInfo | null {
  const ids = useEditor((s) => s.selection);
  const clip = useEditor((s) => (s.selection[0] ? findClip(s.project, s.selection[0])?.clip ?? null : null));
  const track = useEditor((s) => (s.selection[0] ? findClip(s.project, s.selection[0])?.track ?? null : null));
  return useMemo(() => (clip && track ? { clip, track, kind: clip.type, ids, count: ids.length } : null), [clip, track, ids]);
}

/* ---------------- estilo DaVinci ---------------- */

/** corta TODAS as trilhas (não travadas) no playhead, ignorando a seleção (Ctrl+Shift+B) */
export function splitAll() {
  const st = useEditor.getState();
  const fps = st.project.fps || 30;
  const t = Math.round(st.playhead * fps) / fps;
  const ops = splitAllOps(st.project, t, () => uid('clip'));
  if (!ops.length) return toast('Nada cruza o cursor para cortar');
  commit(ops);
}

/** vincula/desvincula áudio e vídeo da seleção (Ctrl+Alt+L) */
export function toggleLink(ids?: Id[]) {
  const st = useEditor.getState();
  const sel = ids ?? st.selection;
  if (!sel.length) return toast('Selecione os clipes para vincular');
  const p = st.project;
  const anyLinked = sel.some((id) => !!findClip(p, id)?.clip.linkId);
  if (anyLinked) {
    st.dispatch(unlinkOps(p, sel));
    return toast('Clipes desvinculados', 'ok');
  }
  if (sel.length < 2) return toast('Selecione 2 ou mais clipes (ex.: vídeo + áudio) para vincular');
  st.dispatch(linkOps(p, sel, uid('link')));
  st.select(expandLinks(useEditor.getState().project, sel));
  toast('Clipes vinculados: movem e aparam juntos (Alt = só um)', 'ok');
}

/** empurra a seleção quadro a quadro (, e . · Shift = 5 quadros) */
export function nudgeSelection(frames: number) {
  const st = useEditor.getState();
  const ops = nudgeOps(st.project, st.selection, frames);
  if (ops.length) commit(ops);
}
