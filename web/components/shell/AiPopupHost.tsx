'use client';
/* =====================================================================
   v2.3 — contêiner do pop-up da IA no editor do celular (≤899px retrato):
   - botão flutuante ✦ (56px, canto inferior esquerdo, acima da barra de ferramentas)
   - sheet ~45% com o preview visível em cima
   - minimizar → pílula "IA editando 3/8" sobre o preview (tocar reabre)
   - "Abrir conversa completa" → chat inteiro
   O CONTEÚDO do pop-up é da sessão de IA; enquanto o componente dela não chega,
   usamos QuickAi (mínimo, só com a API pública useAIChat.send).
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useAIChat } from '@/lib/ai/chatStore';
import { useEditor } from '@/lib/store';

export type AiPopupMode = 'closed' | 'open' | 'min';

export interface AiPopupBodyProps { onMinimize: () => void; onClose: () => void; onOpenChat: () => void }

const SUGGESTIONS = ['Cortar as pausas', 'Legendas estilo creator', 'Deixar mais dinâmico', 'Música animada de fundo', 'Zoom nos momentos fortes'];

type SR = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function speechCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** conteúdo provisório do pop-up (substituído pelo componente da sessão de IA) */
function QuickAi({ onMinimize, onClose, onOpenChat }: AiPopupBodyProps) {
  const status = useAIChat((s) => s.status);
  const busy = useAIChat((s) => s.busy);
  const send = useAIChat((s) => s.send);
  const lastId = useEditor((s) => [...s.messages].reverse().find((m) => m.role === 'assistant')?.id);
  const lastText = useEditor((s) => [...s.messages].reverse().find((m) => m.role === 'assistant')?.text ?? '');
  const run = useAIChat((s) => (lastId ? s.runs[lastId] : undefined));
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const rec = useRef<SR | null>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  useEffect(() => { if (!status) void useAIChat.getState().loadStatus(); }, [status]);
  useEffect(() => { stepsRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [run?.steps.length]);
  useEffect(() => () => rec.current?.stop(), []);

  const submit = (t = text) => {
    const v = t.trim();
    if (!v || busy) return;
    setText('');
    void send(v);
  };
  const Speech = speechCtor();
  const toggleMic = () => {
    if (listening) { rec.current?.stop(); return; }
    if (!Speech) return;
    const r = new Speech();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false;
    const base = text ? `${text.trim()} ` : '';
    r.onresult = (e) => setText(base + Array.from(e.results).map((x) => x[0].transcript).join(''));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  };

  const steps = run?.steps ?? [];
  const done = steps.filter((s) => s.state === 'done').length;
  return (
    <>
      <div className="ep-aipop-head">
        <button type="button" className="ep-circle sm" onClick={onMinimize} aria-label="Minimizar"><Icon name="minimize" size={22} /></button>
        <div className="ep-aipop-title">
          <b>Editar com IA</b>
          <span className={`ep-tag${status?.provider === 'anthropic' ? ' accent' : ''}`}>{status?.provider === 'anthropic' ? 'Claude' : 'Demo'}</span>
        </div>
        <button type="button" className="ep-circle sm" onClick={onClose} aria-label="Fechar"><Icon name="close" size={18} /></button>
      </div>
      <div className="ep-aipop-body">
        {steps.length > 0 || busy ? (
          <div className="ep-aipop-run">
            <div className="ep-aipop-phase">{busy ? <span className="ep-spin sm" /> : <Icon name="check" size={16} />}<span>{busy ? run?.phase ?? 'Pensando…' : lastText || 'Pronto'}</span>{steps.length > 0 && <b className="mono">{done}/{steps.length}</b>}</div>
            {run?.question && lastId && (
              <div className="ep-aipop-q">
                <p>{run.question.text}</p>
                <div>{run.question.options.map((o) => <button key={o.id} type="button" className="ep-aipop-chip" onClick={() => useAIChat.getState().answer(lastId, o.id)}>{o.label}</button>)}</div>
              </div>
            )}
            {steps.length > 0 && (
              <ol className="ep-aipop-steps" ref={stepsRef}>
                {steps.map((s) => <li key={s.id} className={s.state}>{s.text}</li>)}
              </ol>
            )}
          </div>
        ) : (
          <p className="ep-aipop-hint">Descreva o que mudar — a IA edita ao vivo e você vai detalhando.</p>
        )}
        <div className="ep-aipop-chips">
          {SUGGESTIONS.map((s) => <button key={s} type="button" className="ep-aipop-chip" onClick={() => submit(s)} disabled={busy}>{s}</button>)}
        </div>
      </div>
      <form className="ep-aipop-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? 'Ouvindo…' : 'Descreva o que mudar…'} aria-label="Pedido para a IA" enterKeyHint="send" />
        {Speech && <button type="button" className={`ep-aipop-mic${listening ? ' on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Parar ditado' : 'Ditar por voz'} aria-pressed={listening}><Icon name="mic" size={20} /></button>}
        <button type="submit" className="ep-aipop-send" disabled={!text.trim() || busy} aria-label="Enviar"><Icon name="send" size={18} /></button>
      </form>
      <button type="button" className="ep-aipop-full" onClick={onOpenChat}>Abrir conversa completa<Icon name="next" size={16} /></button>
    </>
  );
}

export default function AiPopupHost({ mode, setMode, onOpenChat, Body = QuickAi }: {
  mode: AiPopupMode; setMode: (m: AiPopupMode) => void; onOpenChat: () => void; Body?: React.ComponentType<AiPopupBodyProps>;
}) {
  const live = useEditor((s) => s.live);
  const busy = useAIChat((s) => s.busy);
  const working = live.running || busy;
  return (
    <>
      {mode === 'closed' && (
        <button type="button" className={`ep-aifab2${working ? ' live' : ''}`} onClick={() => setMode('open')} aria-label="Editar com IA">
          <Icon name="ai" size={24} />
        </button>
      )}
      {mode === 'min' && (
        <button type="button" className={`ep-aipill${working ? ' live' : ''}`} onClick={() => setMode('open')} aria-label="Reabrir a IA">
          <Icon name="ai" size={16} />
          <span>{live.running ? <>IA editando <b className="mono">{live.done}/{live.total}</b></> : busy ? 'IA pensando…' : 'IA pronta'}</span>
        </button>
      )}
      {mode === 'open' && (
        <div className="ep-aipop" role="dialog" aria-modal="false" aria-label="Editar com IA">
          <Body onMinimize={() => setMode('min')} onClose={() => setMode('closed')} onOpenChat={() => { setMode('closed'); onOpenChat(); }} />
        </div>
      )}
    </>
  );
}
