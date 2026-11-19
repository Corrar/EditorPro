'use client';
/* =====================================================================
   Estado da grade do clipe selecionado + escrita via dispatch.
   Convenção dos painéis: o 1º passo de um gesto vai COM histórico, os
   seguintes sem — um arraste = um desfazer.
   ===================================================================== */
import { useCallback, useRef } from 'react';
import { useEditor } from '@/lib/store';
import { findClip } from '@/lib/ops';
import type { Clip, ColorGrade, Id } from '@/lib/types';
import { gradesEqual, normalizeGrade } from '@/lib/color/grade';

export type GradableClip = Extract<Clip, { type: 'video' | 'image' | 'adjustment' }>;
export const isGradable = (c?: Clip | null): c is GradableClip => !!c && (c.type === 'video' || c.type === 'image' || c.type === 'adjustment');

/** clipe selecionado que aceita correção de cor */
export function useGradableSelection(): GradableClip | null {
  const project = useEditor((s) => s.project);
  const sel = useEditor((s) => s.selection);
  for (const id of sel) {
    const f = findClip(project, id);
    if (f && isGradable(f.clip)) return f.clip;
  }
  return null;
}

/** grava a grade (normalizada) num clipe */
export function writeGrade(clipId: Id, grade: ColorGrade | undefined, history: boolean): boolean {
  const st = useEditor.getState();
  const f = findClip(st.project, clipId);
  if (!f || !isGradable(f.clip)) return false;
  const next = normalizeGrade(grade);
  if (gradesEqual(f.clip.colorGrade, next)) return false;
  st.dispatch({ op: 'update_clip', clipId, patch: { colorGrade: next } }, { history });
  return true;
}

/** API de edição: set(fn, gesto) onde gesto = 'start' | 'move' | 'end' | 'once' */
export function useGradeEditor(clip: GradableClip | null) {
  const clipId = clip?.id;
  const grade: ColorGrade = clip?.colorGrade ?? {};
  const needHistory = useRef(false);
  const inGesture = useRef(false);

  const set = useCallback((fn: (g: ColorGrade) => ColorGrade, phase: 'start' | 'move' | 'end' | 'once' = 'once') => {
    if (!clipId) return;
    const cur = useEditor.getState();
    const f = findClip(cur.project, clipId);
    const base = (f && isGradable(f.clip) ? f.clip.colorGrade : undefined) ?? {};
    const next = fn(base);
    if (phase === 'start') needHistory.current = true;
    // o 1º passo que MUDA algo no gesto leva o histórico; 'once' sempre leva
    const history = phase === 'once' || needHistory.current || (phase === 'move' && !inGesture.current);
    if (phase === 'start' || phase === 'move') inGesture.current = true;
    if (writeGrade(clipId, next, history)) needHistory.current = false;
    if (phase === 'end' || phase === 'once') { inGesture.current = false; needHistory.current = false; }
  }, [clipId]);

  return { grade, set };
}
