'use client';
/* =====================================================================
   EditorPro — store central (zustand). Fonte única de estado da UI.
   - project: o documento editável (só muda via dispatch/applyOps)
   - history: pilha de desfazer/refazer (snapshots do project)
   - playback: playhead/playing (o preview e a timeline leem daqui)
   - live: fila de operações da IA sendo aplicadas "ao vivo"
   ===================================================================== */
import { create } from 'zustand';
import type { ChatContext, ChatMessage, Id, MediaAsset, Project, Seconds } from './types';
import { applyOp, normalizeOp, opFocus, projectDuration, type EditOp } from './ops';
import { createProject } from './defaults';
import { sleep, uid } from './util';

const HISTORY_LIMIT = 100;

export interface LiveState {
  running: boolean;
  /** operação sendo aplicada agora (p/ destacar na timeline e narrar no chat) */
  current?: EditOp;
  done: number;
  total: number;
  /** clipe a destacar com brilho na timeline */
  highlightClipId?: Id;
}

export interface EditorState {
  project: Project;
  assets: Record<Id, MediaAsset>;
  past: Project[];
  future: Project[];

  playhead: Seconds;
  playing: boolean;
  zoom: number; // px por segundo na timeline
  selection: Id[]; // clipIds selecionados

  messages: ChatMessage[];
  live: LiveState;
  /** "apontar para qualquer coisa": timeline/preview/legendas definem; o chat anexa à próxima mensagem */
  chatContext?: ChatContext;

  /* ações do documento */
  dispatch: (op: EditOp | EditOp[], opts?: { history?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;
  newProject: (opts?: Parameters<typeof createProject>[0]) => void;

  /* mídia */
  addAsset: (a: MediaAsset) => void;
  updateAsset: (id: Id, patch: Partial<MediaAsset>) => void;
  removeAsset: (id: Id) => void;

  /* reprodução / UI */
  setPlayhead: (t: Seconds) => void;
  setPlaying: (v: boolean) => void;
  setZoom: (z: number) => void;
  select: (ids: Id[]) => void;

  /* chat */
  pushMessage: (m: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: Id }) => Id;
  updateMessage: (id: Id, patch: Partial<ChatMessage>) => void;
  setChatContext: (c?: ChatContext) => void;

  /** aplica ops da IA uma a uma, com pausa, movendo o playhead e destacando ("editando ao vivo").
   *  Tudo vira UM passo de desfazer. Retorna os ids das ops aplicadas. */
  /** delayMs pode ser função: lida a cada passo (ex.: botão "Mais rápido" no meio da edição) */
  applyLive: (ops: EditOp[], opts?: { delayMs?: number | (() => number); onStep?: (op: EditOp, i: number) => void }) => Promise<Id[]>;
  cancelLive: () => void;
}

let liveToken = 0;
/** projeto de antes do lote ao vivo em andamento (p/ fechar o lote como 1 passo de desfazer) */
let liveBefore: Project | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  assets: {},
  past: [],
  future: [],
  playhead: 0,
  playing: false,
  zoom: 80,
  selection: [],
  messages: [],
  live: { running: false, done: 0, total: 0 },

  dispatch: (opOrOps, opts = {}) => {
    const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
    const history = opts.history !== false;
    // edição manual no meio da IA: para a IA e fecha o lote dela como 1 passo antes desta edição
    if (history && get().live.running) get().cancelLive();
    const before = get().project;
    let p = before;
    for (const op of ops) {
      try {
        p = applyOp(p, normalizeOp(op));
      } catch (e) {
        console.warn('[editor] op ignorada', op, e);
      }
    }
    if (p === before) return;
    set((s) => ({
      project: p,
      past: history ? [...s.past, before].slice(-HISTORY_LIMIT) : s.past,
      future: history ? [] : s.future,
    }));
  },

  undo: () => {
    // desfazer no meio da IA: para e desfaz o lote inteiro dela
    if (get().live.running) get().cancelLive();
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },

  redo: () => {
    if (get().live.running) get().cancelLive();
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
  },

  // trocar de projeto para qualquer edição ao vivo (as ops restantes eram do projeto anterior)
  loadProject: (p) => {
    liveToken++;
    liveBefore = null;
    set({ project: p, past: [], future: [], playhead: 0, selection: [], chatContext: undefined, live: { running: false, done: 0, total: 0 } });
  },
  newProject: (opts) => {
    liveToken++;
    liveBefore = null;
    set({ project: createProject(opts), past: [], future: [], playhead: 0, selection: [], messages: [], chatContext: undefined, live: { running: false, done: 0, total: 0 } });
  },

  addAsset: (a) => set((s) => ({ assets: { ...s.assets, [a.id]: a } })),
  updateAsset: (id, patch) =>
    set((s) => (s.assets[id] ? { assets: { ...s.assets, [id]: { ...s.assets[id], ...patch } } } : s)),
  removeAsset: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.assets;
      return { assets: rest };
    }),

  setPlayhead: (t) => set({ playhead: Math.max(0, Math.min(t, Math.max(projectDuration(get().project), 0))) }),
  setPlaying: (v) => set({ playing: v }),
  setZoom: (z) => set({ zoom: Math.max(8, Math.min(400, z)) }),
  select: (ids) => set({ selection: ids }),

  pushMessage: (m) => {
    const id = m.id ?? uid('msg');
    set((s) => ({ messages: [...s.messages, { ...m, id, createdAt: Date.now() }] }));
    return id;
  },
  updateMessage: (id, patch) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  setChatContext: (c) => set({ chatContext: c }),

  applyLive: async (rawOps, opts = {}) => {
    // um lote novo fecha o anterior (se ainda estiver rodando)
    if (get().live.running) get().cancelLive();
    const token = ++liveToken;
    const ops = rawOps.map(normalizeOp);
    const delayOf = () => (typeof opts.delayMs === 'function' ? opts.delayMs() : opts.delayMs ?? 450);
    const before = get().project;
    liveBefore = before;
    const applied: Id[] = [];
    set({ live: { running: true, done: 0, total: ops.length }, playing: false });
    for (let i = 0; i < ops.length; i++) {
      if (token !== liveToken) break; // cancelado / projeto trocado / desfazer
      const op = ops[i];
      const cur = get().project;
      const focus = opFocus(cur, op);
      set((s) => ({
        live: { ...s.live, current: op, highlightClipId: focus.clipId },
        playhead: focus.time ?? s.playhead,
      }));
      opts.onStep?.(op, i);
      await sleep(delayOf() / 2);
      if (token !== liveToken) break; // "Parar" durante a espera: não aplica a op pendente
      try {
        const next = applyOp(get().project, op);
        const f2 = opFocus(next, op);
        set((s) => ({ project: next, live: { ...s.live, done: i + 1, highlightClipId: f2.clipId ?? s.live.highlightClipId } }));
        applied.push(op.id!);
      } catch (e) {
        console.warn('[editor] op da IA ignorada', op, e);
      }
      await sleep(delayOf() / 2);
    }
    // ainda é o dono do lote: fecha como UM passo de desfazer (se foi cancelado, cancelLive já fechou)
    if (token === liveToken) {
      if (get().project !== before && get().project.id === before.id) set((s) => ({ past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] }));
      liveBefore = null;
      set({ live: { running: false, done: applied.length, total: ops.length } });
    }
    return applied;
  },

  cancelLive: () => {
    liveToken++;
    const before = liveBefore;
    liveBefore = null;
    const { project } = get();
    // fecha o lote parcial como 1 passo de desfazer (só se ainda for o mesmo projeto)
    if (before && project !== before && project.id === before.id) set((s) => ({ past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] }));
    set((s) => ({ live: { ...s.live, running: false, current: undefined, highlightClipId: undefined } }));
  },
}));

/** seletor conveniente da duração total */
export const useDuration = () => useEditor((s) => projectDuration(s.project));
