'use client';
/* =====================================================================
   Estado do chat da IA (dono: módulo ai). As mensagens ficam no store
   central (useEditor.messages); aqui fica o que é só da UI do chat:
   narração por mensagem, passos ao vivo (op.explain), desfazer por edição.
   ===================================================================== */
import { create } from 'zustand';
import type { ChatContext, Id, Project } from '../types';
import type { EditOp } from '../ops';
import { useEditor } from '../store';
import { emit } from '../events';
import { getStatus, type AIStatus } from './client';
import { AI_CURSOR_STEP_MS } from '../aiCursor';
import { orderForViewing, shortExplain } from './order';
import { applyComments, chatEdit, generateCaptions, runFirstEdit, type AskOption, type PipelineOptions, type PipelineResult } from './pipeline';

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
  /** pergunta pendente ao usuário (botões no chat) */
  question?: { text: string; options: AskOption[] };
  /** etapa em andamento que pode ser pulada (ex.: "Pular transcrição") */
  skipLabel?: string;
}

interface AIChatState {
  status: AIStatus | null;
  busy: boolean;
  runs: Record<Id, RunState>;
  loadStatus: () => Promise<void>;
  /** envia um pedido; usa (e limpa) o contexto apontado no editor (store.chatContext) */
  send: (text: string) => Promise<void>;
  /** aplica os comentários de revisão pendentes (marcadores kind 'comment') */
  comments: (markerIds?: Id[]) => Promise<void>;
  firstEdit: (brief: string) => Promise<void>;
  captions: (language?: string) => Promise<void>;
  /** desfaz a edição feita por uma mensagem (só se ela ainda for a última mudança) */
  undoRun: (msgId: Id) => void;
  /** responde a uma pergunta feita pela IA no chat */
  answer: (msgId: Id, optionId: string) => void;
  /** pula a etapa em andamento (ex.: transcrição) */
  skip: (msgId: Id) => void;
  /** transcrição local com Whisper ligada? (preferência do aparelho) */
  whisper: boolean;
  setWhisper: (on: boolean) => void;
  /** ritmo da edição ao vivo: false = 900 ms por passo (dá para ver o cursor da IA), true = 350 ms */
  fast: boolean;
  setFast: (on: boolean) => void;
}

/** ms por passo do applyLive: lento p/ ver o cursor; "Mais rápido" encurta (lido a cada passo) */
export const FAST_STEP_MS = 350;
export function stepDelay(fast: boolean, requested?: number): number {
  const base = requested ?? AI_CURSOR_STEP_MS;
  return fast ? Math.min(FAST_STEP_MS, base) : base;
}

const WHISPER_KEY = 'ep_ai_whisper';
function readWhisperPref(): boolean {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(WHISPER_KEY) !== 'off'; } catch { return true; }
}

const answers = new Map<Id, (optionId: string) => void>();
const skips = new Map<Id, AbortController>();

const editor = () => useEditor.getState();

export const useAIChat = create<AIChatState>((set, get) => {
  const patchRun = (id: Id, patch: Partial<RunState> | ((r: RunState) => Partial<RunState>)) =>
    set((s) => {
      const cur = s.runs[id] ?? { log: [], steps: [], done: false };
      const p = typeof patch === 'function' ? patch(cur) : patch;
      return { runs: { ...s.runs, [id]: { ...cur, ...p } } };
    });

  /** roda uma tarefa da IA narrando numa mensagem nova do assistente */
  async function run(intro: string, task: (o: PipelineOptions) => Promise<PipelineResult>, context?: ChatContext) {
    if (get().busy) {
      emit('ep:toast', { text: 'A IA ainda está trabalhando — aguarde terminar.', kind: 'info' });
      return;
    }
    set({ busy: true });
    const msgId = editor().pushMessage({ role: 'assistant', text: '', status: 'pending' });
    patchRun(msgId, { phase: intro, log: [], steps: [], done: false, before: editor().project });

    const apply: PipelineOptions['apply'] = async (ops: EditOp[], o) => {
      const base = get().runs[msgId]?.steps.length ?? 0;
      // ordem boa de assistir (cortes -> legendas -> efeitos -> textos -> áudio) e balão curto no cursor
      const ordered = orderForViewing(ops, editor().project);
      const ids = ordered.map((op, i) => op.id ?? `${msgId}_${base + i}`);
      const withIds = ordered.map((op, i) => ({ ...op, id: ids[i], explain: shortExplain(op.explain) }));
      patchRun(msgId, (r) => ({ steps: [...r.steps, ...withIds.map((op) => ({ id: op.id!, text: op.explain || 'Editando', state: 'pending' as StepState }))] }));
      editor().updateMessage(msgId, { status: 'applying' });
      patchRun(msgId, { phase: 'Editando…', progress: undefined });
      const applied = await editor().applyLive(withIds, {
        ...o,
        delayMs: () => stepDelay(get().fast, o?.delayMs),
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
        whisper: get().whisper,
        context,
        ask: (text, options) =>
          new Promise<string>((resolve) => {
            answers.set(msgId, (id) => {
              answers.delete(msgId);
              patchRun(msgId, (r) => ({ question: undefined, log: [...r.log, options.find((o) => o.id === id)?.label ?? id] }));
              resolve(id);
            });
            patchRun(msgId, { question: { text, options }, phase: 'Aguardando sua resposta…', progress: undefined });
          }),
        skippable: (label) => {
          skips.get(msgId)?.abort();
          skips.delete(msgId);
          if (!label) {
            patchRun(msgId, { skipLabel: undefined });
            return undefined;
          }
          const ctrl = new AbortController();
          skips.set(msgId, ctrl);
          patchRun(msgId, { skipLabel: label });
          return ctrl.signal;
        },
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
      answers.delete(msgId);
      skips.delete(msgId);
      patchRun(msgId, { question: undefined, skipLabel: undefined });
      set({ busy: false });
    }
  }

  return {
    status: null,
    busy: false,
    runs: {},
    whisper: true,

    fast: false,
    setFast: (on) => set({ fast: on }),

    setWhisper: (on) => {
      try { localStorage.setItem(WHISPER_KEY, on ? 'on' : 'off'); } catch {}
      set({ whisper: on });
    },

    answer: (msgId, optionId) => answers.get(msgId)?.(optionId),

    skip: (msgId) => {
      const c = skips.get(msgId);
      if (!c) return;
      skips.delete(msgId);
      patchRun(msgId, { skipLabel: undefined, phase: 'Pulando…' });
      c.abort();
    },

    loadStatus: async () => {
      set({ whisper: readWhisperPref() }); // só no cliente (evita divergência na hidratação)
      set({ status: await getStatus(true) });
    },

    send: async (raw) => {
      const text = raw.trim();
      if (!text || get().busy) return;
      const context = editor().chatContext;
      editor().pushMessage({ role: 'user', text, status: 'done', ...(context ? { context } : {}) });
      if (context) editor().setChatContext(undefined);
      await run('Pensando…', (o) => chatEdit(text, o), context);
    },

    comments: async (markerIds) => {
      if (get().busy) return;
      const one = markerIds?.length === 1 ? (editor().project.markers ?? []).find((m) => m.id === markerIds[0]) : undefined;
      editor().pushMessage({ role: 'user', text: one ? `Aplicar o comentário: “${one.label ?? ''}”` : 'Aplicar os comentários de revisão', status: 'done' });
      if (markerIds && editor().chatContext?.markerId && markerIds.includes(editor().chatContext!.markerId!)) editor().setChatContext(undefined);
      await run('Lendo os comentários…', (o) => applyComments({ ...o, markerIds }));
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
