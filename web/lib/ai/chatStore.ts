'use client';
/* =====================================================================
   Estado do chat da IA (dono: módulo ai). As mensagens ficam no store
   central (useEditor.messages); aqui fica o que é só da UI do chat:
   narração por mensagem, passos ao vivo (op.explain), desfazer por edição.
   ===================================================================== */
import { create } from 'zustand';
import type { ChatContext, Id, MediaAsset, Project } from '../types';
import type { EditOp } from '../ops';
import { useEditor } from '../store';
import { emit } from '../events';
import { getStatus, type AIStatus } from './client';
import { AI_CURSOR_STEP_MS } from '../aiCursor';
import { orderForViewing, shortExplain } from './order';
import { groupLabel, liveStepDelay, planLiveSteps } from './livePace';
import { SCOPE_LABELS, styleScopeFromText, wantsApplyNow, type StyleScope } from './model';
import { explainChanges, HELP_TEXT, isExplainRequest, isHelpRequest } from './suggest';
import { DEMO_HELP } from './demo';
import { abortError, asOwn, isAbort, isOwnChange } from './runGuard';
import { analyzeModel, applyComments, applyModelStyle, chatEdit, generateCaptions, runFirstEdit, type AskOption, type PipelineOptions, type PipelineResult } from './pipeline';

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
  /** tamanho do histórico (past) no início da execução: desfazer volta TODOS os lotes dela */
  pastLen?: number;
  /** projeto ao terminar (p/ "o que mudou?", mesmo depois de outras edições) */
  final?: Project;
  /** resposta da análise de um vídeo modelo (mostra "Aplicar este estilo" + chips) */
  model?: { assetId: Id };
  /** pergunta pendente ao usuário (botões no chat) */
  question?: { text: string; options: AskOption[] };
  /** etapa em andamento que pode ser pulada (ex.: "Pular transcrição") */
  skipLabel?: string;
  /** botões depois da resposta (ex.: "Tentar transcrever de novo", "Ligar CC") */
  actions?: AskOption[];
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
  /** volta o projeto para ANTES desta edição, desfazendo também o que veio depois (refazer continua possível) */
  undoTo: (msgId: Id) => void;
  /** dá para voltar ao estado de antes desta edição? (ainda está no histórico) */
  canUndoTo: (msgId: Id) => boolean;
  /** responde a uma pergunta feita pela IA no chat */
  answer: (msgId: Id, optionId: string) => void;
  /** pula a etapa em andamento (ex.: transcrição) */
  skip: (msgId: Id) => void;
  /** botão oferecido numa resposta (captions:retry | captions:cc | captions:manual) */
  action: (msgId: Id, actionId: string) => Promise<void>;
  /** transcrição local com Whisper ligada? (preferência do aparelho) */
  whisper: boolean;
  setWhisper: (on: boolean) => void;
  /** ritmo da edição ao vivo: false = 900 ms por passo (dá para ver o cursor da IA), true = 350 ms */
  fast: boolean;
  setFast: (on: boolean) => void;
  /** anexa vídeo(s) modelo: ingere como 'reference', analisa o estilo e (se o texto pedir) aplica */
  attachModel: (files: File[], text?: string) => Promise<void>;
  /** aplica o estilo do modelo ativo (tudo ou só legendas/ritmo/cores) */
  applyModel: (scope?: StyleScope) => Promise<void>;
  /** deixa de usar o modelo ativo */
  clearModel: () => void;
}

/** espera o shell ingerir o arquivo (asset novo com o mesmo nome e url pronta) */
export function waitForAsset(name: string, before: Set<Id>, ms = 30000): Promise<MediaAsset | undefined> {
  return new Promise((resolve) => {
    const find = () => Object.values(useEditor.getState().assets).find((a) => !before.has(a.id) && a.name === name && !!a.url);
    const hit = find();
    if (hit) return resolve(hit);
    let done = false;
    const finish = (a?: MediaAsset) => { if (done) return; done = true; unsub(); clearTimeout(timer); resolve(a); };
    const unsub = useEditor.subscribe(() => { const a = find(); if (a) finish(a); });
    const timer = setTimeout(() => finish(undefined), ms);
  });
}

/** ms por passo do applyLive: lento p/ ver o cursor; "Mais rápido" encurta (lido a cada passo) */
export const FAST_STEP_MS = 350;
/** acima disso o lote não é reordenado para assistir (fica na ordem que veio) */
export const LIVE_MAX_STEPS = 40;
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
  async function run(intro: string, task: (o: PipelineOptions) => Promise<PipelineResult>, context?: ChatContext, onDone?: (msgId: Id, res: PipelineResult) => void): Promise<boolean> {
    if (get().busy) {
      emit('ep:toast', { text: 'A IA ainda está trabalhando — aguarde terminar.', kind: 'info' });
      return false;
    }
    set({ busy: true });
    const msgId = editor().pushMessage({ role: 'assistant', text: '', status: 'pending' });
    patchRun(msgId, { phase: intro, log: [], steps: [], done: false, before: editor().project, pastLen: editor().past.length });

    // a execução fica presa ao projeto e para por inteiro com Parar / desfazer / edição manual / troca de projeto
    const pid = editor().project.id;
    const runCtrl = new AbortController();
    let stopReason = '';
    const stopRun = (why: string) => {
      if (runCtrl.signal.aborted) return;
      stopReason = why;
      runCtrl.abort();
      answers.get(msgId)?.('skip'); // pergunta pendente não prende a execução
      skips.get(msgId)?.abort();
    };
    const unsub = useEditor.subscribe((st, prev) => {
      if (st.project.id !== pid) stopRun('project');
      else if (st.live.cancelled && !prev.live.cancelled) stopRun('stop');
      else if (st.project !== prev.project && !st.live.running && !prev.live.running && !isOwnChange()) stopRun('manual');
    });
    const guard = () => { if (runCtrl.signal.aborted || editor().project.id !== pid) throw abortError(); };

    let seq = 0; // ids únicos das ops/passos de todos os lotes desta execução
    const apply: PipelineOptions['apply'] = async (ops: EditOp[], o) => {
      guard();
      const base = seq;
      seq += ops.length + 1;
      // ordem boa de assistir (cortes -> legendas -> efeitos -> textos -> áudio) e balão curto no cursor
      // (lote enorme, ex.: run_script com centenas de ops, fica na ordem dele: reordenar custaria caro)
      const ordered = ops.length > LIVE_MAX_STEPS ? ops : orderForViewing(ops, editor().project);
      const withIds = ordered.map((op, i) => ({ ...op, id: op.id ?? `${msgId}_${base + i}`, explain: shortExplain(op.explain) }));
      // lote grande: as primeiras ops uma a uma, o resto em poucos passos por tipo (≤ ~7 s no total)
      const plan = planLiveSteps(withIds, stepDelay(get().fast, o?.delayMs));
      const stepIds = plan.steps.map((g, k) => (g.length === 1 ? withIds[g[0]].id! : `${msgId}_g${base}_${k}`));
      const stepOf = new Map<number, number>();
      plan.steps.forEach((g, k) => g.forEach((i) => stepOf.set(i, k)));
      patchRun(msgId, (r) => ({
        steps: [...r.steps, ...plan.steps.map((g, k) => ({ id: stepIds[k], text: groupLabel(g.map((i) => withIds[i])) || 'Editando', state: 'pending' as StepState }))],
      }));
      editor().updateMessage(msgId, { status: 'applying' });
      patchRun(msgId, { phase: 'Editando…', progress: undefined });
      const idx = new Map(stepIds.map((id, k) => [id, k]));
      const applied = await editor().applyLive(withIds, {
        ...o,
        steps: plan.steps,
        delayMs: (k) => liveStepDelay(plan, k, stepDelay(get().fast, o?.delayMs)),
        onStep: (_op, i) => {
          const k = stepOf.get(i) ?? 0;
          patchRun(msgId, (r) => ({
            steps: r.steps.map((st) => (st.id === stepIds[k] ? { ...st, state: 'active' } : st.state === 'active' && (idx.get(st.id) ?? Infinity) < k ? { ...st, state: 'done' } : st)),
          }));
        },
      });
      const ok = new Set(applied);
      patchRun(msgId, (r) => ({
        steps: r.steps.map((st) => {
          const k = idx.get(st.id);
          if (k === undefined) return st;
          return { ...st, state: plan.steps[k].some((i) => ok.has(withIds[i].id!)) ? 'done' : 'skipped' };
        }),
      }));
      guard(); // Parar no meio do lote: a execução inteira para aqui
      return applied;
    };

    try {
      const res = await task({
        apply,
        signal: runCtrl.signal,
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
      patchRun(msgId, { phase: undefined, progress: undefined, done: true, after: changed ? after : undefined, final: after, actions: res.actions?.length ? res.actions : undefined });
      editor().updateMessage(msgId, { text: res.reply, status: 'done', opIds: res.appliedIds });
      onDone?.(msgId, res);
      void getStatus().then((st) => set({ status: st })); // o selo Claude/Demo acompanha a última checagem
      return true;
    } catch (e) {
      if (isAbort(e) || runCtrl.signal.aborted) {
        if (stopReason === 'project' || editor().project.id !== pid) {
          // projeto trocado: nada é aplicado no outro; a mensagem (se ainda existir) não fica "pensando" para sempre
          if (editor().messages.some((m) => m.id === msgId)) editor().updateMessage(msgId, { text: 'Edição interrompida: o projeto foi trocado.', status: 'done' });
          patchRun(msgId, { phase: undefined, progress: undefined, done: true });
          return false;
        }
        const after = editor().project;
        const changed = after !== get().runs[msgId]?.before;
        // parada por edição manual: o projeto atual já inclui a edição do usuário — "Desfazer esta edição"
        // a desfaria junto (fica o "Voltar para antes desta edição", que avisa que desfaz o que veio depois)
        patchRun(msgId, { phase: undefined, progress: undefined, done: true, after: changed && stopReason !== 'manual' ? after : undefined, final: after });
        editor().updateMessage(msgId, { text: stopReason === 'manual' ? 'Parei a edição porque você mexeu no projeto.' : 'Edição parada.', status: 'done' });
        return false;
      }
      const msg = e instanceof Error ? e.message : String(e);
      patchRun(msgId, { phase: undefined, progress: undefined, done: true, error: msg });
      editor().updateMessage(msgId, { text: `Não consegui concluir: ${msg}`, status: 'error' });
      return false;
    } finally {
      unsub();
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

    attachModel: async (files, text = '') => {
      const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name));
      if (!videos.length) {
        emit('ep:toast', { text: 'O vídeo modelo precisa ser um arquivo de vídeo.', kind: 'error' });
        return;
      }
      if (get().busy) {
        emit('ep:toast', { text: 'A IA ainda está trabalhando — aguarde terminar.', kind: 'info' });
        return;
      }
      const before = new Set(Object.keys(editor().assets));
      emit('ep:attach-files', { files: videos, role: 'reference' });
      // vale mais de um: analisa na ordem; o último vira o modelo ativo
      for (const file of videos) {
        const userId = editor().pushMessage({ role: 'user', text: `🎬 Vídeo modelo: ${file.name}${text.trim() && file === videos[videos.length - 1] ? `\n${text.trim()}` : ''}`, status: 'done' });
        const asset = await waitForAsset(file.name, before);
        if (!asset) {
          editor().pushMessage({ role: 'assistant', text: `Não consegui abrir “${file.name}” como vídeo modelo.`, status: 'error' });
          continue;
        }
        editor().updateMessage(userId, { attachments: [asset.id] });
        await run('Analisando o estilo do modelo…', (o) => analyzeModel(asset.id, o), undefined, (msgId) => patchRun(msgId, { model: { assetId: asset.id } }));
      }
      if (wantsApplyNow(text) && editor().project.style) await get().applyModel(styleScopeFromText(text) ?? 'all');
    },

    applyModel: async (scope = 'all') => {
      if (get().busy) return;
      const label = scope === 'all' ? 'Aplicar este estilo ao meu vídeo' : SCOPE_LABELS[scope];
      editor().pushMessage({ role: 'user', text: label, status: 'done' });
      await run('Aplicando o estilo do modelo…', (o) => applyModelStyle(scope, o));
    },

    clearModel: () => {
      editor().dispatch({ op: 'set_project', patch: { referenceAssetId: undefined, style: undefined } }, { history: false });
      editor().pushMessage({ role: 'system', text: 'Modelo removido — sigo sem estilo de referência.', status: 'done' });
    },

    setWhisper: (on) => {
      try { localStorage.setItem(WHISPER_KEY, on ? 'on' : 'off'); } catch {}
      set({ whisper: on });
    },

    answer: (msgId, optionId) => answers.get(msgId)?.(optionId),

    action: async (msgId, actionId) => {
      if (get().busy) return;
      patchRun(msgId, { actions: undefined });
      if (actionId === 'captions:manual') {
        emit('ep:open-tool', { tool: 'captions' });
        emit('ep:toast', { text: 'No painel Legendas, toque em "Nova legenda" para escrever a sua.', kind: 'info' });
        return;
      }
      if (actionId === 'captions:cc') get().setWhisper(true);
      if (actionId === 'captions:retry' || actionId === 'captions:cc' || actionId === 'captions:redo') {
        editor().pushMessage({ role: 'user', text: actionId === 'captions:redo' ? 'Refazer as legendas pela fala' : actionId === 'captions:cc' ? 'Ligar CC e transcrever' : 'Tentar transcrever de novo', status: 'done' });
        await run('Transcrevendo a fala…', (o) => generateCaptions({ ...o, whisper: actionId === 'captions:cc' ? true : o.whisper }));
      }
    },

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
      if (isHelpRequest(text)) {
        editor().pushMessage({ role: 'user', text, status: 'done' });
        editor().pushMessage({ role: 'assistant', text: get().status && !get().status!.configured ? `${HELP_TEXT}\n\n${DEMO_HELP}` : HELP_TEXT, status: 'done' });
        return;
      }
      // "o que você mudou?" -> explica a última edição sem mexer no projeto
      if (isExplainRequest(text)) {
        editor().pushMessage({ role: 'user', text, status: 'done' });
        const msgs = editor().messages;
        let found: RunState | undefined;
        for (let i = msgs.length - 1; i >= 0 && !found; i--) { const r = get().runs[msgs[i].id]; if (r?.done && r.before && r.final && r.final !== r.before) found = r; }
        editor().pushMessage({ role: 'assistant', text: found ? `O que mudou na última edição:\n${explainChanges(found.before!, found.final!)}` : 'Ainda não fiz nenhuma edição nesta conversa.', status: 'done' });
        return;
      }
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

    canUndoTo: (msgId) => {
      const r = get().runs[msgId];
      if (!r?.done || !r.before || !r.final || r.final === r.before) return false;
      if (editor().project === r.before) return false;
      return editor().past.includes(r.before);
    },

    undoTo: (msgId) => {
      const r = get().runs[msgId];
      if (!r?.before || get().busy || !editor().past.includes(r.before)) {
        emit('ep:toast', { text: 'Não dá mais para voltar a esse ponto (histórico curto) — use o Desfazer do editor.', kind: 'info' });
        return;
      }
      let n = 0;
      while (editor().project !== r.before && editor().past.length && n < 200) { editor().undo(); n++; }
      // edições desfeitas pelo caminho não podem mais ser "desfeitas" de novo pelo chat
      set((s) => ({ runs: Object.fromEntries(Object.entries(s.runs).map(([id, x]) => [id, editor().past.includes(x.final as Project) || editor().project === x.final ? x : { ...x, after: undefined }])) }));
      editor().pushMessage({ role: 'system', text: `Voltei para antes dessa edição (${n} passo${n > 1 ? 's' : ''} desfeito${n > 1 ? 's' : ''}). Use "Refazer" do editor se mudar de ideia.`, status: 'done' });
    },

    undoRun: (msgId) => {
      const r = get().runs[msgId];
      if (!r?.after || editor().project !== r.after) {
        emit('ep:toast', { text: 'Já houve outras mudanças depois desta edição — use o Desfazer do editor.', kind: 'info' });
        return;
      }
      // a execução pode ter aplicado vários lotes (pré, estilo, legendas, principal): desfaz todos
      const steps = Math.max(1, editor().past.length - (r.pastLen ?? editor().past.length - 1));
      // (histórico pode estar no limite: segue até voltar ao projeto de antes, com teto)
      for (let i = 0; i < Math.max(steps, 8) && editor().project !== r.before && editor().past.length; i++) editor().undo();
      patchRun(msgId, { after: undefined });
      editor().pushMessage({ role: 'system', text: 'Edição desfeita.', status: 'done' });
    },
  };
});
