'use client';
/* =====================================================================
   Editor de curvas: Mestre/R/G/B. Toque no vazio adiciona um ponto (e já
   arrasta), arraste move, toque longo (ou duplo toque) remove. As pontas
   só sobem/descem. Histograma do canal ao fundo.
   ===================================================================== */
import { useMemo, useRef, useState } from 'react';
import type { ColorGrade, CurvePoint } from '@/lib/types';
import { cleanCurve } from '@/lib/color/grade';
import { monotoneSpline } from '@/lib/color/curves';
import type { ScopeData } from '@/lib/color/scopes';
import Icon from '@/components/ui/Icon';
import { Pills, type Phase } from './controls';

type SetGrade = (fn: (g: ColorGrade) => ColorGrade, phase: Phase) => void;
type Ch = 'master' | 'r' | 'g' | 'b';
const CH_COLOR: Record<Ch, string> = { master: 'var(--ink)', r: '#FF4D4D', g: '#2FD36B', b: '#4D8BFF' };
const IDENT: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const LONG_MS = 520;

function pointsOf(g: ColorGrade, ch: Ch): CurvePoint[] {
  return cleanCurve(g.curves?.[ch]) ?? IDENT;
}

export function CurvesTab({ grade, set, scopes }: { grade: ColorGrade; set: SetGrade; scopes?: ScopeData | null }) {
  const [ch, setCh] = useState<Ch>('master');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; idx: number; pts: CurvePoint[]; x0: number; y0: number; moved: boolean; timer?: number } | null>(null);
  const lastTap = useRef<{ idx: number; at: number }>({ idx: -1, at: 0 });
  const [active, setActive] = useState<number | null>(null);
  const pts = pointsOf(grade, ch);

  const path = useMemo(() => {
    const f = monotoneSpline(pts);
    let d = '';
    for (let i = 0; i <= 128; i++) { const x = i / 128; d += `${i ? 'L' : 'M'}${(x * 100).toFixed(2)},${((1 - f(x)) * 100).toFixed(2)}`; }
    return d;
  }, [pts]);

  const hist = useMemo(() => {
    if (!scopes) return '';
    const h = ch === 'r' ? scopes.histR : ch === 'g' ? scopes.histG : ch === 'b' ? scopes.histB : scopes.histL;
    let mx = 1;
    for (let i = 1; i < 255; i++) mx = Math.max(mx, h[i]);
    let d = 'M0,100';
    for (let i = 0; i < 256; i += 2) d += `L${((i / 255) * 100).toFixed(2)},${(100 - Math.min(1, Math.sqrt(h[i] / mx)) * 96).toFixed(2)}`;
    return d + 'L100,100Z';
  }, [scopes, ch]);

  const write = (next: CurvePoint[], phase: Phase) =>
    set((g) => ({ ...g, curves: { ...(g.curves ?? {}), [ch]: next } }), phase);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) };
  };

  const remove = (idx: number, list: CurvePoint[]) => {
    if (idx <= 0 || idx >= list.length - 1) return;
    write(list.filter((_, i) => i !== idx), 'once');
    setActive(null);
  };

  const hitIndex = (x: number, y: number, list: CurvePoint[]) => {
    const r = svg.current!.getBoundingClientRect();
    const tol = 22 / Math.max(1, r.width); // ~22px de alvo
    let best = -1, bd = Infinity;
    list.forEach((p, i) => { const d = Math.hypot(p.x - x, (p.y - y) * (r.height / r.width)); if (d < bd) { bd = d; best = i; } });
    return bd <= tol ? best : -1;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toLocal(e);
    let list = pts.map((q) => ({ ...q }));
    let idx = hitIndex(p.x, p.y, list);
    // duplo toque num ponto = remover
    const now = performance.now();
    if (idx > 0 && idx < list.length - 1 && lastTap.current.idx === idx && now - lastTap.current.at < 320) {
      lastTap.current = { idx: -1, at: 0 };
      remove(idx, list);
      return;
    }
    lastTap.current = { idx, at: now };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (idx < 0) {
      // novo ponto em x tocado (y = onde tocou), mantendo distância das vizinhas
      if (list.some((q) => Math.abs(q.x - p.x) < 0.02)) return;
      list.push({ x: p.x, y: p.y });
      list.sort((a, b) => a.x - b.x);
      idx = list.findIndex((q) => q.x === p.x);
      write(list, 'start');
      drag.current = { id: e.pointerId, idx, pts: list, x0: e.clientX, y0: e.clientY, moved: true };
    } else {
      set((g) => g, 'start');
      drag.current = { id: e.pointerId, idx, pts: list, x0: e.clientX, y0: e.clientY, moved: false };
      if (idx > 0 && idx < list.length - 1) {
        drag.current.timer = window.setTimeout(() => {
          const d = drag.current;
          if (d && !d.moved) { drag.current = null; remove(d.idx, d.pts); navigator.vibrate?.(15); }
        }, LONG_MS);
      }
    }
    setActive(idx);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    window.clearTimeout(d.timer);
    const p = toLocal(e);
    const list = d.pts.map((q) => ({ ...q }));
    const i = d.idx;
    const last = list.length - 1;
    if (i === 0 || i === last) list[i] = { x: list[i].x, y: p.y };
    else list[i] = { x: Math.min(list[i + 1].x - 0.01, Math.max(list[i - 1].x + 0.01, p.x)), y: p.y };
    d.pts = list;
    write(list, 'move');
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    window.clearTimeout(d.timer);
    drag.current = null;
    write(d.pts, 'end');
  };

  const changed = (c: Ch) => !!cleanCurve(grade.curves?.[c]);

  return (
    <div className="ec-curves">
      <div className="ec-row-between">
        <Pills<Ch>
          label="Canal da curva" value={ch} onChange={(v) => { setCh(v); setActive(null); }}
          options={[
            { id: 'master', label: 'Mestre', dot: '#E9E9E6', mark: changed('master') },
            { id: 'r', label: 'R', dot: CH_COLOR.r, mark: changed('r') },
            { id: 'g', label: 'G', dot: CH_COLOR.g, mark: changed('g') },
            { id: 'b', label: 'B', dot: CH_COLOR.b, mark: changed('b') },
          ]}
        />
        <button type="button" className="ec-icon-btn" aria-label="Restaurar curva" title="Restaurar curva" disabled={!changed(ch)}
          onClick={() => set((g) => { const c = { ...(g.curves ?? {}) }; delete c[ch]; return { ...g, curves: c }; }, 'once')}>
          <Icon name="rotate" size={16} />
        </button>
      </div>
      <div className="ec-curve-box">
        <svg
          ref={svg}
          className="ec-curve-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="Curva: toque para adicionar ponto, arraste para mover, toque longo para remover"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          {hist && <path d={hist} className="ec-curve-hist" style={{ fill: ch === 'master' ? undefined : CH_COLOR[ch] }} />}
          {[25, 50, 75].map((v) => <g key={v}><line x1={v} y1={0} x2={v} y2={100} className="ec-curve-grid" /><line x1={0} y1={v} x2={100} y2={v} className="ec-curve-grid" /></g>)}
          <line x1={0} y1={100} x2={100} y2={0} className="ec-curve-diag" />
          <path d={path} className="ec-curve-line" style={{ stroke: CH_COLOR[ch] }} />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x * 100} cy={(1 - p.y) * 100} r={active === i ? 2.6 : 2}
              className={`ec-curve-pt${active === i ? ' on' : ''}`} style={{ stroke: CH_COLOR[ch] }} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <p className="ec-hint">Toque para adicionar um ponto · arraste para mover · toque longo (ou duplo) para remover</p>
    </div>
  );
}
