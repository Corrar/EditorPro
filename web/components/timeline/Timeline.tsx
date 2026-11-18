'use client';
/* =====================================================================
   Timeline multipista (dono: sessão "timeline").
   - Régua + playhead, trilhas (vídeo/texto/áudio) + linha de Legendas
   - Selecionar (shift = múltipla, arrastar no vazio = seleção em área)
   - Mover (inclusive p/ outra trilha compatível ou trilha nova), aparar
     bordas (limites da mídia), dividir, duplicar, excluir/ripple
   - Ímã (bordas de clipes, legendas e playhead), zoom (Ctrl+roda, pinça)
   - Soltar mídia da biblioteca ('application/x-ep-asset')
   - Edição ao vivo da IA (faixa de progresso, brilho, entrada animada)
   Durante arrastes a prévia é local (useTimelineUi) e UMA op é despachada
   no fim (1 passo de desfazer).
   ===================================================================== */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Clip, Id, Project, Seconds, TrackKind } from '@/lib/types';
import { useEditor } from '@/lib/store';
import { clipEnd, findClip, projectDuration, trackKindFor, type EditOp } from '@/lib/ops';
import { makeAudioClip, makeImageClip, makeVideoClip } from '@/lib/defaults';
import { emit } from '@/lib/events';
import { uid } from '@/lib/util';
import { collectSnapPoints, snapSpan, snapThreshold, snapTime } from '@/lib/timeline/snap';
import {
  MIN_CLIP, deleteOps, duplicateOps, fitZoom, kindForMedia, nearestFreeStart, overlaps, placeClip, splitOps, toFrame, trimBounds,
} from '@/lib/timeline/edit';
import { HEADER_W, RULER_H, type RowInfo, rowAtY, rowLayout, rowsHeight, useTimelineUi } from '@/lib/timeline/ui';
import { Toolbar, ZMAX, ZMIN } from './Toolbar';
import { Ruler } from './Ruler';
import { DragLayer, Guides, PlayheadLine, Rows } from './Rows';
import { ClipMenu, LiveBanner } from './Overlays';
import { useShortcuts } from './useShortcuts';

const ASSET_MIME = 'application/x-ep-asset';
const DRAG_THRESHOLD = 4;
const EDGE = 40;

type Gesture =
  | {
      kind: 'move';
      x0: number;
      y0: number;
      moved: boolean;
      primary: Id;
      ids: Id[];
      origin: Map<Id, { start: Seconds; duration: Seconds; trackId: Id }>;
      points: Seconds[];
      clickReduce: boolean; // clicar sem mover num clipe já selecionado => seleção vira só ele
      lastDelta: Seconds;
      lastTrack?: Id;
      lastNew?: boolean;
    }
  | { kind: 'trim'; edge: 'start' | 'end'; x0: number; moved: boolean; clip: Clip; points: Seconds[]; min: Seconds; max: Seconds }
  | { kind: 'cap'; mode: 'cap-move' | 'cap-start' | 'cap-end'; x0: number; moved: boolean; id: Id; start: Seconds; end: Seconds; points: Seconds[]; min: Seconds; max: Seconds }
  | { kind: 'marquee'; x0: number; y0: number; moved: boolean; additive: boolean; base: Id[] }
  | { kind: 'scrub' };

function trackLabel(kind: TrackKind, p: Project): string {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  return `${kind === 'video' ? 'Vídeo' : kind === 'audio' ? 'Áudio' : 'Texto'} ${n}`;
}

export default function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const showNew = useTimelineUi((s) => s.drag?.mode === 'move' || !!s.dropHint);
  const viewW = useTimelineUi((s) => s.viewW);
  const setUi = useTimelineUi((s) => s.set);

  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPointer = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const anchor = useRef<{ t: Seconds; px: number } | null>(null);
  const edgeRaf = useRef(0);

  const rows = useMemo(() => rowLayout(project, showNew), [project, showNew]);
  const rowsRef = useRef<RowInfo[]>(rows);
  rowsRef.current = rows;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const duration = projectDuration(project);
  const laneW = Math.max((duration + Math.max(10, duration * 0.25)) * zoom, viewW - HEADER_W);
  const rowsH = rowsHeight(rows);

  /* ---------------- rolagem / tamanho visível ---------------- */

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setUi({ scrollLeft: el.scrollLeft, viewW: el.clientWidth }));
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [setUi]);

  /* ---------------- zoom ancorado ---------------- */

  const zoomTo = useCallback((z: number, clientX?: number) => {
    const el = scrollRef.current;
    const st = useEditor.getState();
    const cur = st.zoom;
    const next = Math.max(ZMIN, Math.min(ZMAX, z));
    if (!el || Math.abs(next - cur) < 1e-3) return;
    const rect = el.getBoundingClientRect();
    let px: number;
    let t: Seconds;
    if (clientX != null) {
      px = clientX - rect.left;
      t = (px + el.scrollLeft - HEADER_W) / cur;
    } else {
      const phx = HEADER_W + st.playhead * cur - el.scrollLeft;
      if (phx >= HEADER_W && phx <= el.clientWidth) {
        px = phx;
        t = st.playhead;
      } else {
        px = HEADER_W + (el.clientWidth - HEADER_W) / 2;
        t = (px + el.scrollLeft - HEADER_W) / cur;
      }
    }
    anchor.current = { t: Math.max(0, t), px };
    st.setZoom(next);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, HEADER_W + a.t * zoom - a.px);
  }, [zoom]);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = projectDuration(useEditor.getState().project);
    useEditor.getState().setZoom(fitZoom(d, el.clientWidth - HEADER_W - 24, ZMIN, ZMAX));
    requestAnimationFrame(() => (el.scrollLeft = 0));
  }, []);

  // Ctrl/Cmd + roda (inclui pinça do trackpad) => zoom; roda vertical sem estouro vertical => rolagem horizontal
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * 2);
        zoomTo(useEditor.getState().zoom * factor, e.clientX);
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollHeight <= el.clientHeight + 1) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    // Safari: gesto de pinça
    let gz = 0;
    const onGStart = (e: Event) => { e.preventDefault(); gz = useEditor.getState().zoom; };
    const onGChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number };
      zoomTo(gz * ge.scale, ge.clientX);
    };
    // pinça por toque (2 dedos)
    const touches = new Map<number, number>();
    let pinch0 = 0;
    let pinchZ = 0;
    const onTDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, e.clientX);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch0 = Math.abs(a - b);
        pinchZ = useEditor.getState().zoom;
      }
    };
    const onTMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, e.clientX);
      if (touches.size === 2 && pinch0 > 10) {
        const [a, b] = [...touches.values()];
        zoomTo(pinchZ * (Math.abs(a - b) / pinch0), (a + b) / 2);
      }
    };
    const onTUp = (e: PointerEvent) => touches.delete(e.pointerId);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGStart as EventListener);
    el.addEventListener('gesturechange', onGChange as EventListener);
    el.addEventListener('pointerdown', onTDown);
    el.addEventListener('pointermove', onTMove);
    el.addEventListener('pointerup', onTUp);
    el.addEventListener('pointercancel', onTUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGStart as EventListener);
      el.removeEventListener('gesturechange', onGChange as EventListener);
      el.removeEventListener('pointerdown', onTDown);
      el.removeEventListener('pointermove', onTMove);
      el.removeEventListener('pointerup', onTUp);
      el.removeEventListener('pointercancel', onTUp);
    };
  }, [zoomTo]);

  /* ---------------- comandos ---------------- */

  const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => emit('ep:toast', { text, kind });

  const split = useCallback((ids?: Id[]) => {
    const st = useEditor.getState();
    const ops = splitOps(st.project, ids ?? st.selection, st.playhead);
    if (!ops.length) return toast('Posicione o cursor sobre um clipe para dividir');
    st.dispatch(ops);
  }, []);

  const remove = useCallback((ids: Id[] | undefined, ripple: boolean) => {
    const st = useEditor.getState();
    const targets = ids ?? st.selection;
    if (!targets.length) {
      const cap = useTimelineUi.getState().captionSel;
      if (cap && st.project.captions.enabled) {
        st.dispatch({ op: 'set_captions', segments: st.project.captions.segments.filter((s) => s.id !== cap) });
        setUi({ captionSel: null });
      }
      return;
    }
    const ops = deleteOps(st.project, targets, ripple);
    if (!ops.length) return toast('Clipe travado — destrave a trilha para excluir');
    st.dispatch(ops);
    st.select([]);
  }, [setUi]);

  const duplicate = useCallback((ids?: Id[]) => {
    const st = useEditor.getState();
    const { ops, newIds } = duplicateOps(st.project, ids ?? st.selection);
    if (!ops.length) return;
    st.dispatch(ops);
    st.select(newIds);
  }, []);

  const toolbarActions = useMemo(
    () => ({ split: () => split(), remove: () => remove(undefined, false), zoomTo: (z: number) => zoomTo(z), fit }),
    [split, remove, zoomTo, fit],
  );
  const menuActions = useMemo(() => ({ split, duplicate, remove }), [split, duplicate, remove]);

  useShortcuts({
    split: () => split(),
    remove: (ripple) => remove(undefined, ripple),
    zoomBy: (f) => zoomTo(useEditor.getState().zoom * f),
    duplicate: () => duplicate(),
  });

  /* ---------------- coordenadas ---------------- */

  const toLocal = (clientX: number, clientY: number) => {
    const r = tracksRef.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    return { x, y, t: (x - HEADER_W) / zoomRef.current };
  };

  const snapPts = (p: Project, exclude: Id[]) => {
    if (!useTimelineUi.getState().snapping) return [];
    return collectSnapPoints(p, { exclude, playhead: useEditor.getState().playhead });
  };

  /* ---------------- gestos ---------------- */

  const applyMove = useCallback((clientX: number, clientY: number, shift: boolean) => {
    const g = gesture.current;
    if (!g || g.kind === 'scrub') return;
    const { x, y, t } = toLocal(clientX, clientY);
    const z = zoomRef.current;
    const ui = useTimelineUi.getState();
    if (!g.moved) {
      const dy = 'y0' in g ? Math.abs(y - g.y0) : 0;
      if (Math.abs(x - g.x0) < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      g.moved = true;
    }
    const thr = snapThreshold(z);
    const snapOn = ui.snapping && !shift; // Shift durante o arraste desliga o ímã temporariamente

    if (g.kind === 'move') {
      const p = useEditor.getState().project;
      const o = g.origin.get(g.primary)!;
      let delta = (x - g.x0) / z;
      const minStart = Math.min(...[...g.origin.values()].map((v) => v.start));
      delta = Math.max(delta, -minStart);
      let point: Seconds | undefined;
      if (snapOn) {
        const s = snapSpan(o.start + delta, o.duration, g.points, thr);
        if (s.point != null) {
          delta = Math.max(s.start - o.start, -minStart);
          point = s.point;
        }
      }
      let trackId: Id | undefined;
      let newTrack = false;
      if (g.ids.length === 1) {
        const f = findClip(p, g.primary)!;
        const row = rowAtY(rowsRef.current, y);
        if (row?.kind === 'new') newTrack = true;
        else if (row?.track && row.track.kind === trackKindFor(f.clip) && !row.track.locked) trackId = row.track.id;
        else trackId = o.trackId;
        if (!newTrack) {
          const tr = p.tracks.find((tt) => tt.id === trackId)!;
          if (overlaps(tr, o.start + delta, o.duration, [g.primary])) {
            const free = nearestFreeStart(tr, o.duration, o.start + delta, [g.primary]);
            delta = free - o.start;
            if (point != null && Math.abs(free - point) > 1e-6 && Math.abs(free + o.duration - point) > 1e-6) point = undefined;
          }
        }
      } else {
        // vários: para no primeiro choque com clipes não selecionados
        const ok = [...g.origin.entries()].every(([id, v]) => {
          const tr = p.tracks.find((tt) => tt.id === v.trackId)!;
          return !overlaps(tr, v.start + delta, v.duration, g.ids.concat(id));
        });
        if (!ok) {
          delta = g.lastDelta;
          point = undefined;
        }
      }
      g.lastDelta = delta;
      g.lastTrack = trackId;
      g.lastNew = newTrack;
      ui.set({
        drag: { mode: 'move', ids: g.ids, primary: g.primary, delta, trackId, newTrack },
        snapLine: point ?? null,
      });
    } else if (g.kind === 'trim') {
      const c = g.clip;
      const base = g.edge === 'start' ? c.start : clipEnd(c);
      let v = base + (x - g.x0) / z;
      let point: Seconds | undefined;
      if (snapOn) {
        const s = snapTime(v, g.points, thr);
        if (s.point != null) { v = s.t; point = s.point; }
      }
      const clamped = Math.max(g.min, Math.min(g.max, v));
      if (clamped !== v) point = undefined;
      ui.set({
        drag: g.edge === 'start'
          ? { mode: 'trim-start', id: c.id, start: clamped, end: clipEnd(c) }
          : { mode: 'trim-end', id: c.id, start: c.start, end: clamped },
        snapLine: point ?? null,
      });
    } else if (g.kind === 'cap') {
      const d = (x - g.x0) / z;
      let start = g.start;
      let end = g.end;
      let point: Seconds | undefined;
      if (g.mode === 'cap-move') {
        const len = g.end - g.start;
        let s0 = g.start + d;
        if (snapOn) {
          const s = snapSpan(s0, len, g.points, thr);
          if (s.point != null) { s0 = s.start; point = s.point; }
        }
        s0 = Math.max(g.min, Math.min(g.max - len, s0));
        start = s0;
        end = s0 + len;
      } else {
        let v = (g.mode === 'cap-start' ? g.start : g.end) + d;
        if (snapOn) {
          const s = snapTime(v, g.points, thr);
          if (s.point != null) { v = s.t; point = s.point; }
        }
        if (g.mode === 'cap-start') start = Math.max(g.min, Math.min(g.end - MIN_CLIP, v));
        else end = Math.min(g.max, Math.max(g.start + MIN_CLIP, v));
      }
      ui.set({ drag: { mode: g.mode, id: g.id, start, end }, snapLine: point ?? null });
    } else if (g.kind === 'marquee') {
      ui.set({ marquee: { x0: g.x0, y0: g.y0, x1: x, y1: y } });
      // seleção ao vivo
      const t0 = (Math.min(g.x0, x) - HEADER_W) / z;
      const t1 = (Math.max(g.x0, x) - HEADER_W) / z;
      const y0 = Math.min(g.y0, y);
      const y1 = Math.max(g.y0, y);
      const ids: Id[] = [];
      for (const r of rowsRef.current) {
        if (!r.track || r.track.locked || r.top + r.height < y0 || r.top > y1) continue;
        for (const c of r.track.clips) if (c.start < t1 && clipEnd(c) > t0) ids.push(c.id);
      }
      const sel = g.additive ? [...new Set([...g.base, ...ids])] : ids;
      useEditor.getState().select(sel);
    }
    void t;
  }, []);

  const edgeLoop = useCallback(() => {
    const el = scrollRef.current;
    const lp = lastPointer.current;
    const g = gesture.current;
    if (!g || g.kind === 'scrub') return;
    if (!el || !lp || !g.moved) {
      edgeRaf.current = requestAnimationFrame(edgeLoop);
      return;
    }
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (lp.x < r.left + HEADER_W + EDGE) dx = -Math.ceil((r.left + HEADER_W + EDGE - lp.x) / 4);
    else if (lp.x > r.right - EDGE) dx = Math.ceil((lp.x - (r.right - EDGE)) / 4);
    let dy = 0;
    const top = r.top + RULER_H;
    if (lp.y < top + EDGE / 2 && lp.y > r.top - EDGE) dy = -Math.ceil((top + EDGE / 2 - lp.y) / 4);
    else if (lp.y > r.bottom - EDGE / 2) dy = Math.ceil((lp.y - (r.bottom - EDGE / 2)) / 4);
    if (dx || dy) {
      const bx = el.scrollLeft;
      const by = el.scrollTop;
      if (dx) el.scrollLeft = Math.max(0, bx + dx);
      if (dy) el.scrollTop = Math.max(0, by + Math.max(-12, Math.min(12, dy)));
      if (el.scrollLeft !== bx || el.scrollTop !== by) applyMove(lp.x, lp.y, lp.shift);
    }
    edgeRaf.current = requestAnimationFrame(edgeLoop);
  }, [applyMove]);

  const endGesture = useCallback((commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(edgeRaf.current);
    window.removeEventListener('pointermove', onWinMove);
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinCancel);
    window.removeEventListener('keydown', onWinKey, true);
    const ui = useTimelineUi.getState();
    const drag = ui.drag;
    ui.set({ drag: null, snapLine: null, marquee: null });
    if (!g || !commit) return;
    const st = useEditor.getState();

    if (g.kind === 'move') {
      if (!g.moved) {
        if (g.clickReduce) st.select([g.primary]);
        return;
      }
      if (!drag || drag.mode !== 'move') return;
      const ops: EditOp[] = [];
      let newId: Id | undefined;
      if (drag.newTrack) {
        const f = findClip(st.project, g.primary)!;
        const kind = trackKindFor(f.clip);
        newId = uid(`track_${kind}`);
        ops.push({ op: 'add_track', track: { id: newId, kind, name: trackLabel(kind, st.project) } });
      }
      for (const id of g.ids) {
        const o = g.origin.get(id)!;
        const start = Math.max(0, o.start + drag.delta);
        const trackId = id === g.primary ? newId ?? drag.trackId : undefined;
        if (Math.abs(start - o.start) < 1e-6 && (!trackId || trackId === o.trackId)) continue;
        ops.push({ op: 'move_clip', clipId: id, start, ...(trackId && trackId !== o.trackId ? { trackId } : {}) });
      }
      if (ops.length) st.dispatch(ops);
    } else if (g.kind === 'trim') {
      if (!g.moved || !drag || (drag.mode !== 'trim-start' && drag.mode !== 'trim-end')) return;
      const c = g.clip;
      if (drag.mode === 'trim-start' && Math.abs(drag.start - c.start) > 1e-6) st.dispatch({ op: 'trim_clip', clipId: c.id, start: drag.start });
      if (drag.mode === 'trim-end' && Math.abs(drag.end - clipEnd(c)) > 1e-6) st.dispatch({ op: 'trim_clip', clipId: c.id, end: drag.end });
    } else if (g.kind === 'cap') {
      if (!g.moved || !drag || !drag.mode.startsWith('cap')) return;
      const d = drag as { start: number; end: number };
      const seg = st.project.captions.segments.find((s) => s.id === g.id);
      if (!seg) return;
      if (g.mode === 'cap-move') {
        const shift = d.start - seg.start;
        if (Math.abs(shift) < 1e-6) return;
        st.dispatch({
          op: 'update_caption',
          segmentId: g.id,
          patch: { start: d.start, end: d.end, ...(seg.words ? { words: seg.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift })) } : {}) },
        });
      } else if (g.mode === 'cap-start' && Math.abs(d.start - seg.start) > 1e-6) {
        st.dispatch({ op: 'update_caption', segmentId: g.id, patch: { start: d.start } });
      } else if (g.mode === 'cap-end' && Math.abs(d.end - seg.end) > 1e-6) {
        st.dispatch({ op: 'update_caption', segmentId: g.id, patch: { end: d.end } });
      }
    } else if (g.kind === 'marquee') {
      if (!g.moved) {
        const lp = lastPointer.current;
        if (!g.additive) st.select([]);
        ui.set({ captionSel: null });
        if (lp) {
          const { t } = toLocal(lp.x, lp.y);
          st.setPlayhead(toFrame(Math.max(0, t), st.project.fps));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // handlers de janela (estáveis via refs)
  const onWinMove = useRef((e: PointerEvent) => {
    lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    const g = gesture.current;
    if (g?.kind === 'scrub') {
      const { t } = toLocal(e.clientX, e.clientY);
      const st = useEditor.getState();
      st.setPlayhead(toFrame(Math.max(0, t), st.project.fps));
      return;
    }
    applyMoveRef.current(e.clientX, e.clientY, e.shiftKey);
  }).current;
  const onWinUp = useRef(() => endGestureRef.current(true)).current;
  const onWinCancel = useRef(() => endGestureRef.current(false)).current;
  const onWinKey = useRef((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endGestureRef.current(false);
    }
  }).current;
  const applyMoveRef = useRef(applyMove);
  applyMoveRef.current = applyMove;
  const endGestureRef = useRef(endGesture);
  endGestureRef.current = endGesture;

  const beginGesture = (g: Gesture, e: React.PointerEvent) => {
    gesture.current = g;
    lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinCancel);
    window.addEventListener('keydown', onWinKey, true);
    if (g.kind !== 'scrub') edgeRaf.current = requestAnimationFrame(edgeLoop);
  };

  useEffect(() => () => endGestureRef.current(false), []);

  const onTracksPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.current) return;
    if (e.pointerType === 'touch' && !e.isPrimary) return;
    const target = e.target as HTMLElement;
    if (target.closest('.ep-tl-head')) return;
    const st = useEditor.getState();
    const p = st.project;
    const { x, y } = toLocal(e.clientX, e.clientY);
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as 'start' | 'end' | undefined;
    const clipEl = target.closest<HTMLElement>('[data-clip-id]');
    const capEl = target.closest<HTMLElement>('[data-cap-id]');

    if (clipEl) {
      const id = clipEl.dataset.clipId!;
      const f = findClip(p, id);
      if (!f) return;
      e.preventDefault();
      setUi({ captionSel: null });
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      const was = st.selection.includes(id);
      let sel = st.selection;
      if (multi) sel = was ? sel.filter((s) => s !== id) : [...sel, id];
      else if (!was) sel = [id];
      st.select(sel);
      const locked = !!f.track.locked || !!f.clip.locked;
      if (locked || (multi && was)) return;

      if (handle) {
        const asset = 'assetId' in f.clip ? st.assets[f.clip.assetId] : undefined;
        const b = trimBounds(f.clip, f.track, asset, Math.max(MIN_CLIP, 1 / (p.fps || 30)));
        beginGesture(
          {
            kind: 'trim',
            edge: handle,
            x0: x,
            moved: false,
            clip: f.clip,
            points: snapPts(p, [id]),
            min: handle === 'start' ? b.minStart : b.minEnd,
            max: handle === 'start' ? b.maxStart : b.maxEnd,
          },
          e,
        );
        return;
      }
      const ids = sel.filter((sid) => {
        const ff = findClip(p, sid);
        return ff && !ff.track.locked && !ff.clip.locked;
      });
      const origin = new Map<Id, { start: Seconds; duration: Seconds; trackId: Id }>();
      for (const sid of ids) {
        const ff = findClip(p, sid)!;
        origin.set(sid, { start: ff.clip.start, duration: ff.clip.duration, trackId: ff.track.id });
      }
      beginGesture(
        { kind: 'move', x0: x, y0: y, moved: false, primary: id, ids, origin, points: snapPts(p, ids), clickReduce: was && !multi && sel.length > 1, lastDelta: 0 },
        e,
      );
      return;
    }

    if (capEl) {
      const id = capEl.dataset.capId!;
      const segs = [...p.captions.segments].sort((a, b) => a.start - b.start);
      const i = segs.findIndex((s) => s.id === id);
      if (i < 0) return;
      e.preventDefault();
      st.select([]);
      setUi({ captionSel: id });
      const seg = segs[i];
      const min = i > 0 ? Math.min(seg.start, segs[i - 1].end) : 0;
      const max = i < segs.length - 1 ? Math.max(seg.end, segs[i + 1].start) : Infinity;
      beginGesture(
        {
          kind: 'cap',
          mode: handle === 'start' ? 'cap-start' : handle === 'end' ? 'cap-end' : 'cap-move',
          x0: x,
          moved: false,
          id,
          start: seg.start,
          end: seg.end,
          points: snapPts(p, [id]),
          min,
          max,
        },
        e,
      );
      return;
    }

    if (x < HEADER_W) return;
    e.preventDefault();
    beginGesture({ kind: 'marquee', x0: x, y0: y, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey, base: st.selection }, e);
  };

  const onScrubStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const st = useEditor.getState();
    st.setPlaying(false);
    const { t } = toLocal(e.clientX, e.clientY);
    st.setPlayhead(toFrame(Math.max(0, t), st.project.fps));
    beginGesture({ kind: 'scrub' }, e);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const clipEl = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
    if (!clipEl) return;
    e.preventDefault();
    const id = clipEl.dataset.clipId!;
    const st = useEditor.getState();
    if (!st.selection.includes(id)) st.select([id]);
    setUi({ menu: { x: e.clientX, y: e.clientY, clipId: id } });
  };

  /* ---------------- soltar mídia da biblioteca ---------------- */

  const isAssetDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ASSET_MIME);
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const onDragOver = (e: React.DragEvent) => {
    if (!isAssetDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isAssetDrag(e)) return;
    const { y, t } = toLocal(e.clientX, e.clientY);
    let tt = Math.max(0, t);
    if (useTimelineUi.getState().snapping) tt = snapTime(tt, snapPts(useEditor.getState().project, []), snapThreshold(zoomRef.current)).t;
    const row = rowAtY(rowsRef.current, y);
    const prev = useTimelineUi.getState().dropHint;
    if (!prev || Math.abs(prev.t - tt) > 1e-4 || prev.rowId !== row?.id) setUi({ dropHint: { t: tt, rowId: row?.id } });
  };

  const onDragLeave = (e: React.DragEvent) => {
    const rel = e.relatedTarget as Node | null;
    if (rel && scrollRef.current?.contains(rel)) return;
    setUi({ dropHint: null });
  };

  const onDrop = (e: React.DragEvent) => {
    const hint = useTimelineUi.getState().dropHint;
    setUi({ dropHint: null });
    if (!isAssetDrag(e)) {
      if (e.dataTransfer.files?.length) {
        e.preventDefault();
        emit('ep:attach-files', { files: [...e.dataTransfer.files], role: 'source' });
      }
      return;
    }
    e.preventDefault();
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    const st = useEditor.getState();
    const asset = st.assets[assetId];
    if (!asset) return toast('Mídia não encontrada na biblioteca', 'error');
    const { y, t } = toLocal(e.clientX, e.clientY);
    const at = hint?.t ?? Math.max(0, t);
    const kind = kindForMedia(asset.kind);
    const dur = asset.kind === 'image' ? 3 : asset.duration > 0 ? asset.duration : 5;
    const row = rowAtY(rowsRef.current, y);
    const pl =
      row?.kind === 'new'
        ? { trackId: uid(`track_${kind}`), start: at, newTrack: true }
        : placeClip(st.project, kind, dur, at, row?.track?.id);
    const clip =
      asset.kind === 'video'
        ? makeVideoClip(asset, pl.start, { duration: dur })
        : asset.kind === 'audio'
          ? makeAudioClip(asset, pl.start, { duration: dur })
          : makeImageClip(asset, pl.start, dur);
    const ops: EditOp[] = [];
    if (pl.newTrack) ops.push({ op: 'add_track', track: { id: pl.trackId, kind, name: trackLabel(kind, st.project) } });
    ops.push({ op: 'add_clip', trackId: pl.trackId, clip, explain: `Adicionando ${asset.name}` });
    st.dispatch(ops);
    st.select([clip.id]);
  };

  /* ---------------- render ---------------- */

  const contentW = HEADER_W + laneW;
  const empty = project.tracks.every((t) => t.clips.length === 0) && project.captions.segments.length === 0;

  return (
    <div className="ep-tl">
      <Toolbar actions={toolbarActions} />
      <LiveBanner />
      <div className="ep-tl-scroll" ref={scrollRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className="ep-tl-content" style={{ width: contentW, height: RULER_H + rowsH }}>
          <Ruler zoom={zoom} width={laneW} onScrubStart={onScrubStart} />
          <div
            className="ep-tl-tracks"
            ref={tracksRef}
            style={{ height: rowsH, width: contentW }}
            onPointerDown={onTracksPointerDown}
            onContextMenu={onContextMenu}
          >
            <Rows rows={rows} zoom={zoom} width={laneW} />
            <DragLayer project={project} rows={rows} zoom={zoom} />
            <Guides zoom={zoom} height={rowsH} />
            <PlayheadLine zoom={zoom} height={rowsH} scrollRef={scrollRef} />
            {empty && (
              <div className="ep-tl-empty" style={{ left: HEADER_W }}>
                Arraste mídias da biblioteca para cá — ou descreva o vídeo no chat e deixe a IA montar a timeline.
              </div>
            )}
          </div>
        </div>
      </div>
      <ClipMenu actions={menuActions} />
    </div>
  );
}
