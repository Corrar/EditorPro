'use client';
import { useCallback } from 'react';
import { findClip } from '@/lib/ops';
import { useEditor } from '@/lib/store';
import type { Clip } from '@/lib/types';

/** clipe selecionado (o primeiro da seleção) + trilha */
export function useSelectedClip() {
  const project = useEditor((s) => s.project);
  const sel = useEditor((s) => s.selection);
  return sel.length ? findClip(project, sel[0]) : null;
}

/** aplica patch no clipe via update_clip (history controlado pelo controle) */
export function useClipPatch(clipId: string | undefined) {
  const dispatch = useEditor((s) => s.dispatch);
  return useCallback(
    (patch: Partial<Clip> & Record<string, unknown>, history = true) => {
      if (!clipId) return;
      dispatch({ op: 'update_clip', clipId, patch }, { history });
    },
    [clipId, dispatch],
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const secs = (v: number) => `${v.toFixed(1)}s`;
export const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
