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
  applyLive: (ops: EditOp[], opts?: { delayMs?: number; onStep?: (op: EditOp, i: number) => void }) => Promise<Id[]>;
  cancelLive: () => void;
}

let liveToken = 0;

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
    const history = opts.history !== false;
    set((s) => ({
      project: p,
      past: history ? [...s.past, before].slice(-HISTORY_LIMIT) : s.past,
      future: history ? [] : s.future,
    }));
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
  },

  loadProject: (p) => set({ project: p, past: [], future: [], playhead: 0, selection: [] }),
  newProject: (opts) => set({ project: createProject(opts), past: [], future: [], playhead: 0, selection: [], messages: [] }),

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
    const token = ++liveToken;
    const ops = rawOps.map(normalizeOp);
    const delay = opts.delayMs ?? 450;
    const before = get().project;
    const applied: Id[] = [];
    set({ live: { running: true, done: 0, total: ops.length }, playing: false });
    for (let i = 0; i < ops.length; i++) {
      if (token !== liveToken) break; // cancelado
      const op = ops[i];
      const cur = get().project;
      const focus = opFocus(cur, op);
      set((s) => ({
        live: { ...s.live, current: op, highlightClipId: focus.clipId },
        playhead: focus.time ?? s.playhead,
      }));
      opts.onStep?.(op, i);
      await sleep(delay / 2);
      try {
        const next = applyOp(get().project, op);
        const f2 = opFocus(next, op);
        set((s) => ({ project: next, live: { ...s.live, done: i + 1, highlightClipId: f2.clipId ?? s.live.highlightClipId } }));
        applied.push(op.id!);
      } catch (e) {
        console.warn('[editor] op da IA ignorada', op, e);
      }
      await sleep(delay / 2);
    }
    // um único passo de desfazer para o lote inteiro
    if (get().project !== before) set((s) => ({ past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] }));
    set({ live: { running: false, done: applied.length, total: ops.length } });
    return applied;
  },

  cancelLive: () => {
    liveToken++;
    set((s) => ({ live: { ...s.live, running: false, current: undefined, highlightClipId: undefined } }));
  },
}));

/** seletor conveniente da duração total */
export const useDuration = () => useEditor((s) => projectDuration(s.project));
