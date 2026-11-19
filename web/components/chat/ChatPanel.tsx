'use client';
/* =====================================================================
   ChatPanel — assistente de edição (dono: módulo ai). Ocupa .ep-chat.
   - narra o pipeline ("Analisando seu vídeo-exemplo…", "Transcrevendo…")
   - mostra os passos (op.explain) entrando um a um enquanto applyLive roda
   - "Desfazer esta edição" na última edição da IA
   - escuta ep:start-ai-edit e ep:generate-captions; anexar -> ep:attach-files
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { emit } from '@/lib/events';
import { useAIBridge } from '@/lib/ai/bridge';
import { FastButton } from './FastButton';
import AttachMenu, { filesFromTransfer } from './AttachMenu';
import { ModelActions, ModelAttachment, ModelChip } from './ModelBits';
import { ChangesButton } from './RunExtras';
import { suggestionsFor } from '@/lib/ai/suggest';
import { useAIChat, type RunState } from '@/lib/ai/chatStore';
import type { ChatMessage } from '@/lib/types';



function Steps({ run }: { run: RunState }) {
  if (!run.steps.length) return null;
  const done = run.steps.filter((s) => s.state === 'done').length;
  const total = run.steps.length;
  const live = !run.done;
  return (
    <div className="ep-ch-steps">
      <div className="ep-ch-stepshead">
        <span>{live ? 'Editando ao vivo' : 'Edições aplicadas'}</span>
        {live && done < total ? <FastButton /> : null}
        <b className="mono">{done}/{total}</b>
      </div>
      <div className="ep-ch-bar"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <ol>
        {run.steps.map((s) => (
          <li key={s.id} className={`ep-ch-step ${s.state}`}>
            <span className="ep-ch-stepic">
              {s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'skipped' ? <Icon name="close" size={12} /> : s.state === 'active' ? <span className="ep-ch-spin" /> : null}
            </span>
            <span className="ep-ch-steptext">{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AssistantBubble({ m, run, canUndo, onUndo, canUndoTo, onUndoTo, editNo, onAnswer, onSkip }: { m: ChatMessage; run?: RunState; canUndo: boolean; onUndo: () => void; canUndoTo: boolean; onUndoTo: () => void; editNo?: number; onAnswer: (id: string) => void; onSkip: () => void }) {
  const working = run && !run.done;
  return (
    <div className={`ep-ch-msg ai${m.status === 'error' ? ' err' : ''}`}>
      <div className="ep-ch-avatar"><Icon name="ai" size={14} /></div>
      <div className="ep-ch-bubble">
        {run?.log.length ? (
          <ul className="ep-ch-log">
            {run.log.map((l, i) => (
              <li key={i}><Icon name="check" size={12} /> <span>{l}</span></li>
            ))}
          </ul>
        ) : null}
        {working && run?.phase ? (
          <div className="ep-ch-phase">
            <span className="ep-ch-spin" />
            <span>{run.phase}</span>
          </div>
        ) : null}
        {working && run?.progress !== undefined ? <div className="ep-ch-bar thin"><i style={{ width: `${Math.round(run.progress * 100)}%` }} /></div> : null}
        {working && run?.skipLabel ? (
          <button className="ep-ch-skip" onClick={onSkip}>{run.skipLabel}</button>
        ) : null}
        {run?.question ? (
          <div className="ep-ch-ask" role="group" aria-label="Pergunta da IA">
            <p>{run.question.text}</p>
            <div className="ep-ch-askbtns">
              {run.question.options.map((o, i) => (
                <button key={o.id} className={`ep-ch-askbtn${i === 0 ? ' primary' : ''}`} onClick={() => onAnswer(o.id)}>{o.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {run ? <Steps run={run} /> : null}
        {m.text ? <p className="ep-ch-text">{m.text}</p> : null}
        {run?.model && run.done && !run.error ? <ModelActions assetId={run.model.assetId} /> : null}
        <ChangesButton run={run} />
        {canUndo ? (
          <button className="ep-ch-undo" onClick={onUndo}>
            <Icon name="undo" size={13} /> Desfazer esta edição
          </button>
        ) : run && canUndoTo ? (
          <button className="ep-ch-undo" onClick={onUndoTo} data-edit={editNo} title={`Volta o projeto ao estado de antes da ${editNo}ª edição, desfazendo também as seguintes (dá para refazer)`}>
            <Icon name="undo" size={13} /> Voltar para antes desta edição{editNo ? <span className="ep-ch-editno"> · {editNo}ª</span> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const messages = useEditor((s) => s.messages);
  const project = useEditor((s) => s.project);
  const assetCount = useEditor((s) => Object.keys(s.assets).length);
  const { status, busy, runs, loadStatus, send, undoRun, answer, skip, whisper, setWhisper, comments } = useAIChat();
  const chatContext = useEditor((s) => s.chatContext);
  const setChatContext = useEditor((s) => s.setChatContext);
  const pendingComments = useEditor((s) => (s.project.markers ?? []).filter((m) => m.kind === 'comment' && !m.resolved).length);
  const ctxComment = useEditor((s) => (s.chatContext?.markerId ? (s.project.markers ?? []).find((m) => m.id === s.chatContext!.markerId && m.kind === 'comment' && !m.resolved) : undefined));
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // pedidos vindos de outros módulos (wizard, painel de legendas) — compartilhado com o AiPopup
  useAIBridge();

  // rola para o fim quando chega mensagem/passo novo
  const stepCount = useMemo(() => Object.values(runs).reduce((n, r) => n + r.steps.length + r.log.length + (r.phase ? 1 : 0), 0), [runs]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, stepCount, messages[messages.length - 1]?.text]);

  // autoaltura do campo
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [text]);

  // número de cada edição da IA na conversa (1ª, 2ª…) — deixa claro qual "Voltar para antes" é qual
  const editNos = useMemo(() => {
    const out: Record<string, number> = {};
    let n = 0;
    for (const m of messages) if (m.role === 'assistant' && runs[m.id]?.steps.length) out[m.id] = ++n;
    return out;
  }, [messages, runs]);

  const lastEditId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && runs[m.id]?.after) return m.id;
    }
    return undefined;
  }, [messages, runs]);

  const submit = (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    setText('');
    send(v);
  };

  const onMedia = (files: File[]) => {
    if (!files.length) return;
    emit('ep:attach-files', { files });
    useEditor.getState().pushMessage({ role: 'user', text: `📎 ${files.map((f) => f.name).join(', ')}`, status: 'done' });
  };
  const onModel = (files: File[]) => {
    const said = text;
    setText('');
    useAIChat.getState().attachModel(files, said);
  };
  // arrastar/colar arquivos no chat abre o mesmo menu (modelo × mídia)
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop: (e: React.DragEvent) => { const f = filesFromTransfer(e.dataTransfer); setDragging(false); if (f.length) { e.preventDefault(); setPending(f); } },
  };
  const onPaste = (e: React.ClipboardEvent) => { const f = filesFromTransfer(e.clipboardData); if (f.length) { e.preventDefault(); setPending(f); } };

  const claude = status?.configured;
  const empty = messages.length === 0;
  const assets = useEditor((s) => s.assets);
  const suggestions = useMemo(() => suggestionsFor(project, assets), [project, assets]);

  return (
    <div className={`ep-ch${dragging ? ' dragging' : ''}`} {...dropProps}>
      {dragging ? <div className="ep-ch-drop"><Icon name="attach" size={22} /> Solte para anexar</div> : null}
      <header className="ep-ch-head">
        <div className="ep-aicard ep-ch-aicard">
          <div className="spark"><Icon name="ai" size={20} /></div>
          <div className="ep-ch-headtxt">
            <b className="t">Assistente IA</b>
            <span className="d">{busy ? 'Trabalhando…' : claude ? 'Pronto para editar' : 'Modo demonstração'}</span>
          </div>
          <button
            className={`ep-ch-cc${whisper ? ' on' : ''}`}
            onClick={() => setWhisper(!whisper)}
            aria-pressed={whisper}
            aria-label="Transcrição no aparelho"
            title={whisper ? 'Transcrição no aparelho ligada (Whisper, grátis). Toque para desligar.' : 'Transcrição no aparelho desligada. Toque para ligar.'}
          >
            CC
          </button>
          <span className={`ep-ch-badge${claude ? ' on' : ''}`} title={claude ? `Claude (${status?.model})` : 'Sem chave de IA: planejador local, grátis'}>
            {status ? (claude ? 'Claude' : 'Demo') : '…'}
          </span>
        </div>
        <ModelChip />
      </header>

      <div className="ep-ch-list" ref={listRef}>
        {empty ? (
          <div className="ep-ch-empty">
            <div className="ic"><Icon name="ai" size={22} /></div>
            <h4>Diga como quer o vídeo</h4>
            <p>
              {assetCount
                ? 'Descreva o resultado ou use uma sugestão abaixo. Eu edito ao vivo na timeline e você corrige por aqui.'
                : 'Envie o material bruto e um vídeo-exemplo, descreva o estilo e eu edito ao vivo.'}
            </p>
            {!claude && status ? <p className="ep-ch-demo">Modo demo: corto pausas pelo áudio, legendo com o Whisper aqui no aparelho e crio título, zoom e cor — sem custo.</p> : null}
          </div>
        ) : (
          messages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="ep-ch-msg me">
                  <div className="ep-ch-bubble">
                    {m.context ? <span className="ep-ch-ctxtag"><Icon name="point" size={11} /> {m.context.label}</span> : null}
                    {m.attachments?.length ? <ModelAttachment ids={m.attachments} /> : null}
                    {m.text}
                  </div>
                </div>
              );
            }
            if (m.role === 'system') {
              return <div key={m.id} className="ep-ch-sys">{m.text}</div>;
            }
            const run = runs[m.id];
            const canUndo = m.id === lastEditId && !busy && !!run?.after && project === run.after;
            const canTo = !canUndo && !busy && useAIChat.getState().canUndoTo(m.id);
            return <AssistantBubble key={m.id} m={m} run={run} canUndo={canUndo} onUndo={() => undoRun(m.id)} canUndoTo={canTo} onUndoTo={() => useAIChat.getState().undoTo(m.id)} editNo={editNos[m.id]} onAnswer={(id) => answer(m.id, id)} onSkip={() => skip(m.id)} />;
          })
        )}
      </div>

      <div className="ep-ch-foot">
        {pendingComments ? (
          <button className="ep-ch-comments" disabled={busy} onClick={() => comments()}>
            <Icon name="review" size={14} /> Aplicar comentários com IA <b>{pendingComments}</b>
          </button>
        ) : null}
        {chatContext ? (
          <div className="ep-ch-ctx" role="status">
            <Icon name="point" size={13} />
            <span>Apontando para: <b>{chatContext.label}</b></span>
            <button aria-label="Limpar o alvo" title="Limpar" onClick={() => setChatContext(undefined)}><Icon name="close" size={12} /></button>
          </div>
        ) : null}
        {ctxComment ? (
          <button className="ep-ch-applyone" disabled={busy} onClick={() => comments([ctxComment.id])}>
            <Icon name="ai" size={13} /> Aplicar este comentário
          </button>
        ) : null}
        <div className="ep-ch-chips" role="list">
          {suggestions.map((s) => (
            <button key={s} role="listitem" className="ep-pill2 ep-ch-chip" disabled={busy} onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className={`ep-ch-input${busy ? ' busy' : ''}`}>
          <AttachMenu onModel={onModel} onMedia={onMedia} pending={pending} onPendingDone={() => setPending([])} />
          <textarea
            onPaste={onPaste}
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={busy ? 'A IA está editando…' : chatContext ? `O que fazer em "${chatContext.label}"?` : 'Peça uma mudança…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Mensagem para a IA"
          />
          <button className="ep-ch-send" disabled={busy || !text.trim()} onClick={() => submit()} aria-label="Enviar">
            {busy ? <span className="ep-ch-spin light" /> : <Icon name="send2" size={17} />}
          </button>
        </div>
        <div className="ep-ch-hint">Enter envia · Shift+Enter quebra a linha</div>
      </div>
    </div>
  );
}
