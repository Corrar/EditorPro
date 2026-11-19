'use client';
/* TODOS os atalhos de teclado do editor (registrados no window). */
import { useEffect, useRef } from 'react';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';

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

      if (mod && (k === 'z' || k === 'Z')) {
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
        st.setPlaying(!st.playing);
      } else if (k === 's' || k === 'S') {
        a.split();
      } else if (k === 'm' || k === 'M') {
        a.marker();
      } else if (k === 'c' || k === 'C') {
        a.comment();
      } else if (k === 'k' || k === 'K') {
        a.keyframe();
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
        if (st.selection.length) st.select([]);
        else handled = false;
      } else handled = false;

      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
