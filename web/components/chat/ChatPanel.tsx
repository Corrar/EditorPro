'use client';
/* =====================================================================
   ChatPanel — assistente de edição (dono: módulo ai). Ocupa .ep-chat.
   - narra o pipeline ("Analisando seu vídeo-exemplo…", "Transcrevendo…")
   - mostra os passos (op.explain) entrando um a um enquanto applyLive roda
   - "Desfazer esta edição" na última edição da IA
   - escuta ep:start-ai-edit e ep:generate-captions; anexar -> ep:attach-files
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { emit, on } from '@/lib/events';
import { useAIChat, type RunState } from '@/lib/ai/chatStore';
import type { ChatMessage } from '@/lib/types';

const SUGGESTIONS = [
  'Legendas estilo TikTok', 'Cortar silêncios', 'Cortar vícios de linguagem', 'Deixar mais dinâmico', 'Melhores momentos em 30 s',
  'Sincronizar cortes na batida', 'Auto-reframe seguindo o rosto', 'Gancho com zoom e flash', 'Criar capítulos',
  'Traduzir legendas para inglês', 'Cores cinematográficas',
];

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const I = {
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  send: 'M5 12h13M13 6l6 6-6 6',
  clip: 'M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  check: 'M5 12.5l4.2 4.2L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  skip: 'M5 12h14',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z',
  note: 'M4 5h16v11H8l-4 4z',
};

function Steps({ run }: { run: RunState }) {
  if (!run.steps.length) return null;
  const done = run.steps.filter((s) => s.state === 'done').length;
  const total = run.steps.length;
  const live = !run.done;
  return (
    <div className="ep-ch-steps">
      <div className="ep-ch-stepshead">
        <span>{live ? 'Editando ao vivo' : 'Edições aplicadas'}</span>
        <b className="mono">{done}/{total}</b>
      </div>
      <div className="ep-ch-bar"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <ol>
        {run.steps.map((s) => (
          <li key={s.id} className={`ep-ch-step ${s.state}`}>
            <span className="ep-ch-stepic">
              {s.state === 'done' ? <Icon d={I.check} size={12} /> : s.state === 'skipped' ? <Icon d={I.skip} size={12} /> : s.state === 'active' ? <span className="ep-ch-spin" /> : null}
            </span>
            <span className="ep-ch-steptext">{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AssistantBubble({ m, run, canUndo, onUndo, onAnswer, onSkip }: { m: ChatMessage; run?: RunState; canUndo: boolean; onUndo: () => void; onAnswer: (id: string) => void; onSkip: () => void }) {
  const working = run && !run.done;
  return (
    <div className={`ep-ch-msg ai${m.status === 'error' ? ' err' : ''}`}>
      <div className="ep-ch-avatar"><Icon d={I.spark} size={14} /></div>
      <div className="ep-ch-bubble">
        {run?.log.length ? (
          <ul className="ep-ch-log">
            {run.log.map((l, i) => (
              <li key={i}><Icon d={I.check} size={12} /> <span>{l}</span></li>
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
        {canUndo ? (
          <button className="ep-ch-undo" onClick={onUndo}>
            <Icon d={I.undo} size={13} /> Desfazer esta edição
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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // pedidos vindos de outros módulos (wizard, painel de legendas)
  useEffect(() => {
    const off1 = on('ep:start-ai-edit', ({ brief }) => { useAIChat.getState().firstEdit(brief); });
    const off2 = on('ep:generate-captions', ({ language }) => { useAIChat.getState().captions(language); });
    return () => { off1(); off2(); };
  }, []);

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

  const onFiles = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    emit('ep:attach-files', { files });
    useEditor.getState().pushMessage({ role: 'user', text: `📎 ${files.map((f) => f.name).join(', ')}`, status: 'done' });
    if (fileRef.current) fileRef.current.value = '';
  };

  const claude = status?.configured;
  const empty = messages.length === 0;

  return (
    <div className="ep-ch">
      <header className="ep-ch-head">
        <div className="ep-aicard ep-ch-aicard">
          <div className="spark"><Icon d={I.spark} size={20} /></div>
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
      </header>

      <div className="ep-ch-list" ref={listRef}>
        {empty ? (
          <div className="ep-ch-empty">
            <div className="ic"><Icon d={I.spark} size={22} /></div>
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
                    {m.context ? <span className="ep-ch-ctxtag"><Icon d={I.target} size={11} /> {m.context.label}</span> : null}
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
            return <AssistantBubble key={m.id} m={m} run={run} canUndo={canUndo} onUndo={() => undoRun(m.id)} onAnswer={(id) => answer(m.id, id)} onSkip={() => skip(m.id)} />;
          })
        )}
      </div>

      <div className="ep-ch-foot">
        {pendingComments ? (
          <button className="ep-ch-comments" disabled={busy} onClick={() => comments()}>
            <Icon d={I.note} size={14} /> Aplicar comentários com IA <b>{pendingComments}</b>
          </button>
        ) : null}
        {chatContext ? (
          <div className="ep-ch-ctx" role="status">
            <Icon d={I.target} size={13} />
            <span>Apontando para: <b>{chatContext.label}</b></span>
            <button aria-label="Limpar o alvo" title="Limpar" onClick={() => setChatContext(undefined)}><Icon d={I.x} size={12} /></button>
          </div>
        ) : null}
        {ctxComment ? (
          <button className="ep-ch-applyone" disabled={busy} onClick={() => comments([ctxComment.id])}>
            <Icon d={I.spark} size={13} /> Aplicar este comentário
          </button>
        ) : null}
        <div className="ep-ch-chips" role="list">
          {SUGGESTIONS.map((s) => (
            <button key={s} role="listitem" className="ep-pill2 ep-ch-chip" disabled={busy} onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className={`ep-ch-input${busy ? ' busy' : ''}`}>
          <button className="ep-ch-attach" title="Anexar mídia" aria-label="Anexar mídia" onClick={() => fileRef.current?.click()}>
            <Icon d={I.clip} size={17} />
          </button>
          <input ref={fileRef} type="file" multiple accept="video/*,audio/*,image/*" hidden onChange={(e) => onFiles(e.target.files)} />
          <textarea
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
            {busy ? <span className="ep-ch-spin light" /> : <Icon d={I.send} size={17} />}
          </button>
        </div>
        <div className="ep-ch-hint">Enter envia · Shift+Enter quebra a linha</div>
      </div>
    </div>
  );
}
