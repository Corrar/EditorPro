'use client';
/* TODOS os atalhos de teclado do editor (registrados no window). */
import { useEffect, useRef } from 'react';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';
import { TOOL_LABEL, TRIM_TOOLS, useTimelineUi, type EditTool } from '@/lib/timeline/ui';
import { clipRangeAt, editPointNear, nextClipAt, shuttleNext } from '@/lib/timeline/nav';
import { expandGroups } from '@/lib/timeline/edit';
import { expandLinks } from '@/lib/timeline/trim';
import { nudgeSelection, splitAll, toggleLink } from '@/lib/timeline/actions';
import { emit } from '@/lib/events';

export interface ShortcutActions {
  split: () => void;
  remove: (ripple: boolean) => void;
  zoomBy: (factor: number) => void;
  duplicate: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  marker: () => void;
  comment: () => void;
  keyframe: () => void;
  fit: () => void;
}

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** controles que usam as teclas de navegação (sliders, selects, listas): as setas pertencem a eles */
export function isNavControl(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range') return true;
  const role = el.getAttribute('role');
  return role === 'slider' || role === 'spinbutton' || role === 'listbox' || role === 'option' || role === 'tab' || role === 'radio' || role === 'menuitem' || role === 'menuitemcheckbox';
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(type);
  }
  return false;
}

export function useShortcuts(actions: ShortcutActions) {
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if (NAV_KEYS.has(e.key) && isNavControl(e.target)) return; // setas num slider/select mudam o valor dele
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const a = ref.current;
      let handled = true;

      const ui = useTimelineUi.getState();
      const kl = k.length === 1 ? k.toLowerCase() : k;
      const setTool = (tool: EditTool) => {
        ui.set({ tool, bladeAt: null });
        emit('ep:toast', { text: `Ferramenta: ${TOOL_LABEL[tool]}`, kind: 'info' });
      };

      if (mod && e.shiftKey && e.code === 'KeyB') {
        splitAll();
      } else if (mod && !e.shiftKey && e.code === 'KeyB') {
        a.split();
      } else if (mod && e.altKey && e.code === 'KeyL') {
        toggleLink();
      } else if (mod && (k === 'z' || k === 'Z')) {
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && (k === 'y' || k === 'Y')) {
        st.redo();
      } else if (mod && (k === 'd' || k === 'D')) {
        a.duplicate();
      } else if (mod && (k === 'c' || k === 'C') && !e.shiftKey) {
        if (window.getSelection()?.toString()) handled = false; // deixa copiar texto selecionado
        else a.copy();
      } else if (mod && (k === 'x' || k === 'X')) {
        a.cut();
      } else if (mod && (k === 'v' || k === 'V')) {
        a.paste();
      } else if (mod && (k === 'a' || k === 'A')) {
        st.select(st.project.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))));
      } else if (mod) {
        handled = false; // deixa Ctrl+C, Ctrl+R etc. para o navegador
      } else if (k === ' ' || e.code === 'Space') {
        if (ui.shuttle) ui.set({ shuttle: 0 });
        st.setPlaying(!st.playing);
      } else if (k === '?' || (e.shiftKey && e.code === 'Slash')) {
        ui.set({ helpOpen: !ui.helpOpen });
      } else if (e.altKey && e.code === 'KeyX') {
        ui.set({ range: null, rangePop: null });
      } else if (e.altKey) {
        handled = false; // Alt+tecla (acentos no Mac) fica com o sistema
      } else if (kl === 'a') {
        setTool('select');
      } else if (kl === 'b') {
        setTool('blade');
      } else if (kl === 't') {
        const i = TRIM_TOOLS.indexOf(ui.tool);
        setTool(TRIM_TOOLS[(i + 1) % TRIM_TOOLS.length]);
      } else if (kl === 'k' && e.shiftKey) {
        a.keyframe();
      } else if (kl === 'j' || kl === 'k' || kl === 'l') {
        const next = shuttleNext(ui.shuttle || (st.playing ? 1 : 0), kl);
        ui.set({ shuttle: next });
      } else if (kl === 'i' || kl === 'o') {
        const t = st.playhead;
        const r = ui.range;
        const dur = projectDuration(st.project);
        const range = kl === 'i'
          ? { start: t, end: r && r.end > t + 0.01 ? r.end : Math.max(t + 0.01, dur) }
          : { start: r && r.start < t - 0.01 ? r.start : 0, end: Math.max(t, 0.01) };
        ui.set({ range, rangePop: null });
      } else if (kl === 'x') {
        const r = clipRangeAt(st.project, st.playhead, st.selection);
        if (r) ui.set({ range: r, rangePop: null });
      } else if (kl === 'z' && e.shiftKey) {
        a.fit();
      } else if (kl === 'v') {
        const id = nextClipAt(st.project, st.playhead, st.selection);
        if (id) st.select(expandLinks(st.project, expandGroups(st.project, [id])));
        else emit('ep:toast', { text: 'Nenhum clipe sob o cursor', kind: 'info' });
      } else if (kl === 'n') {
        ui.set({ snapping: !ui.snapping });
        emit('ep:toast', { text: ui.snapping ? 'Ímã desligado' : 'Ímã ligado', kind: 'info' });
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        const t = editPointNear(st.project, st.playhead, k === 'ArrowDown' ? 1 : -1);
        if (t != null) {
          st.setPlaying(false);
          st.setPlayhead(t);
        }
      } else if (k === ',' || k === '.' || k === '<' || k === '>') {
        const dir = k === ',' || k === '<' ? -1 : 1;
        nudgeSelection(dir * (e.shiftKey ? 5 : 1));
      } else if (k === 's' || k === 'S') {
        a.split();
      } else if (k === 'm' || k === 'M') {
        a.marker();
      } else if (k === 'c' || k === 'C') {
        a.comment();
      } else if (k === 'Delete' || k === 'Backspace') {
        a.remove(e.shiftKey);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const step = e.shiftKey ? 1 : 1 / (st.project.fps || 30);
        const dir = k === 'ArrowLeft' ? -1 : 1;
        const fps = st.project.fps || 30;
        st.setPlaying(false);
        st.setPlayhead(Math.round((st.playhead + dir * step) * fps) / fps);
      } else if (k === 'Home') {
        st.setPlayhead(0);
      } else if (k === 'End') {
        st.setPlayhead(projectDuration(st.project));
      } else if (k === '+' || k === '=') {
        a.zoomBy(1.25);
      } else if (k === '-' || k === '_') {
        a.zoomBy(1 / 1.25);
      } else if (k === 'Escape') {
        if (ui.helpOpen) ui.set({ helpOpen: false });
        else if (ui.shuttle) ui.set({ shuttle: 0 });
        else if (st.selection.length) st.select([]);
        else handled = false;
      } else handled = false;

      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Shuttle J/K/L: 1× usa a reprodução normal (com áudio); 2×/4×/8× e ré andam o playhead
 * por rAF (o preview acompanha como scrub, sem áudio).
 */
export function useShuttle() {
  const shuttle = useTimelineUi((s) => s.shuttle);
  useEffect(() => {
    const st = useEditor.getState();
    if (shuttle === 0) {
      if (st.playing) st.setPlaying(false);
      return;
    }
    if (shuttle === 1) {
      st.setPlaying(true);
      // se a reprodução parar por outro motivo (fim, Espaço, botão), o shuttle zera
      return useEditor.subscribe((s, prev) => {
        if (prev.playing && !s.playing && useTimelineUi.getState().shuttle === 1) useTimelineUi.getState().set({ shuttle: 0 });
      });
    }
    st.setPlaying(false);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useEditor.getState();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dur = projectDuration(s.project);
      const t = s.playhead + dt * shuttle;
      if (t <= 0 || t >= dur) {
        s.setPlayhead(Math.max(0, Math.min(dur, t)));
        useTimelineUi.getState().set({ shuttle: 0 });
        return;
      }
      s.setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // qualquer play normal interrompe o shuttle rápido
    const unsub = useEditor.subscribe((s, prev) => {
      if (!prev.playing && s.playing) useTimelineUi.getState().set({ shuttle: 0 });
    });
    return () => { cancelAnimationFrame(raf); unsub(); };
  }, [shuttle]);
}
