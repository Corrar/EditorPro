'use client';
/* =====================================================================
   Controles dos painéis. Cada controle avisa `history=true` só no INÍCIO
   do gesto (arrastar slider, digitar, escolher cor) — o resto do gesto
   vai sem histórico. Assim um arraste = um passo de desfazer.
   ===================================================================== */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { typedToValue, valueToTyped } from './kf';

export type OnValue<T> = (v: T, history: boolean) => void;

function useGesture() {
  const started = useRef(false);
  return {
    begin: () => { const first = !started.current; started.current = true; return first; },
    end: () => { started.current = false; },
  };
}

const SEC_OPEN_KEY = 'ep_sec_open';

/**
 * Seção recolhível (padrão DaVinci): toque no título abre/fecha (lembrado no aparelho);
 * `onReset` mostra ↺ "Redefinir" no cabeçalho; `collapsible={false}` fixa aberta.
 */
/** quem monta várias seções empilhadas diz quais começam abertas (título → aberta?) */
export const SectionDefaults = createContext<((title: string) => boolean) | null>(null);

export function Section({ title, children, right, onReset, collapsible = true, defaultOpen }: {
  title: string; children: ReactNode; right?: ReactNode; onReset?: () => void; collapsible?: boolean; defaultOpen?: boolean;
}) {
  const ctx = useContext(SectionDefaults);
  const initial = defaultOpen ?? (ctx ? ctx(title) : true);
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    if (!collapsible) return;
    try {
      const v = JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || '{}')[title];
      if (typeof v === 'boolean') setOpen(v);
    } catch { /* sem armazenamento */ }
  }, [collapsible, title]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      const m = JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || '{}');
      m[title] = next;
      localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(m));
    } catch { /* sem armazenamento */ }
  };
  return (
    <section className={`ep-psec${collapsible && !open ? ' closed' : ''}`}>
      <div className="ep-psec-h">
        {collapsible ? (
          <button type="button" className="ep-psec-t" onClick={toggle} aria-expanded={open}>
            <span className="ep-psec-chev" aria-hidden="true">▾</span>{title}
          </button>
        ) : <span>{title}</span>}
        <span className="ep-psec-r">
          {right}
          {onReset && open && <button type="button" className="ep-psec-reset" onClick={onReset} title={`Redefinir ${title.toLowerCase()}`} aria-label={`Redefinir ${title}`}>↺</button>}
        </span>
      </div>
      {(!collapsible || open) && children}
    </section>
  );
}

/** keyframe de uma propriedade no slider (diamante): `at` = existe no quadro atual, `animated` = a propriedade tem keyframes */
export interface SliderKf { at: boolean; animated: boolean; disabled?: boolean; toggle: () => void }

export function Slider({
  label, value, min, max, step = 0.01, onChange, format, reset, kf,
}: {
  label: string; value: number; min: number; max: number; step?: number; onChange: OnValue<number>;
  format?: (v: number) => string; reset?: number; kf?: SliderKf;
}) {
  const g = useGesture();
  const [editing, setEditing] = useState<string | null>(null);
  const pct = ((value - min) / (max - min)) * 100;
  const shown = format ? format(value) : value.toFixed(step >= 1 ? 0 : 2);
  const commit = () => {
    if (editing === null) return;
    const v = typedToValue(editing, shown, min, max);
    setEditing(null);
    if (v !== null && Math.abs(v - value) > 1e-9) onChange(v, true);
  };
  return (
    <div className="ep-slider">
      <span className="ep-slider-top">
        <span className="ep-slider-l">
          {kf && (
            <button
              type="button" className={`ep-kfbtn${kf.at ? ' at' : kf.animated ? ' anim' : ''}`} disabled={kf.disabled} onClick={kf.toggle}
              aria-pressed={kf.at} aria-label={kf.at ? `Remover keyframe de ${label}` : `Adicionar keyframe de ${label}`}
              title={kf.disabled ? 'Posicione o cursor sobre o clipe' : kf.at ? 'Remover keyframe neste ponto' : 'Adicionar keyframe neste ponto'}
            ><i aria-hidden="true" /></button>
          )}
          {label}
        </span>
        <span className="ep-slider-v mono">
          {editing !== null ? (
            <input
              className="ep-slider-in" autoFocus onFocus={(e) => e.target.select()} inputMode="decimal" value={editing} aria-label={`${label}: digite o valor`}
              onChange={(e) => setEditing(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
            />
          ) : (
            <button type="button" className="ep-slider-num" onClick={() => setEditing(valueToTyped(value, shown))} title="Toque para digitar" aria-label={`${label}: ${shown}. Toque para digitar`}>{shown}</button>
          )}
          {reset !== undefined && Math.abs(value - reset) > 1e-6 && (
            <button type="button" className="ep-slider-reset" title="Restaurar" aria-label={`Restaurar ${label}`} onClick={(e) => { e.preventDefault(); onChange(reset, true); }}>↺</button>
          )}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ ['--p' as string]: `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(e) => onChange(Number(e.target.value), g.begin())}
        onPointerUp={g.end} onKeyUp={g.end} onBlur={g.end}
        // setas/Home/End ajustam o valor aqui — não deixam os atalhos globais da timeline moverem o playhead
        onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) e.stopPropagation(); }}
      />
    </div>
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
