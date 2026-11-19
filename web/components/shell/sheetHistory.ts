/* histórico do ToolSheet (✓ = 1 desfazer, ↺ = volta ao estado da abertura), identificado pela
   REFERÊNCIA do projeto na abertura — não pela contagem de `past`, que satura no limite (B4) */
import type { Project } from '@/lib/types';

export interface HistState { project: Project; past: Project[]; future: Project[] }

/** ↺: estado ao redefinir (null = nada a fazer) */
export function sheetReset(s: HistState, before: Project): Partial<HistState> | null {
  if (s.project === before) return null;
  const i = s.past.lastIndexOf(before);
  return { project: before, past: i >= 0 ? s.past.slice(0, i) : s.past, future: [] };
}

/** ✓: junta tudo o que o sheet fez num passo só (null = nada a mudar) */
export function sheetConfirm(s: HistState, before: Project, max = 100): Partial<HistState> | null {
  if (s.project === before) return null;
  const i = s.past.lastIndexOf(before);
  if (i >= 0) return i < s.past.length - 1 ? { past: s.past.slice(0, i + 1) } : null;
  // `before` saiu do histórico (mais de `max` mudanças no sheet): recoloca-o como o único passo
  return { past: [...s.past.slice(-(max - 1)), before] };
}
