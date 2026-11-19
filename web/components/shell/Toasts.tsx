'use client';
import { useEffect, useState } from 'react';
import { on, type EpEvents } from '@/lib/events';
import { uid } from '@/lib/util';

type T = EpEvents['ep:toast'] & { id: string };
const COLORS = { info: 'var(--muted)', ok: 'var(--green)', error: 'var(--red)' } as const;

export default function Toasts() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(
    () =>
      on('ep:toast', (d) => {
        const t = { ...d, id: uid('toast') };
        setItems((s) => [...s.slice(-3), t]);
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), d.kind === 'error' || d.action ? 6000 : 3800);
      }),
    [],
  );
  if (!items.length) return null;
  return (
    <div className="ep-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`ep-toast k-${t.kind ?? 'info'}`}>
          <span className="dot" style={{ background: COLORS[t.kind ?? 'info'] }} />
          <span>{t.text}</span>
          {t.action && <button type="button" className="ep-toastact" onClick={() => { t.action!.run(); setItems((s) => s.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          <button type="button" className="ep-toastundo" aria-label="Fechar" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>✕</button>
        </div>
      ))}
    </div>
  );
}
