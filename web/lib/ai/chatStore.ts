'use client';
/* =====================================================================
   Estado do chat da IA (dono: módulo ai). As mensagens ficam no store
   central (useEditor.messages); aqui fica o que é só da UI do chat:
   narração por mensagem, passos ao vivo (op.explain), desfazer por edição.
   ===================================================================== */
import { create } from 'zustand';
import type { Id, Project } from '../types';
import type { EditOp } from '../ops';
import { useEditor } from '../store';
import { emit } from '../events';
import { getStatus, type AIStatus } from './client';
import { chatEdit, generateCaptions, runFirstEdit, type PipelineOptions, type PipelineResult } from './pipeline';

export type StepState = 'pending' | 'active' | 'done' | 'skipped';
export interface LiveStep { id: Id; text: string; state: StepState }

export interface RunState {
  /** o que está acontecendo agora ("Transcrevendo…") */
  phase?: string;
  progress?: number;
  /** etapas concluídas (✓) */
  log: string[];
  /** ops aplicadas ao vivo, uma a uma */
  steps: LiveStep[];
  before?: Project;
  after?: Project;
  error?: string;
  done: boolean;
}

interface AIChatState {
  status: AIStatus | null;
  busy: boolean;
  runs: Record<Id, RunState>;
  loadStatus: () => Promise<void>;
  send: (text: string) => Promise<void>;
  firstEdit: (brief: string) => Promise<void>;
  captions: (language?: string) => Promise<void>;
  /** desfaz a edição feita por uma mensagem (só se ela ainda for a última mudança) */
  undoRun: (msgId: Id) => void;
}

const editor = () => useEditor.getState();

export const useAIChat = create<AIChatState>((set, get) => {
  const patchRun = (id: Id, patch: Partial<RunState> | ((r: RunState) => Partial<RunState>)) =>
    set((s) => {
      const cur = s.runs[id] ?? { log: [], steps: [], done: false };
      const p = typeof patch === 'function' ? patch(cur) : patch;
      return { runs: { ...s.runs, [id]: { ...cur, ...p } } };
    });

  /** roda uma tarefa da IA narrando numa mensagem nova do assistente */
  async function run(intro: string, task: (o: PipelineOptions) => Promise<PipelineResult>) {
    if (get().busy) {
      emit('ep:toast', { text: 'A IA ainda está trabalhando — aguarde terminar.', kind: 'info' });
      return;
    }
    set({ busy: true });
    const msgId = editor().pushMessage({ role: 'assistant', text: '', status: 'pending' });
    patchRun(msgId, { phase: intro, log: [], steps: [], done: false, before: editor().project });

    const apply: PipelineOptions['apply'] = async (ops: EditOp[], o) => {
      const base = get().runs[msgId]?.steps.length ?? 0;
      const ids = ops.map((op, i) => op.id ?? `${msgId}_${base + i}`);
      const withIds = ops.map((op, i) => ({ ...op, id: ids[i] }));
      patchRun(msgId, (r) => ({ steps: [...r.steps, ...withIds.map((op) => ({ id: op.id!, text: op.explain || 'Editando', state: 'pending' as StepState }))] }));
      editor().updateMessage(msgId, { status: 'applying' });
      patchRun(msgId, { phase: 'Editando…', progress: undefined });
      const applied = await editor().applyLive(withIds, {
        ...o,
        onStep: (_op, i) =>
          patchRun(msgId, (r) => ({
            steps: r.steps.map((st) => (st.id === ids[i] ? { ...st, state: 'active' } : ids.slice(0, i).includes(st.id) && st.state === 'active' ? { ...st, state: 'done' } : st)),
          })),
      });
      const ok = new Set(applied);
      patchRun(msgId, (r) => ({ steps: r.steps.map((st) => (ids.includes(st.id) ? { ...st, state: ok.has(st.id) ? 'done' : 'skipped' } : st)) }));
      return applied;
    };

    try {
      const res = await task({
        apply,
        onStatus: (phase, progress) => patchRun(msgId, { phase, progress }),
        onLog: (line) => patchRun(msgId, (r) => ({ log: [...r.log, line] })),
      });
      const after = editor().project;
      const changed = !res.undo && after !== get().runs[msgId]?.before;
      patchRun(msgId, { phase: undefined, progress: undefined, done: true, after: changed ? after : undefined });
      editor().updateMessage(msgId, { text: res.reply, status: 'done', opIds: res.appliedIds });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchRun(msgId, { phase: undefined, progress: undefined, done: true, error: msg });
      editor().updateMessage(msgId, { text: `Não consegui concluir: ${msg}`, status: 'error' });
    } finally {
      set({ busy: false });
    }
  }

  return {
    status: null,
    busy: false,
    runs: {},

    loadStatus: async () => {
      set({ status: await getStatus(true) });
    },

    send: async (raw) => {
      const text = raw.trim();
      if (!text || get().busy) return;
      editor().pushMessage({ role: 'user', text, status: 'done' });
      await run('Pensando…', (o) => chatEdit(text, o));
    },

    firstEdit: async (brief) => {
      if (get().busy) return;
      if (brief.trim()) editor().pushMessage({ role: 'user', text: brief.trim(), status: 'done' });
      await run('Preparando a edição…', (o) => runFirstEdit({ ...o, brief }));
    },

    captions: async (language) => {
      if (get().busy) return;
      await run('Gerando legendas…', (o) => generateCaptions({ ...o, language }));
    },

    undoRun: (msgId) => {
      const r = get().runs[msgId];
      if (!r?.after || editor().project !== r.after) {
        emit('ep:toast', { text: 'Já houve outras mudanças depois desta edição — use o Desfazer do editor.', kind: 'info' });
        return;
      }
      editor().undo();
      patchRun(msgId, { after: undefined });
      editor().pushMessage({ role: 'system', text: 'Edição desfeita.', status: 'done' });
    },
  };
});
