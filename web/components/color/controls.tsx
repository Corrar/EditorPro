'use client';
/* =====================================================================
   Controles da página de Cor: slider bipolar (centro = neutro) com alvo
   de toque de 44px, duplo toque para restaurar, teclado e ARIA.
   ===================================================================== */
import { useRef, type ReactNode } from 'react';

export type Phase = 'start' | 'move' | 'end' | 'once';
export type OnPhase = (v: number, phase: Phase) => void;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** detector de duplo toque (pointer) */
export function useDoubleTap(fn: () => void, ms = 320) {
  const last = useRef(0);
  return () => {
    const now = performance.now();
    if (now - last.current < ms) { last.current = 0; fn(); return true; }
    last.current = now;
    return false;
  };
}

export function ColorSlider({
  label, value, onChange, min = -1, max = 1, def = 0, format, track, step = 0.01, icon,
}: {
  label: string; value: number; onChange: OnPhase; min?: number; max?: number; def?: number;
  format?: (v: number) => string; track?: string; step?: number; icon?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; moved: boolean; touch: boolean; x0: number; y0: number; v0: number; active: boolean; last: number } | null>(null);
  const dbl = useDoubleTap(() => onChange(def, 'once'));
  const p = (clamp(value, min, max) - min) / (max - min);
  const pd = (def - min) / (max - min);
  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const k = clamp((clientX - r.left - 11) / Math.max(1, r.width - 22), 0, 1);
    let v = min + k * (max - min);
    // ímã no neutro
    if (Math.abs(v - def) < (max - min) * 0.012) v = def;
    return Math.round(v / step) * step;
  };
  const fmt = format ?? ((v: number) => (Math.abs(v) < 0.005 ? '0' : (v > 0 ? '+' : '') + Math.round(v * 100)));
  const changed = Math.abs(value - def) > 1e-4;
  return (
    <div className={`ec-slider${changed ? ' changed' : ''}`}>
      <div className="ec-slider-top">
        <span className="ec-slider-l">{icon}{label}</span>
        <button type="button" className="ec-slider-v mono" title="Toque duas vezes no controle para restaurar" onClick={() => changed && onChange(def, 'once')} aria-label={`${label}: ${fmt(value)}${changed ? ' — restaurar' : ''}`}>
          {fmt(value)}{changed && <span aria-hidden="true"> ↺</span>}
        </button>
      </div>
      <div
        ref={ref}
        className="ec-slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={fmt(value)}
        style={{ ['--p' as string]: `${p * 100}%`, ['--d' as string]: `${pd * 100}%`, ...(track ? { ['--trk' as string]: track } : {}) }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (dbl()) { e.preventDefault(); return; }
          const touch = e.pointerType !== 'mouse';
          drag.current = { id: e.pointerId, moved: false, touch, x0: e.clientX, y0: e.clientY, v0: value, active: !touch, last: value };
          if (!touch) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current.last = fromX(e.clientX);
            onChange(drag.current.last, 'start');
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (!d.active) {
            // toque: só vira arraste com movimento HORIZONTAL (vertical = rolar o painel)
            const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
            d.active = true;
            d.x0 = e.clientX;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            onChange(value, 'start');
            return;
          }
          d.moved = true;
          if (d.touch) {
            // relativo: o polegar não cobre o valor e dá precisão fina
            const w = ref.current!.getBoundingClientRect().width;
            let v = d.v0 + ((e.clientX - d.x0) / Math.max(1, w)) * (max - min);
            if (Math.abs(v - def) < (max - min) * 0.012) v = def;
            d.last = clamp(Math.round(v / step) * step, min, max);
          } else d.last = fromX(e.clientX);
          onChange(d.last, 'move');
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.active) onChange(d.last, 'end');
        }}
        onPointerCancel={() => { const d = drag.current; drag.current = null; if (d?.active) onChange(d.last, 'end'); }}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 10 : 1;
          let v: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value + step * big;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value - step * big;
          else if (e.key === 'Home') v = min;
          else if (e.key === 'End') v = max;
          else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '0') v = def;
          if (v === null) return;
          e.preventDefault(); e.stopPropagation();
          onChange(clamp(Math.round(v / step) * step, min, max), 'once');
        }}
      >
        <span className="ec-slider-rail" />
        <span className="ec-slider-fill" />
        <span className="ec-slider-def" />
        <span className="ec-slider-thumb" />
      </div>
    </div>
  );
}

/** grupo de pílulas (abas/canais) com rolagem horizontal */
export function Pills<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: ReactNode; dot?: string; title?: string; mark?: boolean }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ec-pills" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id} type="button" role="tab" aria-selected={value === o.id} title={o.title}
          className={`ec-pill${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)}
        >
          {o.dot && <span className="ec-dot" style={{ background: o.dot }} />}
          {o.label}
          {o.mark && <span className="ec-mark" aria-label="alterado" />}
        </button>
      ))}
    </div>
  );
}
