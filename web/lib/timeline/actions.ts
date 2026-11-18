'use client';
/* =====================================================================
   Timeline — ações de edição de alto nível (API pública do módulo).
   Usam o store global (useEditor) + estado local (useTimelineUi) e
   despacham UMA lista de ops (1 desfazer). Aplicam a trilha magnética.
   Outros módulos podem importar daqui (ex.: engine chama freezeFrame).
   ===================================================================== */
import type { Clip, Id, MediaAsset, Marker, Project, Seconds, TrackKind } from '../types';
import { applyOps, clipEnd, findClip, TRACK_NAMES, type EditOp } from '../ops';
import { useEditor } from '../store';
import { emit } from '../events';
import { formatTime, uid } from '../util';
import {
  copyItems, deleteOps, detachAudioOps, duplicateOps, freezeFrameOps, mainTrackId, packOps, pasteOps, speedOps, splitOps,
} from './edit';
import { useTimelineUi } from './ui';
import { keyframeToggleOps } from './keyframes';

const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => emit('ep:toast', { text, kind });

/** acrescenta o "fecha buracos" da trilha principal se ela mudou (modo magnético) */
export function withMagnet(p: Project, ops: EditOp[], force = false): EditOp[] {
  if (!ops.length || (!force && !useTimelineUi.getState().magnetic)) return ops;
  const mainId = mainTrackId(p);
  if (!mainId) return ops;
  const { project: next } = applyOps(p, ops);
  const before = p.tracks.find((t) => t.id === mainId);
  const after = next.tracks.find((t) => t.id === mainId);
  if (!after || before === after) return ops;
  return [...ops, ...packOps(after)];
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
  st.dispatch(ops);
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
  const { ops, newIds } = duplicateOps(st.project, ids ?? st.selection);
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
 * Congelar quadro no playhead. Precisa de uma IMAGEM do quadro (MediaAsset kind 'image'),
 * que o engine/preview captura (canvas → Blob → asset). Sem ela, avisa.
 * Uso pelo engine: `freezeFrame(assetDoQuadro)` (o asset já deve estar em store.assets).
 */
export function freezeFrame(imageAsset?: MediaAsset, opts: { clipId?: Id; hold?: Seconds } = {}) {
  const st = useEditor.getState();
  const t = st.playhead;
  const target =
    opts.clipId ??
    st.selection.find((id) => {
      const f = findClip(st.project, id);
      return f?.clip.type === 'video' && t > f.clip.start && t < clipEnd(f.clip);
    }) ??
    st.project.tracks.flatMap((tr) => (tr.hidden ? [] : tr.clips)).find((c) => c.type === 'video' && t > c.start && t < clipEnd(c))?.id;
  if (!target) return toast('Posicione o cursor sobre um clipe de vídeo para congelar o quadro');
  if (!imageAsset) return toast('Congelar quadro: aguardando a captura do quadro pelo preview', 'error');
  if (!st.assets[imageAsset.id]) st.addAsset(imageAsset);
  const { ops, imageId } = freezeFrameOps(st.project, target, t, imageAsset, opts.hold ?? 2);
  if (!ops.length) return;
  commit(ops);
  if (imageId) st.select([imageId]);
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

