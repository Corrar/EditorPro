/* =====================================================================
   Resumo da edição ao vivo (puro, testado) — usado pelo pop-up da IA e
   pela pílula "IA editando 3/8" que o shell mostra sobre o preview.
   ===================================================================== */
import type { ChatMessage, Id } from '../types';
import type { RunState } from './chatStore';

export interface LiveSummary {
  /** id da mensagem do assistente da última execução (se houver) */
  msgId?: Id;
  working: boolean;
  done: number;
  total: number;
  phase?: string;
  /** a IA fez uma pergunta e espera resposta */
  waiting: boolean;
  error?: string;
}

export function liveSummary(messages: ChatMessage[], runs: Record<Id, RunState>): LiveSummary {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const r = runs[m.id];
    if (!r) continue;
    const done = r.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
    return { msgId: m.id, working: !r.done, done, total: r.steps.length, phase: r.phase, waiting: !!r.question, error: r.error };
  }
  return { working: false, done: 0, total: 0, waiting: false };
}

/** texto curto da pílula */
export function liveLabel(s: LiveSummary): string {
  if (s.waiting) return 'IA aguardando você';
  if (s.working) return s.total ? `IA editando ${s.done}/${s.total}` : (s.phase?.replace(/…$/, '') || 'IA trabalhando') + '…';
  if (s.error) return 'IA: erro — toque para ver';
  if (s.total) return `IA: ${s.done} edições feitas`;
  return 'Editar com IA';
}
