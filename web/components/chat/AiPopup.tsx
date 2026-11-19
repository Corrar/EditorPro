'use client';
/* =====================================================================
   AiPopup — "Editar com IA" compacto (dono: módulo ai).
   O shell monta num sheet (~45% da altura) com o preview visível em cima.
   Mesmo estado/histórico do ChatPanel (useAIChat + messages do editor):
   o usuário vai detalhando e a IA edita ao vivo, em conversa contínua.
   Props: onMinimize (vira a pílula AiLiveBadge) · onExpand (chat completo).
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useEditor } from '@/lib/store';
import { useAIChat, type RunState } from '@/lib/ai/chatStore';
import { useAIBridge } from '@/lib/ai/bridge';
import { joinDictation, useDictation } from '@/lib/ai/speech';
import { liveLabel, liveSummary } from '@/lib/ai/live';

const QUICK = [
  'Cortar silêncios', 'Legendas estilo TikTok', 'Deixar mais dinâmico', 'Gancho com zoom e flash',
  'Cores cinematográficas', 'Cortar vícios de linguagem', 'Sincronizar cortes na batida', 'Melhores momentos em 30 s',
];

function MiniSteps({ run }: { run: RunState }) {
  const total = run.steps.length;
  if (!total) return null;
  const done = run.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  // mostra só a janela atual (ativo + vizinhos) para caber no sheet
  const activeIdx = Math.max(0, run.steps.findIndex((s) => s.state === 'active' || s.state === 'pending'));
  const from = run.done ? Math.max(0, total - 3) : Math.max(0, Math.min(activeIdx - 1, total - 3));
  const view = run.steps.slice(from, from + 3);
  return (
    <div className="ep-aip-steps">
      <div className="ep-aip-stepshead">
        <span>{run.done ? 'Edições aplicadas' : 'Editando ao vivo'}</span>
        <b className="mono">{done}/{total}</b>
      </div>
      <div className="ep-ch-bar"><i style={{ width: `${(done / total) * 100}%` }} /></div>
      <ol>
        {view.map((s) => (
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

export interface AiPopupProps {
  onMinimize?: () => void;
  onExpand?: () => void;
  /** foca o campo ao abrir (padrão: não, para não abrir o teclado do celular sem pedir) */
  autoFocus?: boolean;
}

export default function AiPopup({ onMinimize, onExpand, autoFocus = false }: AiPopupProps) {
  const messages = useEditor((s) => s.messages);
  const project = useEditor((s) => s.project);
  const chatContext = useEditor((s) => s.chatContext);
  const setChatContext = useEditor((s) => s.setChatContext);
  const { status, busy, runs, loadStatus, send, undoRun, answer, skip } = useAIChat();
  const [text, setText] = useState('');
  const baseRef = useRef('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useAIBridge();
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const dict = useDictation((spoken, final) => {
    setText(joinDictation(baseRef.current, spoken));
    if (final) baseRef.current = joinDictation(baseRef.current, spoken);
  });

  // autoaltura do campo
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(96, el.scrollHeight)}px`;
  }, [text]);

  const live = useMemo(() => liveSummary(messages, runs), [messages, runs]);
  const lastAssistant = live.msgId ? messages.find((m) => m.id === live.msgId) : undefined;
  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i];
    return undefined;
  }, [messages]);
  const run = live.msgId ? runs[live.msgId] : undefined;
  const canUndo = !!run?.after && !busy && project === run.after;

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [live.done, live.total, live.phase, lastAssistant?.text, lastUser?.id]);

  const submit = (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    if (dict.listening) dict.stop();
    setText('');
    baseRef.current = '';
    send(v);
  };

  const claude = status?.configured;
  const empty = !lastUser && !lastAssistant;

  return (
    <section className="ep-aip" aria-label="Editar com IA">
      <header className="ep-aip-head">
        <div className="ep-aip-spark"><Icon name="ai" size={18} /></div>
        <b className="ep-aip-title">Editar com IA</b>
        <span className={`ep-ch-badge${claude ? ' on' : ''}`} title={claude ? `Claude (${status?.model})` : 'Sem chave de IA: planejador local, grátis'}>
          {status ? (claude ? 'Claude' : 'Demo') : '…'}
        </span>
        <span className="ep-aip-sp" />
        {onMinimize ? (
          <button className="ep-aip-iconbtn" onClick={onMinimize} aria-label="Minimizar" title="Minimizar">
            <Icon name="close" size={18} />
          </button>
        ) : null}
      </header>

      <div className="ep-aip-body" ref={bodyRef} aria-live="polite">
        {empty ? (
          <p className="ep-aip-hint">Diga o que mudar e eu edito ao vivo enquanto você assiste. Depois é só ir detalhando.</p>
        ) : (
          <>
            {lastUser ? <div className="ep-aip-me">{lastUser.text}</div> : null}
            {lastAssistant ? (
              <div className={`ep-aip-ai${lastAssistant.status === 'error' ? ' err' : ''}`}>
                {run && !run.done && run.phase ? (
                  <div className="ep-ch-phase"><span className="ep-ch-spin" /><span>{run.phase}</span></div>
                ) : null}
                {run && !run.done && run.progress !== undefined ? <div className="ep-ch-bar thin"><i style={{ width: `${Math.round(run.progress * 100)}%` }} /></div> : null}
                {run && !run.done && run.skipLabel ? <button className="ep-ch-skip" onClick={() => skip(lastAssistant.id)}>{run.skipLabel}</button> : null}
                {run?.question ? (
                  <div className="ep-ch-ask" role="group" aria-label="Pergunta da IA">
                    <p>{run.question.text}</p>
                    <div className="ep-ch-askbtns">
                      {run.question.options.map((o, i) => (
                        <button key={o.id} className={`ep-ch-askbtn${i === 0 ? ' primary' : ''}`} onClick={() => answer(lastAssistant.id, o.id)}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {run ? <MiniSteps run={run} /> : null}
                {lastAssistant.text ? <p className="ep-aip-text">{lastAssistant.text}</p> : null}
                {canUndo ? (
                  <button className="ep-ch-undo" onClick={() => undoRun(lastAssistant.id)}>
                    <Icon name="undo" size={13} /> Desfazer
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="ep-aip-chips" role="list">
        {QUICK.map((s) => (
          <button key={s} role="listitem" className="ep-pill2 ep-ch-chip" disabled={busy} onClick={() => submit(s)}>{s}</button>
        ))}
      </div>

      {chatContext ? (
        <div className="ep-ch-ctx ep-aip-ctx" role="status">
          <Icon name="point" size={13} />
          <span>Em: <b>{chatContext.label}</b></span>
          <button aria-label="Limpar o alvo" title="Limpar" onClick={() => setChatContext(undefined)}><Icon name="close" size={12} /></button>
        </div>
      ) : null}

      <div className={`ep-ch-input ep-aip-input${busy ? ' busy' : ''}${dict.listening ? ' listening' : ''}`}>
        {dict.supported ? (
          <button
            className={`ep-aip-mic${dict.listening ? ' on' : ''}`}
            onClick={() => { baseRef.current = text; dict.toggle(); }}
            aria-pressed={dict.listening}
            aria-label={dict.listening ? 'Parar ditado' : 'Ditar por voz'}
            title={dict.listening ? 'Ouvindo… toque para parar' : 'Ditar por voz'}
          >
            <Icon name="mic" size={18} />
          </button>
        ) : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={dict.listening ? 'Ouvindo… fale o que mudar' : busy ? 'A IA está editando…' : 'Descreva o que mudar…'}
          onChange={(e) => { setText(e.target.value); baseRef.current = e.target.value; }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          aria-label="O que a IA deve mudar"
        />
        <button className="ep-ch-send" disabled={busy || !text.trim()} onClick={() => submit()} aria-label="Enviar">
          {busy ? <span className="ep-ch-spin light" /> : <Icon name="send2" size={17} />}
        </button>
      </div>

      {onExpand ? (
        <button className="ep-aip-expand" onClick={onExpand}>
          <Icon name="chat" size={14} /> Abrir conversa completa
        </button>
      ) : null}
    </section>
  );
}

/** pílula "IA editando 3/8" — o shell mostra sobre o preview quando o pop-up está minimizado */
export function AiLiveBadge({ onClick, showIdle = false }: { onClick?: () => void; showIdle?: boolean }) {
  const messages = useEditor((s) => s.messages);
  const runs = useAIChat((s) => s.runs);
  const live = useMemo(() => liveSummary(messages, runs), [messages, runs]);
  if (!live.working && !live.waiting && !showIdle) return null;
  const pct = live.total ? Math.round((live.done / live.total) * 100) : undefined;
  return (
    <button className={`ep-ailive${live.working ? ' working' : ''}${live.waiting ? ' waiting' : ''}`} onClick={onClick} aria-label={`${liveLabel(live)} — abrir`}>
      <span className="ep-ailive-ic">{live.working ? <span className="ep-ch-spin light" /> : <Icon name="ai" size={14} />}</span>
      <span className="ep-ailive-t">{liveLabel(live)}</span>
      {pct !== undefined && live.working ? <i className="ep-ailive-bar" style={{ width: `${pct}%` }} /> : null}
    </button>
  );
}
