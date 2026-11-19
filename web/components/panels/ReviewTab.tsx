'use client';
import Icon from '@/components/ui/Icon';
/* Revisão: comentários presos a um momento/trecho (markers kind 'comment').
   A IA aplica pelo botão do ChatPanel; aqui se lista, cria e resolve. */
import { useMemo, useState } from 'react';
import { useEditor } from '@/lib/store';
import type { Marker } from '@/lib/types';
import { formatTime, uid } from '@/lib/util';
import { IconReview, IconTrash } from '@/components/shell/icons';
import { askAI } from '@/components/shell/ui';
import { EmptyHint, Section, Seg } from './controls';

export function usePendingComments(): number {
  return useEditor((s) => (s.project.markers ?? []).filter((m) => m.kind === 'comment' && !m.resolved).length);
}

export default function ReviewTab() {
  const markers = useEditor((s) => s.project.markers);
  const dispatch = useEditor((s) => s.dispatch);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playhead = useEditor((s) => s.playhead);
  const sel = useEditor((s) => s.selection[0]);
  const selClip = useEditor((s) => (sel ? s.project.tracks.flatMap((t) => t.clips).find((c) => c.id === sel) : undefined));
  const [text, setText] = useState('');
  const [span, setSpan] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const comments = useMemo(() => (markers ?? []).filter((m) => m.kind === 'comment').sort((a, b) => a.t - b.t), [markers]);
  const shown = filter === 'pending' ? comments.filter((c) => !c.resolved) : comments;
  const pending = comments.filter((c) => !c.resolved).length;

  const add = () => {
    const v = text.trim();
    if (!v) return;
    const t = Math.round(playhead * 100) / 100;
    const m: Marker = { id: uid('cm'), t, kind: 'comment', label: v, color: '#E0A32E', resolved: false };
    if (span && selClip) { m.t = selClip.start; m.end = selClip.start + selClip.duration; }
    dispatch({ op: 'add_marker', marker: m });
    setText('');
  };
  const range = (m: Marker) => `${formatTime(m.t, { decimals: true })}${m.end ? `–${formatTime(m.end, { decimals: true })}` : ''}`;

  return (
    <>
      <Section title="Novo comentário">
        <div className="ep-cmnew">
          <span className="ep-cmtime mono">{formatTime(span && selClip ? selClip.start : playhead, { decimals: true })}{span && selClip ? `–${formatTime(selClip.start + selClip.duration, { decimals: true })}` : ''}</span>
          <textarea
            className="ep-textarea ep-ptext" rows={2} value={text} placeholder="Ex.: corta essa pausa, legenda maior aqui, troca a música…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); e.stopPropagation(); }}
          />
          <div className="ep-cmnew-row">
            <label className="ep-cmspan"><input type="checkbox" checked={span} disabled={!selClip} onChange={(e) => setSpan(e.target.checked)} /> Trecho do clipe selecionado</label>
            <button type="button" className="ep-btn primary" onClick={add} disabled={!text.trim()}>Comentar</button>
          </div>
        </div>
      </Section>
      <Section title={`Comentários (${pending} pendente${pending === 1 ? '' : 's'})`} right={<Seg small value={filter} onChange={setFilter} options={[{ id: 'pending', label: 'Pendentes' }, { id: 'all', label: 'Todos' }]} />}>
        {!shown.length ? (
          <EmptyHint icon={<IconReview />} title={comments.length ? 'Tudo resolvido 🎉' : 'Sem comentários'} text={comments.length ? 'Nenhum comentário pendente.' : 'Deixe comentários no ponto do vídeo; no chat, “Aplicar comentários com IA” resolve todos de uma vez.'} />
        ) : (
          <div className="ep-cmlist">
            {shown.map((m) => (
              <div key={m.id} className={`ep-cm${m.resolved ? ' done' : ''}${playhead >= m.t && playhead <= (m.end ?? m.t + 0.5) ? ' on' : ''}`}>
                <button type="button" className="ep-cm-go mono" onClick={() => setPlayhead(m.t)} title="Ir para este ponto">▶ {range(m)}</button>
                <p className="ep-cm-text">{m.label}</p>
                <div className="ep-cm-acts">
                  <button type="button" className={`ep-mini${m.resolved ? '' : ' ok'}`} onClick={() => dispatch({ op: 'update_marker', markerId: m.id, patch: { resolved: !m.resolved } })}>{m.resolved ? 'Reabrir' : '✓ Resolver'}</button>
                  {!m.resolved && <button type="button" className="ep-mini" onClick={() => askAI({ markerId: m.id, range: { start: m.t, end: m.end ?? m.t }, label: `Comentário ${formatTime(m.t)}: “${(m.label ?? '').slice(0, 28)}”` })}><Icon name="ai" size={14} /> IA</button>}
                  <button type="button" className="ep-segdel" onClick={() => dispatch({ op: 'remove_marker', markerId: m.id })} aria-label="Apagar comentário" title="Apagar"><IconTrash size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
