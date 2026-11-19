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
import { applyOps, clipEnd, findClip, opFocus, projectDuration, trackKindFor, type EditOp } from '@/lib/ops';
import { aiTargetFor } from '@/lib/aiCursor';
import { makeAudioClip, makeImageClip, makeVideoClip } from '@/lib/defaults';
import { emit } from '@/lib/events';
import { uid } from '@/lib/util';
import { collectSnapPoints, snapSpan, snapThreshold, snapTime } from '@/lib/timeline/snap';
import {
  MIN_CLIP, expandGroups, fitZoom, insertOps, markerSnapPoints, kindForMedia, magneticInsertTime, magneticOrder, mainTrackId, overlaps, overwriteOps, packOps,
  placeClip, toFrame, trimBounds,
} from '@/lib/timeline/edit';
import {
  addMarker, commit as commitOps, copyClips, cutClips, duplicateClips, pasteClips, removeClips, splitAtPlayhead, toggleKeyframe,
} from '@/lib/timeline/actions';
import { type RowInfo, dimsFor, fillRowHeights, rowAtY, rowLayout, rowsHeight, useDims, useTimelineUi } from '@/lib/timeline/ui';
import { CenterOverlay, Toolbar, ZMAX, ZMIN } from './Toolbar';
import { Ruler } from './Ruler';
import { COVER_MARKER_ID, DragLayer, GroupOutlines, Guides, KeyframeLayer, PlayheadLine, Rows, TouchHandles } from './Rows';
import { ClipMenu, LiveBanner, ShortcutsHelp, TrackPop, TrimMonitor } from './Overlays';
import { useShortcuts, useShuttle } from './useShortcuts';
import { MarkerLines, MarkerPop, RangePop } from './Markers';
import { Minimap } from './Minimap';
import { keyframesOf, moveKeyframeOps } from '@/lib/timeline/keyframes';
import { assetOf } from '@/lib/timeline/clip';
import { expandLinks, linkedEdgePartners, monitorFrames, overridesAfter, proSession, type ProSession, type TrimTool } from '@/lib/timeline/trim';

const ASSET_MIME = 'application/x-ep-asset';
const DRAG_THRESHOLD = 4;
const EDGE = 40;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 450;

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
  | { kind: 'trim'; edge: 'start' | 'end'; x0: number; moved: boolean; clip: Clip; points: Seconds[]; min: Seconds; max: Seconds; partners: Clip[] }
  | { kind: 'cap'; mode: 'cap-move' | 'cap-start' | 'cap-end'; x0: number; moved: boolean; id: Id; start: Seconds; end: Seconds; points: Seconds[]; min: Seconds; max: Seconds }
  | { kind: 'marquee'; x0: number; y0: number; moved: boolean; additive: boolean; base: Id[] }
  | { kind: 'scrub' }
  /** toque: decide no soltar (tocar = selecionar / mover playhead); se o dedo andar, o navegador rola */
  | { kind: 'tap'; x0: number; y0: number; moved: boolean; clipId?: Id; capId?: Id }
  | { kind: 'marker'; x0: number; moved: boolean; id: Id; t0: Seconds; end0?: Seconds; points: Seconds[] }
  | { kind: 'range'; x0: number; moved: boolean; t0: Seconds; points: Seconds[] }
  | { kind: 'kf'; x0: number; moved: boolean; clipId: Id; index: number; start: Seconds; dur: Seconds; t0: Seconds; points: Seconds[] }
  | { kind: 'reorder'; x0: number; y0: number; moved: boolean; trackId: Id; overId?: Id }
  /** trims profissionais (ripple/roll/slip/slide) */
  | { kind: 'pro'; x0: number; moved: boolean; s: ProSession; ops: EditOp[] };

/** durações dos clipes de ÁUDIO antes de um aparo (p/ refazer a música do catálogo depois) */
function durationsOf(p: Project, ids: Id[]): Map<Id, Seconds> {
  const m = new Map<Id, Seconds>();
  for (const id of ids) {
    const c = findClip(p, id)?.clip;
    if (c?.type === 'audio') m.set(id, c.duration);
  }
  return m;
}

/** música do catálogo aparada: re-renderiza no tamanho novo (termina no compasso, com final), no mesmo desfazer */
function refitMusic(before: Map<Id, Seconds>) {
  if (!before.size) return;
  const p = useEditor.getState().project;
  const changed: [Id, Seconds][] = [];
  for (const [id, d0] of before) {
    const c = findClip(p, id)?.clip;
    if (c && Math.abs(c.duration - d0) > 1e-3) changed.push([id, c.duration]);
  }
  if (!changed.length) return;
  void import('@/lib/music/insert')
    .then(({ refitMusicClip }) => Promise.all(changed.map(([id, d]) => refitMusicClip(id, d, { history: false }))))
    .catch(() => {});
}

function trackLabel(kind: TrackKind, p: Project): string {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  return `${kind === 'video' ? 'Vídeo' : kind === 'audio' ? 'Áudio' : 'Texto'} ${n}`;
}

/** estado vazio centralizado na área VISÍVEL (não no conteúdo inteiro, que pode ser mais largo) */
function EmptyHint({ compact, headerW }: { compact: boolean; headerW: number }) {
  const scrollLeft = useTimelineUi((s) => s.scrollLeft);
  const viewW = useTimelineUi((s) => s.viewW);
  return (
    <div className="ep-tl-empty" style={{ left: headerW + scrollLeft, width: Math.max(120, viewW - headerW) }}>
      {compact ? 'Adicione mídia pela aba Mídia' : 'Arraste mídias da biblioteca para cá — ou descreva o vídeo no chat e a IA monta a timeline.'}
    </div>
  );
}

export default function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const showNew = useTimelineUi((s) => s.drag?.mode === 'move' || !!s.dropHint);
  const viewW = useTimelineUi((s) => s.viewW);
  const showMinimap = useTimelineUi((s) => s.showMinimap);
  const setUi = useTimelineUi((s) => s.set);
  const tool = useTimelineUi((s) => s.tool);
  const dims = useDims();
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const hw = () => dimsRef.current.headerW;
  const cancelLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPointer = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const anchor = useRef<{ t: Seconds; px: number } | null>(null);
  const edgeRaf = useRef(0);

  const viewH = useTimelineUi((s) => s.viewH);
  const rowH = useMemo(
    () => (dims.compact ? fillRowHeights(dims.rowH, project, viewH - dims.rulerH - 4, dims.center ? 1.25 : 1.6) : dims.rowH),
    // só a estrutura de trilhas importa para as alturas
    [dims.compact, dims.rowH, dims.rulerH, viewH, project.tracks.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rows = useMemo(() => rowLayout(project, showNew, rowH), [project, showNew, rowH]);
  const rowsRef = useRef<RowInfo[]>(rows);
  rowsRef.current = rows;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const duration = projectDuration(project);
  const laneW = dims.center
    ? duration * zoom + Math.max(viewW / 2, 120) + 72 // até o fim chegar ao centro (+ botão "+")
    : Math.max((duration + Math.max(10, duration * 0.25)) * zoom, viewW - hw());
  const rowsH = rowsHeight(rows);

  // migração: capa guardada como marcador 'cover' (antes de Project.coverTime) -> coverTime
  useEffect(() => {
    const legacy = project.markers?.find((m) => m.id === COVER_MARKER_ID);
    if (!legacy) return;
    const ops: EditOp[] = [];
    if (project.coverTime == null) ops.push({ op: 'set_project', patch: { coverTime: legacy.t } });
    ops.push({ op: 'remove_marker', markerId: COVER_MARKER_ID });
    useEditor.getState().dispatch(ops, { history: false });
  }, [project.markers, project.coverTime]);

  /* ---------------- cursor da IA (v2.4) ----------------
     window.__epTimeToClientX(t): x na tela do tempo t (null se fora da área visível das trilhas);
     a cada op da IA, revela o alvo (tempo/clipe) ANTES do cursor chegar (rolagem instantânea). */
  useEffect(() => {
    const w = window as unknown as { __epTimeToClientX?: (t: number) => number | null };
    const fn = (t: number) => {
      const el = scrollRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + hw() + t * zoomRef.current - el.scrollLeft;
      const minX = r.left + (dimsRef.current.center ? 0 : hw());
      return x >= minX - 0.5 && x <= r.left + el.clientWidth + 0.5 ? x : null;
    };
    w.__epTimeToClientX = fn;
    const reveal = (op: EditOp) => {
      const el = scrollRef.current;
      if (!el) return;
      const st = useEditor.getState();
      const p = st.project;
      const target = aiTargetFor(p, op);
      const focusClip = target?.kind === 'clip' ? target.clipId : opFocus(p, op).clipId;
      const f = focusClip ? findClip(p, focusClip) : null;
      const t0 = target?.kind === 'time' ? target.t : f ? f.clip.start : opFocus(p, op).time;
      // horizontal (no modo centro quem segue é o playhead, que o applyLive já move)
      if (t0 != null && !dimsRef.current.center) {
        const z = zoomRef.current;
        const x = hw() + t0 * z;
        const left = el.scrollLeft + hw() + 24;
        const right = el.scrollLeft + el.clientWidth - 48;
        if (x < left || x > right) el.scrollLeft = Math.max(0, x - hw() - (el.clientWidth - hw()) * 0.3);
      }
      setUi({ scrollLeft: el.scrollLeft, viewH: el.clientHeight }); // virtualização renderiza o alvo já
      // vertical: a linha da trilha do clipe
      if (f) {
        const row = rowsRef.current.find((r) => r.id === f.track.id);
        if (row) {
          const top = dimsRef.current.rulerH + row.top;
          if (top < el.scrollTop + dimsRef.current.rulerH || top + row.height > el.scrollTop + el.clientHeight) {
            el.scrollTop = Math.max(0, top - dimsRef.current.rulerH - 12);
          }
        }
      }
    };
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.live.running && s.live.current && s.live.current !== prev.live.current) reveal(s.live.current);
    });
    return () => {
      unsub();
      if (w.__epTimeToClientX === fn) delete w.__epTimeToClientX;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // desfazer/refazer/IA podem remover clipes selecionados: poda a seleção
  useEffect(() => {
    const st = useEditor.getState();
    if (!st.selection.length) return;
    const alive = st.selection.filter((id) => findClip(project, id));
    if (alive.length !== st.selection.length) st.select(alive);
  }, [project]);

  /* ---------------- medir o próprio contêiner (responsivo) ---------------- */

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = dimsFor(r.width, r.height, !!mq?.matches);
      const cur = useTimelineUi.getState().dims;
      if (next.compact !== cur.compact || next.barCompact !== cur.barCompact || next.short !== cur.short || next.coarse !== cur.coarse || next.headerW !== cur.headerW) setUi({ dims: next });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    mq?.addEventListener?.('change', measure);
    return () => {
      ro.disconnect();
      mq?.removeEventListener?.('change', measure);
    };
  }, [setUi]);

  /* ---------------- rolagem / tamanho visível ---------------- */

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setUi({ scrollLeft: el.scrollLeft, viewW: el.clientWidth, viewH: el.clientHeight }));
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

  /* ---------------- modo celular (CapCut): playhead fixo no centro ----------------
     playhead -> rolagem (reprodução, IA, teclado) e rolagem nativa (com inércia) -> playhead. */
  const progScroll = useRef<number | null>(null);
  const userScrolling = useRef(false);
  const dragLock = useRef(false);
  const centerScrollFor = (el: HTMLElement, t: Seconds) => Math.max(0, hw() + t * zoomRef.current - el.clientWidth / 2);
  const placeCenter = (t: Seconds) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = centerScrollFor(el, t);
    if (Math.abs(el.scrollLeft - target) < 0.5) return;
    progScroll.current = target;
    el.scrollLeft = target;
    // virtualização acompanha já (sem esperar o rAF do evento de rolagem)
    setUi({ scrollLeft: el.scrollLeft });
  };
  useEffect(() => {
    if (!dims.center) return;
    const el = scrollRef.current;
    if (!el) return;
    placeCenter(useEditor.getState().playhead);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.playhead !== prev.playhead && !userScrolling.current) placeCenter(s.playhead);
    });
    const onScroll = () => {
      if (progScroll.current != null && Math.abs(el.scrollLeft - progScroll.current) < 1.5) return;
      progScroll.current = null;
      if (dragLock.current || zoomGesture.current) return;
      const st = useEditor.getState();
      const t = Math.max(0, Math.min(projectDuration(st.project), (el.scrollLeft + el.clientWidth / 2 - hw()) / zoomRef.current));
      userScrolling.current = true;
      if (st.playing) st.setPlaying(false); // o dedo assumiu: pausa (como no CapCut)
      st.setPlayhead(t);
      userScrolling.current = false;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      unsub();
      el.removeEventListener('scroll', onScroll);
    };
  }, [dims.center, dims.headerW]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- zoom ancorado ---------------- */

  /** zoom pedido mas ainda não aplicado (vários eventos de roda/pinça viram 1 render por quadro) */
  const pendingZoom = useRef<{ z: number; clientX?: number } | null>(null);
  const zoomRaf = useRef(0);
  /** gesto de zoom contínuo (roda/pinça): prévia por transform sem render; aplica no fim */
  const zoomGesture = useRef<{ base: number; k: number; origin: number; clientX: number; timer: number; els: HTMLElement[] } | null>(null);
  const targetZoom = () =>
    zoomGesture.current ? zoomGesture.current.base * zoomGesture.current.k : pendingZoom.current?.z ?? useEditor.getState().zoom;

  const commitZoomPreview = () => {
    const g = zoomGesture.current;
    const root = rootRef.current;
    zoomGesture.current = null;
    if (!g) return;
    root?.classList.remove('zooming');
    for (const e of g.els) { e.style.transform = ''; e.style.transformOrigin = ''; }
    applyZoom(Math.max(ZMIN, Math.min(ZMAX, g.base * g.k)), g.clientX);
  };

  const previewZoom = (z: number, clientX: number) => {
    const el = scrollRef.current;
    const root = rootRef.current;
    if (!el || !root) return zoomTo(z, clientX);
    let g = zoomGesture.current;
    if (!g) {
      const rect = el.getBoundingClientRect();
      const origin = Math.max(0, clientX - rect.left + el.scrollLeft - hw());
      // transform direto nos ~10 elementos (variável CSS no raiz recalcularia o estilo da árvore toda)
      const els = [...root.querySelectorAll<HTMLElement>('.ep-tl-lane, .ep-tl-scale')];
      for (const e of els) e.style.transformOrigin = `${origin}px 0`;
      g = zoomGesture.current = { base: useEditor.getState().zoom, k: 1, origin, clientX, timer: 0, els };
      root.classList.add('zooming');
    }
    g.k = Math.max(ZMIN, Math.min(ZMAX, z)) / g.base;
    const tf = `scaleX(${g.k})`;
    for (const e of g.els) e.style.transform = tf;
    clearTimeout(g.timer);
    g.timer = window.setTimeout(commitZoomPreview, 140);
  };

  const zoomTo = useCallback((z: number, clientX?: number) => {
    pendingZoom.current = { z: Math.max(ZMIN, Math.min(ZMAX, z)), clientX };
    if (zoomRaf.current) return;
    zoomRaf.current = requestAnimationFrame(() => {
      zoomRaf.current = 0;
      const pz = pendingZoom.current;
      pendingZoom.current = null;
      if (pz) applyZoom(pz.z, pz.clientX);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyZoom = (next: number, clientX?: number) => {
    const el = scrollRef.current;
    const st = useEditor.getState();
    const cur = st.zoom;
    if (!el || Math.abs(next - cur) < 1e-3) return;
    const rect = el.getBoundingClientRect();
    let px: number;
    let t: Seconds;
    if (clientX != null) {
      px = clientX - rect.left;
      t = (px + el.scrollLeft - hw()) / cur;
    } else {
      const phx = hw() + st.playhead * cur - el.scrollLeft;
      if (phx >= hw() && phx <= el.clientWidth) {
        px = phx;
        t = st.playhead;
      } else {
        px = hw() + (el.clientWidth - hw()) / 2;
        t = (px + el.scrollLeft - hw()) / cur;
      }
    }
    anchor.current = { t: Math.max(0, t), px };
    st.setZoom(next);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el) return;
    if (dimsRef.current.center) {
      anchor.current = null;
      progScroll.current = null;
      placeCenter(useEditor.getState().playhead);
      return;
    }
    if (!a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, hw() + a.t * zoom - a.px);
  }, [zoom]);

  const previewZoomRef = useRef(previewZoom);
  previewZoomRef.current = previewZoom;

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const d = projectDuration(useEditor.getState().project);
    useEditor.getState().setZoom(fitZoom(d, el.clientWidth - hw() - 24, ZMIN, ZMAX));
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
        previewZoomRef.current(targetZoom() * factor, anchorX(e.clientX));
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollHeight <= el.clientHeight + 1) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    /** no modo centro o zoom sempre ancora no playhead central */
    const anchorX = (x: number) => {
      if (!dimsRef.current.center) return x;
      const r = el.getBoundingClientRect();
      return r.left + el.clientWidth / 2;
    };
    // Safari: gesto de pinça
    let gz = 0;
    const onGStart = (e: Event) => { e.preventDefault(); gz = useEditor.getState().zoom; };
    const onGChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number };
      previewZoomRef.current(gz * ge.scale, anchorX(ge.clientX));
    };
    // pinça por toque (2 dedos) — Touch Events seguem chegando mesmo quando o navegador rola
    let pinch0 = 0;
    let pinchZ = 0;
    const dist = (t: TouchList) => Math.abs(t[0].clientX - t[1].clientX) + Math.abs(t[0].clientY - t[1].clientY) * 0.25;
    const onTStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch0 = dist(e.touches);
        pinchZ = useEditor.getState().zoom;
        cancelLongPress();
        endGestureRef.current(false);
      }
    };
    const onTMove = (e: TouchEvent) => {
      if (dragLock.current) { e.preventDefault(); return; } // arrastando clipe (toque longo): não rola
      if (e.touches.length !== 2 || pinch0 < 10) return;
      e.preventDefault();
      const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      previewZoomRef.current(pinchZ * (dist(e.touches) / pinch0), anchorX(mid));
    };
    const onTEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch0 = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGStart as EventListener);
    el.addEventListener('gesturechange', onGChange as EventListener);
    el.addEventListener('touchstart', onTStart, { passive: true });
    el.addEventListener('touchmove', onTMove, { passive: false });
    el.addEventListener('touchend', onTEnd);
    el.addEventListener('touchcancel', onTEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGStart as EventListener);
      el.removeEventListener('gesturechange', onGChange as EventListener);
      el.removeEventListener('touchstart', onTStart);
      el.removeEventListener('touchmove', onTMove);
      el.removeEventListener('touchend', onTEnd);
      el.removeEventListener('touchcancel', onTEnd);
    };
  }, [zoomTo]);

  /* ---------------- comandos ---------------- */

  const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => emit('ep:toast', { text, kind });

  const split = useCallback((ids?: Id[]) => splitAtPlayhead(ids), []);
  const remove = useCallback((ids: Id[] | undefined, ripple: boolean) => removeClips(ids, ripple), []);
  const duplicate = useCallback((ids?: Id[]) => duplicateClips(ids), []);

  const toolbarActions = useMemo(
    () => ({
      split: () => split(),
      remove: () => remove(undefined, false),
      zoomTo: (z: number) => zoomTo(z),
      fit,
      duplicate: () => duplicate(),
      rippleRemove: () => remove(undefined, true),
      marker: () => openNewMarkerRef.current('user'),
      comment: () => openNewMarkerRef.current('comment'),
    }),
    [split, remove, zoomTo, fit, duplicate],
  );
  const menuActions = useMemo(() => ({ split, duplicate, remove }), [split, duplicate, remove]);

  useShortcuts({
    split: () => split(),
    remove: (ripple) => remove(undefined, ripple),
    zoomBy: (f) => zoomTo(targetZoom() * f),
    duplicate: () => duplicate(),
    copy: () => copyClips(),
    cut: () => cutClips(),
    paste: () => pasteClips(),
    marker: () => openNewMarker('user'),
    comment: () => openNewMarker('comment'),
    keyframe: () => toggleKeyframe(),
    fit: () => fit(),
  });
  useShuttle();

  const openNewMarkerRef = useRef<(k: 'user' | 'comment') => void>(() => {});
  openNewMarkerRef.current = (k) => openNewMarker(k);
  /** cria marcador/comentário no playhead e abre o popover para editar o texto */
  const openNewMarker = (kind: 'user' | 'comment') => {
    const id = addMarker(kind);
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + hw() + useEditor.getState().playhead * zoomRef.current - el.scrollLeft;
    setUi({ markerPop: { id, x: Math.max(r.left + 8, Math.min(x, r.right - 8)), y: r.top + dimsRef.current.rulerH + 4, isNew: true } });
  };

  /* ---------------- coordenadas ---------------- */

  const toLocal = (clientX: number, clientY: number) => {
    const r = tracksRef.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    return { x, y, t: (x - hw()) / zoomRef.current };
  };

  const snapPts = (p: Project, exclude: Id[]) => {
    if (!useTimelineUi.getState().snapping) return [];
    return collectSnapPoints(p, { exclude, playhead: useEditor.getState().playhead, extra: markerSnapPoints(p, useEditor.getState().assets, exclude) });
  };

  /* ---------------- gestos ---------------- */

  const applyMove = useCallback((clientX: number, clientY: number, shift: boolean) => {
    const g = gesture.current;
    if (!g || g.kind === 'scrub') return;
    const { x, y, t } = toLocal(clientX, clientY);
    if (g.kind === 'tap') {
      if (!g.moved && Math.hypot(x - g.x0, y - g.y0) > TOUCH_SLOP) {
        g.moved = true;
        cancelLongPress();
      }
      return;
    }
    const z = zoomRef.current;
    const ui = useTimelineUi.getState();
    if (!g.moved) {
      const dy = 'y0' in g ? Math.abs(y - g.y0) : 0;
      if (Math.abs(x - g.x0) < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      g.moved = true;
      cancelLongPress();
    }
    const thr = snapThreshold(z);
    const snapOn = ui.snapping && !shift; // Shift durante o arraste desliga o ímã temporariamente

    if (g.kind === 'marker') {
      let tt = Math.max(0, g.t0 + (x - g.x0) / z);
      let point: Seconds | undefined;
      if (snapOn) {
        const sn = snapTime(tt, g.points, thr);
        if (sn.point != null) { tt = sn.t; point = sn.point; }
      }
      const end = g.end0 != null ? g.end0 + (tt - g.t0) : undefined;
      ui.set({ drag: { mode: 'marker', id: g.id, t: tt, end }, snapLine: point ?? null });
      return;
    }
    if (g.kind === 'range') {
      let tt = Math.max(0, t);
      if (ui.snapping) tt = snapTime(tt, g.points, thr).t;
      ui.set({ range: { start: Math.min(g.t0, tt), end: Math.max(g.t0, tt) } });
      return;
    }
    if (g.kind === 'kf') {
      let tt = g.t0 + (x - g.x0) / z; // tempo global
      let point: Seconds | undefined;
      if (snapOn) {
        const sn = snapTime(tt, g.points, thr);
        if (sn.point != null) { tt = sn.t; point = sn.point; }
      }
      const rel = Math.max(0, Math.min(g.dur, tt - g.start));
      ui.set({ drag: { mode: 'keyframe', clipId: g.clipId, index: g.index, t: rel }, snapLine: point ?? null });
      return;
    }
    if (g.kind === 'reorder') {
      const row = rowAtY(rowsRef.current, y);
      const over = row?.track && row.track.id !== g.trackId ? row.track.id : undefined;
      if (over !== g.overId) {
        g.overId = over;
        ui.set({ reorderOver: over ?? null });
      }
      return;
    }

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
          if (ui.magnetic && trackId === mainTrackId(p)) {
            // trilha magnética: mostra onde o clipe entra na sequência
            const order = magneticOrder(tr, g.primary, o.start + delta, o.duration);
            point = magneticInsertTime(tr, order, g.primary);
          } else if (overlaps(tr, o.start + delta, o.duration, [g.primary])) {
            // inserir/sobrescrever: a guia marca o ponto de edição
            point = o.start + delta;
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
    } else if (g.kind === 'pro') {
      const s = g.s;
      let d = (x - g.x0) / z;
      let point: Seconds | undefined;
      if (snapOn && s.snapRefs.length) {
        const pts = snapPts(useEditor.getState().project, s.touched);
        let best: { d: number; point: number; dist: number } | null = null;
        for (const ref of s.snapRefs) {
          const r = snapTime(ref + d, pts, thr);
          if (r.point != null) {
            const dist = Math.abs(r.t - (ref + d));
            if (!best || dist < best.dist) best = { d: r.t - ref, point: r.point, dist };
          }
        }
        if (best) { d = best.d; point = best.point; }
      }
      const cd = Math.max(s.range.min, Math.min(s.range.max, d));
      if (cd !== d) point = undefined;
      const p0 = useEditor.getState().project;
      const ops = s.build(cd);
      let after = p0;
      try { after = applyOps(p0, ops).project; } catch { return; }
      g.ops = ops;
      ui.set({
        drag: { mode: 'pro', tool: s.tool, clipId: s.clipId, over: overridesAfter(after, s.touched), frames: monitorFrames(after, s), delta: cd },
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
      const t0 = (Math.min(g.x0, x) - hw()) / z;
      const t1 = (Math.max(g.x0, x) - hw()) / z;
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
    if (!g || g.kind === 'scrub' || g.kind === 'tap') return;
    if (!el || !lp || !g.moved) {
      edgeRaf.current = requestAnimationFrame(edgeLoop);
      return;
    }
    const r = el.getBoundingClientRect();
    let dx = 0;
    // no modo centro o "cabeçalho" é meia tela de espaço: a borda é só a borda real
    const leftEdge = r.left + (dimsRef.current.center ? 0 : hw()) + EDGE;
    if (lp.x < leftEdge) dx = -Math.ceil((leftEdge - lp.x) / 4);
    else if (lp.x > r.right - EDGE) dx = Math.ceil((lp.x - (r.right - EDGE)) / 4);
    let dy = 0;
    const top = r.top + dimsRef.current.rulerH;
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
    if (dragLock.current && dimsRef.current.center) {
      // a rolagem de borda pode ter andado durante o arraste: o tempo sob o centro passa a ser o playhead
      const el = scrollRef.current;
      if (el) {
        const st0 = useEditor.getState();
        st0.setPlayhead(Math.max(0, (el.scrollLeft + el.clientWidth / 2 - hw()) / zoomRef.current));
      }
    }
    dragLock.current = false;
    cancelLongPress();
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
        if (g.clickReduce) st.select(expandLinks(st.project, expandGroups(st.project, [g.primary])));
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
      if (g.ids.length === 1 && !drag.newTrack) {
        const id = g.primary;
        const o = g.origin.get(id)!;
        const start = Math.max(0, o.start + drag.delta);
        const target = drag.trackId ?? o.trackId;
        const move: EditOp = { op: 'move_clip', clipId: id, start, ...(target !== o.trackId ? { trackId: target } : {}) };
        const tr = st.project.tracks.find((t) => t.id === target)!;
        if (ui.magnetic && target === mainTrackId(st.project)) {
          const mid = applyOps(st.project, [move]).project;
          const mainAfter = mid.tracks.find((t) => t.id === target)!;
          ops.push(move, ...packOps(mainAfter, magneticOrder(mainAfter, id, start, o.duration)));
        } else if (overlaps(tr, start, o.duration, [id])) {
          const pre = ui.dropMode === 'insert' ? insertOps(tr, start, o.duration, [id]) : overwriteOps(tr, start, start + o.duration, [id]);
          ops.push(...pre, move);
        } else if (Math.abs(start - o.start) > 1e-6 || target !== o.trackId) ops.push(move);
      } else {
        for (const id of g.ids) {
          const o = g.origin.get(id)!;
          const start = Math.max(0, o.start + drag.delta);
          const trackId = id === g.primary ? newId ?? drag.trackId : undefined;
          if (Math.abs(start - o.start) < 1e-6 && (!trackId || trackId === o.trackId)) continue;
          ops.push({ op: 'move_clip', clipId: id, start, ...(trackId && trackId !== o.trackId ? { trackId } : {}) });
        }
      }
      if (ops.length) commitOps(ops);
    } else if (g.kind === 'trim') {
      if (!g.moved || !drag || (drag.mode !== 'trim-start' && drag.mode !== 'trim-end')) return;
      const c = g.clip;
      // pontas vinculadas (áudio do vídeo) acompanham; Alt no início do arraste = J/L-cut
      const ids = [c, ...g.partners];
      const before = durationsOf(st.project, ids.map((x) => x.id));
      if (drag.mode === 'trim-start' && Math.abs(drag.start - c.start) > 1e-6) {
        const d = drag.start - c.start;
        commitOps(ids.map((x) => ({ op: 'trim_clip', clipId: x.id, start: x.start + d }) as EditOp));
      }
      if (drag.mode === 'trim-end' && Math.abs(drag.end - clipEnd(c)) > 1e-6) {
        const d = drag.end - clipEnd(c);
        commitOps(ids.map((x) => ({ op: 'trim_clip', clipId: x.id, end: clipEnd(x) + d }) as EditOp));
      }
      refitMusic(before);
    } else if (g.kind === 'pro') {
      if (g.moved && g.ops.length) {
        const before = durationsOf(st.project, g.s.touched);
        commitOps(g.ops);
        refitMusic(before);
      }
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
    } else if (g.kind === 'marker') {
      if (!g.moved) {
        const lp = lastPointer.current;
        ui.set({ markerPop: { id: g.id, x: lp?.x ?? 0, y: (lp?.y ?? 0) + 14 } });
        return;
      }
      if (drag?.mode === 'marker' && Math.abs(drag.t - g.t0) > 1e-6)
        st.dispatch({ op: 'update_marker', markerId: g.id, patch: { t: drag.t, ...(drag.end != null ? { end: drag.end } : {}) } });
    } else if (g.kind === 'range') {
      const r = useTimelineUi.getState().range;
      const lp = lastPointer.current;
      if (!g.moved || !r || r.end - r.start < 1 / (st.project.fps || 30)) {
        ui.set({ range: null, rangePop: null });
        st.setPlayhead(toFrame(g.t0, st.project.fps));
      } else ui.set({ rangePop: { x: lp?.x ?? 0, y: (lp?.y ?? 0) + 14 } });
    } else if (g.kind === 'kf') {
      if (!g.moved) {
        st.setPlayhead(toFrame(g.t0, st.project.fps));
        return;
      }
      if (drag?.mode === 'keyframe') st.dispatch(moveKeyframeOps(st.project, g.clipId, g.index, drag.t));
    } else if (g.kind === 'reorder') {
      ui.set({ reorderOver: null });
      if (!g.moved || !g.overId) return;
      const target = st.project.tracks.findIndex((t) => t.id === g.overId);
      if (target >= 0) st.dispatch({ op: 'move_track', trackId: g.trackId, index: target, explain: 'Reordenando trilhas' });
    } else if (g.kind === 'tap') {
      if (g.moved) return;
      if (g.clipId) {
        st.select(expandGroups(st.project, [g.clipId]));
        ui.set({ captionSel: null });
      } else if (g.capId) {
        st.select([]);
        ui.set({ captionSel: g.capId });
      } else {
        st.select([]);
        ui.set({ captionSel: null });
        const lp = lastPointer.current;
        if (lp && !dimsRef.current.center) {
          const { t } = toLocal(lp.x, lp.y);
          st.setPlayhead(toFrame(Math.max(0, t), st.project.fps));
        }
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
    if (g.kind !== 'scrub' && g.kind !== 'tap') edgeRaf.current = requestAnimationFrame(edgeLoop);
  };

  /** toque longo (~450 ms) no clipe abre o menu de contexto (substitui o botão direito) */
  const startLongPress = (e: React.PointerEvent, target: { clipId?: Id; capId?: Id }) => {
    cancelLongPress();
    const x = e.clientX;
    const y = e.clientY;
    longPress.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        longPress.current = null;
        const g = gesture.current;
        if (g && g.kind !== 'scrub' && g.moved) return;
        endGestureRef.current(false);
        const st = useEditor.getState();
        if (target.clipId && !st.selection.includes(target.clipId)) st.select(expandGroups(st.project, [target.clipId]));
        if (target.capId) setUi({ captionSel: target.capId });
        try { navigator.vibrate?.(12); } catch {}
        setUi({ menu: { x: x + 10, y: y + 10, ...target, touch: true } });
      }, LONG_PRESS_MS),
    };
  };

  /** modo centro: toque longo no clipe = pegar e arrastar (o arraste comum navega no tempo) */
  const startLongDrag = (e: React.PointerEvent, clipId: Id) => {
    cancelLongPress();
    const cx = e.clientX;
    const cy = e.clientY;
    longPress.current = {
      x: cx,
      y: cy,
      timer: window.setTimeout(() => {
        longPress.current = null;
        const g0 = gesture.current;
        if (g0 && g0.kind !== 'scrub' && g0.moved) return;
        endGestureRef.current(false);
        const st = useEditor.getState();
        const p = st.project;
        if (!st.selection.includes(clipId)) st.select(expandLinks(p, expandGroups(p, [clipId])));
        const ids = useEditor.getState().selection.filter((sid) => {
          const ff = findClip(p, sid);
          return ff && !ff.track.locked && !ff.clip.locked;
        });
        if (!ids.includes(clipId)) return;
        const origin = new Map<Id, { start: Seconds; duration: Seconds; trackId: Id }>();
        for (const sid of ids) {
          const ff = findClip(p, sid)!;
          origin.set(sid, { start: ff.clip.start, duration: ff.clip.duration, trackId: ff.track.id });
        }
        const { x, y } = toLocal(cx, cy);
        dragLock.current = true;
        try { navigator.vibrate?.(15); } catch {}
        gesture.current = { kind: 'move', x0: x, y0: y, moved: false, primary: clipId, ids, origin, points: snapPts(p, ids), clickReduce: false, lastDelta: 0 };
        lastPointer.current = { x: cx, y: cy, shift: false };
        window.addEventListener('pointermove', onWinMove);
        window.addEventListener('pointerup', onWinUp);
        window.addEventListener('pointercancel', onWinCancel);
        window.addEventListener('keydown', onWinKey, true);
        edgeRaf.current = requestAnimationFrame(edgeLoop);
      }, LONG_PRESS_MS),
    };
  };

  useEffect(() => () => endGestureRef.current(false), []);

  /** lâmina: corta o clipe (e os vinculados, salvo com Alt) no ponto clicado, com ímã */
  const bladeAt = (t: Seconds) => {
    const ui = useTimelineUi.getState();
    if (!ui.snapping) return t;
    const r = snapTime(t, snapPts(useEditor.getState().project, []), snapThreshold(zoomRef.current));
    return r.point != null ? r.t : t;
  };
  const bladeCut = (clipId: Id, t0: Seconds, alt: boolean) => {
    const st = useEditor.getState();
    const p = st.project;
    const t = bladeAt(t0);
    const fps = p.fps || 30;
    const at = Math.round(t * fps) / fps;
    const ops: EditOp[] = [];
    for (const id of alt ? [clipId] : expandLinks(p, [clipId])) {
      const f = findClip(p, id);
      if (!f || f.track.locked || f.clip.locked) continue;
      if (at > f.clip.start + 1e-3 && at < clipEnd(f.clip) - 1e-3) ops.push({ op: 'split_clip', clipId: id, at, newId: uid('clip') });
    }
    if (ops.length) commitOps(ops);
  };
  const onTracksHover = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || gesture.current) return;
    const ui = useTimelineUi.getState();
    if (ui.tool !== 'blade') { if (ui.bladeAt) ui.set({ bladeAt: null }); return; }
    const clipEl = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
    if (!clipEl) { if (ui.bladeAt) ui.set({ bladeAt: null }); return; }
    const { t } = toLocal(e.clientX, e.clientY);
    ui.set({ bladeAt: { t: bladeAt(t), clipId: clipEl.dataset.clipId! } });
  };

  const onTracksPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.current) return;
    if (e.pointerType === 'touch' && !e.isPrimary) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, .ep-tl-lead')) return; // botões dentro das trilhas ("+ Adicionar…", Capa, IA)
    const headEl = target.closest<HTMLElement>('.ep-tl-head');
    if (headEl) {
      // arrastar o cabeçalho (fora dos botões) reordena as trilhas
      const tid = headEl.dataset.trackId;
      if (tid && !target.closest('button, input') && e.pointerType === 'mouse') {
        const { x: hx, y: hy } = toLocal(e.clientX, e.clientY);
        beginGesture({ kind: 'reorder', x0: hx, y0: hy, moved: false, trackId: tid }, e);
      }
      return;
    }
    const st = useEditor.getState();
    const p = st.project;
    const { x, y, t } = toLocal(e.clientX, e.clientY);
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as 'start' | 'end' | undefined;
    const clipEl = target.closest<HTMLElement>('[data-clip-id]');
    const capEl = target.closest<HTMLElement>('[data-cap-id]');
    // toque/caneta: tocar seleciona; arrastar só move o que JÁ está selecionado (senão o dedo rola a timeline)
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';

    const kfEl = target.closest<HTMLElement>('[data-kf]');
    if (kfEl) {
      const [cid, idx] = kfEl.dataset.kf!.split('|');
      const f = findClip(p, cid);
      const kf = f && keyframesOf(f.clip)[+idx];
      if (f && kf) {
        e.preventDefault();
        beginGesture({ kind: 'kf', x0: x, moved: false, clipId: cid, index: +idx, start: f.clip.start, dur: f.clip.duration, t0: f.clip.start + kf.t, points: snapPts(p, []) }, e);
        return;
      }
    }

    const center = dimsRef.current.center;
    const tool = useTimelineUi.getState().tool;
    if (clipEl && tool === 'blade') {
      e.preventDefault();
      bladeCut(clipEl.dataset.clipId!, t, e.altKey);
      return;
    }
    const proTool = tool !== 'select';
    if (clipEl && touch && !handle && (center || !st.selection.includes(clipEl.dataset.clipId!)) && !(proTool && st.selection.includes(clipEl.dataset.clipId!))) {
      beginGesture({ kind: 'tap', x0: x, y0: y, moved: false, clipId: clipEl.dataset.clipId! }, e);
      if (center) startLongDrag(e, clipEl.dataset.clipId!);
      else startLongPress(e, { clipId: clipEl.dataset.clipId! });
      return;
    }
    if (capEl && touch && !handle && (center || useTimelineUi.getState().captionSel !== capEl.dataset.capId)) {
      beginGesture({ kind: 'tap', x0: x, y0: y, moved: false, capId: capEl.dataset.capId! }, e);
      startLongPress(e, { capId: capEl.dataset.capId! });
      return;
    }

    if (clipEl) {
      const id = clipEl.dataset.clipId!;
      const f = findClip(p, id);
      if (!f) return;
      e.preventDefault();
      if (touch && !handle) startLongPress(e, { clipId: id });
      setUi({ captionSel: null });
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      const was = st.selection.includes(id);
      // grupo (modelo): seleciona todos os clipes juntos; Alt = só este
      const unit = e.altKey ? [id] : expandLinks(p, expandGroups(p, [id]));
      let sel = st.selection;
      if (multi) sel = was ? sel.filter((s) => !unit.includes(s)) : [...new Set([...sel, ...unit])];
      else if (!was || (e.altKey && sel.length > 1) || (!e.altKey && unit.some((u) => !sel.includes(u)))) sel = unit;
      st.select(sel);
      const locked = !!f.track.locked || !!f.clip.locked;
      if (locked || (multi && was)) return;

      const tool = useTimelineUi.getState().tool;
      if (tool !== 'select' && tool !== 'blade') {
        const r = clipEl.getBoundingClientRect();
        const near: 'start' | 'end' = handle ?? (e.clientX < r.left + r.width / 2 ? 'start' : 'end');
        const minDur = Math.max(MIN_CLIP, 1 / (p.fps || 30));
        let s = proSession(p, st.assets, tool as TrimTool, id, near, e.altKey, minDur);
        if (!s && tool === 'roll') s = proSession(p, st.assets, 'roll', id, near === 'start' ? 'end' : 'start', e.altKey, minDur);
        if (!s) {
          toast(tool === 'roll' ? 'Roll precisa de dois clipes encostados' : tool === 'slip' ? 'Slip funciona em vídeo e áudio' : 'Não dá para usar esta ferramenta aqui', 'info');
          return;
        }
        beginGesture({ kind: 'pro', x0: x, moved: false, s, ops: [] }, e);
        return;
      }

      if (handle) {
        const asset = assetOf(f.clip, st.assets);
        const minDur = Math.max(MIN_CLIP, 1 / (p.fps || 30));
        const b = trimBounds(f.clip, f.track, asset, minDur);
        const base = handle === 'start' ? f.clip.start : clipEnd(f.clip);
        let min = handle === 'start' ? b.minStart : b.minEnd;
        let max = handle === 'start' ? b.maxStart : b.maxEnd;
        // pontas vinculadas aparam junto: a faixa é a interseção (Alt = só este, J/L-cut)
        const partners = e.altKey ? [] : linkedEdgePartners(p, id, handle);
        for (const c of partners) {
          const pf = findClip(p, c.id)!;
          const pb = trimBounds(c, pf.track, assetOf(c, st.assets), minDur);
          const pbase = handle === 'start' ? c.start : clipEnd(c);
          min = Math.max(min, base + (handle === 'start' ? pb.minStart : pb.minEnd) - pbase);
          max = Math.min(max, base + (handle === 'start' ? pb.maxStart : pb.maxEnd) - pbase);
        }
        beginGesture(
          {
            kind: 'trim',
            edge: handle,
            x0: x,
            moved: false,
            clip: f.clip,
            points: snapPts(p, [id, ...partners.map((c) => c.id)]),
            min: Math.min(min, base),
            max: Math.max(max, base),
            partners,
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
      if (touch && !handle) startLongPress(e, { capId: id });
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

    if (x < hw()) return;
    if (touch) {
      beginGesture({ kind: 'tap', x0: x, y0: y, moved: false }, e);
      return;
    }
    e.preventDefault();
    beginGesture({ kind: 'marquee', x0: x, y0: y, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey, base: st.selection }, e);
  };

  const onScrubStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // modo centro no toque: arrastar a régua também navega (rolagem nativa)
    if (dimsRef.current.center && e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('[data-marker-id]')) return;
    e.preventDefault();
    const st = useEditor.getState();
    const { x: lx, t: lt } = toLocal(e.clientX, e.clientY);
    const mkEl = (e.target as HTMLElement).closest<HTMLElement>('[data-marker-id]');
    if (mkEl) {
      const m = st.project.markers?.find((mm) => mm.id === mkEl.dataset.markerId);
      if (m) {
        beginGesture({ kind: 'marker', x0: lx, moved: false, id: m.id, t0: m.t, end0: m.end, points: snapPts(st.project, [m.id]) }, e);
        return;
      }
    }
    if (e.shiftKey || useTimelineUi.getState().rangeMode) {
      const t0 = Math.max(0, lt);
      setUi({ range: { start: t0, end: t0 }, rangePop: null });
      beginGesture({ kind: 'range', x0: lx, moved: false, t0, points: snapPts(st.project, []) }, e);
      return;
    }
    st.setPlaying(false);
    const { t } = toLocal(e.clientX, e.clientY);
    st.setPlayhead(toFrame(Math.max(0, t), st.project.fps));
    beginGesture({ kind: 'scrub' }, e);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const capEl = (e.target as HTMLElement).closest<HTMLElement>('[data-cap-id]');
    if (capEl) {
      e.preventDefault();
      setUi({ captionSel: capEl.dataset.capId!, menu: { x: e.clientX, y: e.clientY, capId: capEl.dataset.capId! } });
      return;
    }
    const clipEl = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
    if (!clipEl) return;
    e.preventDefault();
    const id = clipEl.dataset.clipId!;
    const st = useEditor.getState();
    if (!st.selection.includes(id)) st.select(e.altKey ? [id] : expandGroups(st.project, [id]));
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
    const ui = useTimelineUi.getState();
    const hostable = row?.track && row.track.kind === kind && !row.track.locked ? row.track : undefined;
    const pl =
      row?.kind === 'new'
        ? { trackId: uid(`track_${kind}`), start: at, newTrack: true }
        : hostable
          ? { trackId: hostable.id, start: at, newTrack: false }
          : placeClip(st.project, kind, dur, at, row?.track?.id);
    const clip =
      asset.kind === 'video'
        ? makeVideoClip(asset, pl.start, { duration: dur })
        : asset.kind === 'audio'
          ? makeAudioClip(asset, pl.start, { duration: dur })
          : makeImageClip(asset, pl.start, dur);
    const ops: EditOp[] = [];
    if (pl.newTrack) ops.push({ op: 'add_track', track: { id: pl.trackId, kind, name: trackLabel(kind, st.project) } });
    const add: EditOp = { op: 'add_clip', trackId: pl.trackId, clip, explain: `Adicionando ${asset.name}` };
    if (hostable && ui.magnetic && hostable.id === mainTrackId(st.project)) {
      const mid = applyOps(st.project, [add]).project;
      const mainAfter = mid.tracks.find((t) => t.id === hostable.id)!;
      ops.push(add, ...packOps(mainAfter, magneticOrder(mainAfter, clip.id, at, dur)));
    } else if (hostable && overlaps(hostable, at, dur)) {
      ops.push(...(ui.dropMode === 'insert' ? insertOps(hostable, at, dur) : overwriteOps(hostable, at, at + dur)), add);
    } else ops.push(add);
    commitOps(ops);
    st.select([clip.id]);
  };

  /* ---------------- render ---------------- */

  const contentW = hw() + laneW;
  const empty = project.tracks.every((t) => t.clips.length === 0) && project.captions.segments.length === 0;

  return (
    <div
      ref={rootRef}
      data-tool={tool}
      className={`ep-tl${dims.compact ? ' compact' : ''}${dims.center ? ' center' : ''}${dims.short ? ' short' : ''}${dims.coarse ? ' coarse' : ''}`}
      style={{ ['--tl-head' as string]: `${dims.headerW}px`, ['--tl-ruler' as string]: `${dims.rulerH}px` }}
    >
      {!dims.center && <Toolbar actions={toolbarActions} />}
      <LiveBanner />
      {showMinimap && !dims.short && !dims.center && <Minimap scrollRef={scrollRef} />}
      <div className="ep-tl-scrollwrap">
      {dims.center && <CenterOverlay actions={toolbarActions} />}
      <TrimMonitor />
      <div className="ep-tl-scroll" ref={scrollRef} data-ep-timeline onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className="ep-tl-content" style={{ width: contentW, height: dimsRef.current.rulerH + rowsH }}>
          <Ruler zoom={zoom} width={laneW} onScrubStart={onScrubStart} />
          <div
            className="ep-tl-tracks"
            ref={tracksRef}
            style={{ height: rowsH, width: contentW }}
            onPointerDown={onTracksPointerDown}
            onPointerMove={onTracksHover}
            onPointerLeave={() => useTimelineUi.getState().bladeAt && setUi({ bladeAt: null })}
            onContextMenu={onContextMenu}
          >
            <Rows rows={rows} zoom={zoom} width={laneW} />
            <DragLayer project={project} rows={rows} zoom={zoom} />
            <Guides zoom={zoom} height={rowsH} />
            <PlayheadLine zoom={zoom} height={rowsH} scrollRef={scrollRef} />
            <TouchHandles project={project} rows={rows} zoom={zoom} />
            <KeyframeLayer project={project} rows={rows} zoom={zoom} />
            <GroupOutlines project={project} rows={rows} zoom={zoom} />
            <MarkerLines zoom={zoom} height={rowsH} headerW={dims.headerW} />
            {empty && !dims.center && <EmptyHint compact={dims.compact} headerW={dims.headerW} />}
          </div>
        </div>
      </div>
      </div>
      <ClipMenu actions={menuActions} />
      <MarkerPop />
      <RangePop />
      <TrackPop />
      <ShortcutsHelp />
    </div>
  );
}
