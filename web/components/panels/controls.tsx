'use client';
/* =====================================================================
   Controles dos painéis. Cada controle avisa `history=true` só no INÍCIO
   do gesto (arrastar slider, digitar, escolher cor) — o resto do gesto
   vai sem histórico. Assim um arraste = um passo de desfazer.
   ===================================================================== */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type OnValue<T> = (v: T, history: boolean) => void;

function useGesture() {
  const started = useRef(false);
  return {
    begin: () => { const first = !started.current; started.current = true; return first; },
    end: () => { started.current = false; },
  };
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="ep-psec">
      <div className="ep-psec-h"><span>{title}</span>{right}</div>
      {children}
    </section>
  );
}

export function Slider({
  label, value, min, max, step = 0.01, onChange, format, reset,
}: {
  label: string; value: number; min: number; max: number; step?: number; onChange: OnValue<number>;
  format?: (v: number) => string; reset?: number;
}) {
  const g = useGesture();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="ep-slider">
      <span className="ep-slider-top">
        <span className="ep-slider-l">{label}</span>
        <span className="ep-slider-v mono">
          {format ? format(value) : value.toFixed(step >= 1 ? 0 : 2)}
          {reset !== undefined && Math.abs(value - reset) > 1e-6 && (
            <button type="button" className="ep-slider-reset" title="Restaurar" onClick={(e) => { e.preventDefault(); onChange(reset, true); }}>↺</button>
          )}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ ['--p' as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => onChange(Number(e.target.value), g.begin())}
        onPointerUp={g.end} onKeyUp={g.end} onBlur={g.end}
        // setas/Home/End ajustam o valor aqui — não deixam os atalhos globais da timeline moverem o playhead
        onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) e.stopPropagation(); }}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="ep-toggle">
      <span className="ep-toggle-l">{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ep-toggle-sw" aria-hidden="true" />
    </label>
  );
}

const SWATCHES = ['#FFFFFF', '#1C1F22', '#D9641E', '#FFD23F', '#3BE37A', '#00E5FF', '#FF3DCB', '#E0473A'];

export function ColorField({ label, value, onChange, allowNone }: { label: string; value: string | undefined; onChange: OnValue<string>; allowNone?: boolean }) {
  const g = useGesture();
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="ep-color">
      <span className="ep-color-l">{label}</span>
      <div className="ep-color-row">
        {allowNone && (
          <button type="button" className={`ep-sw none${!value ? ' on' : ''}`} title="Nenhuma" onClick={() => onChange('', true)} />
        )}
        {SWATCHES.map((c) => (
          <button key={c} type="button" className={`ep-sw${value?.toUpperCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c, true)} />
        ))}
        <label className="ep-sw pick" title="Outra cor">
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value.toUpperCase(), g.begin())} onBlur={g.end} />
        </label>
      </div>
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, small }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`ep-pseg${small ? ' sm' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} title={o.title} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** campo de texto que registra histórico só no início da digitação */
export function TextField({ label, value, onChange, multiline, placeholder }: { label?: string; value: string; onChange: OnValue<string>; multiline?: boolean; placeholder?: string }) {
  const g = useGesture();
  const props = {
    className: multiline ? 'ep-textarea ep-ptext' : 'ep-input',
    value, placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value, g.begin()),
    onBlur: g.end,
  };
  return (
    <label className="ep-pfield">
      {label && <span className="ep-label">{label}</span>}
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
    </label>
  );
}

/** número editável com commit no blur/Enter (ex.: tempos "0:03.4") */
export function CommitInput({ value, format, parse, onCommit, className, ariaLabel }: {
  value: number; format: (v: number) => string; parse: (s: string) => number | null; onCommit: (v: number) => void; className?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(format(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(format(value)); }, [value, focus, format]);
  const commit = () => {
    const v = parse(text);
    if (v !== null && Math.abs(v - value) > 1e-4) onCommit(v);
    else setText(format(value));
  };
  return (
    <input
      className={className ?? 'ep-input mono'} aria-label={ariaLabel} value={text}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); commit(); }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(format(value)); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

export function EmptyHint({ icon, title, text, children }: { icon?: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="ep-phint">
      {icon && <div className="ic">{icon}</div>}
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
