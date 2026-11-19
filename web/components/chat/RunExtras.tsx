'use client';
/* "O que mudou?" — explica a edição de uma mensagem comparando antes/depois (sem chamar a IA). */
import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { RunState } from '@/lib/ai/chatStore';
import { explainChanges } from '@/lib/ai/suggest';

export function ChangesButton({ run }: { run?: RunState }) {
  const [open, setOpen] = useState(false);
  if (!run?.done || !run.before || !run.final || run.final === run.before || !run.steps.length) return null;
  return (
    <div className="ep-ch-changes">
      <button className="ep-ch-changesbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="review" size={13} /> {open ? 'Esconder' : 'O que mudou?'}
      </button>
      {open ? <pre className="ep-ch-changeslist">{explainChanges(run.before, run.final)}</pre> : null}
    </div>
  );
}
