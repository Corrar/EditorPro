'use client';
/* =====================================================================
   Rodas de cor (lift/gamma/gain/offset) estilo DaVinci: disco arrastável
   (relativo e fino, como no painel do Resolve), anel/régua de mestre
   (luminância) logo abaixo, botão de reset e duplo toque p/ zerar.
   ===================================================================== */
import { useMemo, useRef } from 'react';
import type { ColorGrade, ColorWheel } from '@/lib/types';
import { WHEEL_KEYS, WHEEL_LABELS, isNeutralWheel, type WheelKey } from '@/lib/color/grade';
import { puckColor, puckFromWheel, wheelFromPuck } from '@/lib/color/wheel';
import Icon from '@/components/ui/Icon';
import { useDoubleTap, type Phase } from './controls';

type SetGrade = (fn: (g: ColorGrade) => ColorGrade, phase: Phase) => void;

const RING_STOPS = 24;
/** anel de matiz alinhado com o vetorscópio (mesmo mapeamento do disco) */
function ringGradient(): string {
  const stops: string[] = [];
  for (let i = 0; i <= RING_STOPS; i++) {
    const a = (i / RING_STOPS) * Math.PI * 2; // a partir do topo, sentido horário
    stops.push(`${puckColor(Math.sin(a), Math.cos(a))} ${((i / RING_STOPS) * 360).toFixed(1)}deg`);
  }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

export function WheelControl({ k, wheel, set }: { k: WheelKey; wheel?: ColorWheel; set: SetGrade }) {
  const { x, y, master } = puckFromWheel(wheel);
  const disc = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; px: number; py: number; x0: number; y0: number; fine: number; last: ColorWheel } | null>(null);
  const jog = useRef<{ id: number; px: number; m0: number; last: number; active: boolean; py: number; touch: boolean } | null>(null);
  const ring = useMemo(ringGradient, []);

  const write = (w: ColorWheel, phase: Phase) => set((g) => ({ ...g, [k]: w }), phase);
  const resetColor = useDoubleTap(() => write(wheelFromPuck(0, 0, master), 'once'));
  const resetMaster = useDoubleTap(() => write(wheelFromPuck(x, y, 0), 'once'));
  const neutral = isNeutralWheel(wheel);
  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);

  return (
    <div className={`ec-wheel${neutral ? '' : ' changed'}`}>
      <div className="ec-wheel-h">
        <span className="ec-wheel-t">{WHEEL_LABELS[k]}</span>
        <button type="button" className="ec-icon-btn" aria-label={`Restaurar ${WHEEL_LABELS[k]}`} title="Restaurar" disabled={neutral}
          onClick={() => write({ r: 0, g: 0, b: 0, y: 0 }, 'once')}>
          <Icon name="rotate" size={16} />
        </button>
      </div>
      <div
        ref={disc}
        className="ec-disc"
        style={{ ['--ring' as string]: ring }}
        role="group"
        aria-label={`Roda ${WHEEL_LABELS[k]}: arraste para mudar a cor; duplo toque restaura`}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (resetColor()) { e.preventDefault(); return; }
          e.currentTarget.setPointerCapture(e.pointerId);
          // relativo: o disco não "pula" para o dedo; mouse com Shift = ainda mais fino
          drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, x0: x, y0: y, fine: 1, last: wheel ?? { r: 0, g: 0, b: 0, y: 0 } };
          set((g) => g, 'start');
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const r = disc.current!.getBoundingClientRect().width / 2;
          const sens = (e.shiftKey ? 0.25 : 0.6) / r;
          let nx = d.x0 + (e.clientX - d.px) * sens, ny = d.y0 - (e.clientY - d.py) * sens;
          const m = Math.hypot(nx, ny);
          if (m > 1) { nx /= m; ny /= m; }
          if (Math.hypot(nx, ny) < 0.025) { nx = 0; ny = 0; } // ímã no centro
          d.last = wheelFromPuck(nx, ny, master);
          write(d.last, 'move');
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          write(d.last, 'end');
        }}
        onPointerCancel={() => { const d = drag.current; drag.current = null; if (d) write(d.last, 'end'); }}
        onKeyDown={(e) => {
          const s = e.shiftKey ? 0.1 : 0.02;
          let nx = x, ny = y;
          if (e.key === 'ArrowLeft') nx -= s; else if (e.key === 'ArrowRight') nx += s;
          else if (e.key === 'ArrowUp') ny += s; else if (e.key === 'ArrowDown') ny -= s;
          else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') { nx = 0; ny = 0; }
          else return;
          e.preventDefault(); e.stopPropagation();
          write(wheelFromPuck(nx, ny, master), 'once');
        }}
      >
        <span className="ec-disc-face" />
        <span className="ec-disc-cross" />
        <span className="ec-puck" style={{ left: `${50 + x * 42}%`, top: `${50 - y * 42}%`, background: neutral ? undefined : puckColor(x, y) }} />
      </div>
      <div
        className="ec-jog"
        role="slider"
        tabIndex={0}
        aria-label={`Mestre de ${WHEEL_LABELS[k]} (luminância)`}
        aria-valuemin={-1} aria-valuemax={1} aria-valuenow={Number(master.toFixed(3))}
        style={{ ['--m' as string]: `${50 + master * 50}%` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (resetMaster()) { e.preventDefault(); return; }
          const touch = e.pointerType !== 'mouse';
          jog.current = { id: e.pointerId, px: e.clientX, py: e.clientY, m0: master, last: master, active: !touch, touch };
          if (!touch) { e.currentTarget.setPointerCapture(e.pointerId); set((g) => g, 'start'); }
        }}
        onPointerMove={(e) => {
          const j = jog.current;
          if (!j || j.id !== e.pointerId) return;
          if (!j.active) {
            const dx = e.clientX - j.px, dy = e.clientY - j.py;
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
            j.active = true; j.px = e.clientX;
            e.currentTarget.setPointerCapture(e.pointerId);
            set((g) => g, 'start');
            return;
          }
          const w = e.currentTarget.getBoundingClientRect().width;
          let m = j.m0 + ((e.clientX - j.px) / w) * (e.shiftKey ? 0.5 : 1.4);
          m = Math.max(-1, Math.min(1, m));
          if (Math.abs(m) < 0.01) m = 0;
          j.last = Math.round(m * 1000) / 1000;
          write(wheelFromPuck(x, y, j.last), 'move');
        }}
        onPointerUp={(e) => {
          const j = jog.current;
          if (!j || j.id !== e.pointerId) return;
          jog.current = null;
          if (j.active) write(wheelFromPuck(x, y, j.last), 'end');
        }}
        onPointerCancel={() => { const j = jog.current; jog.current = null; if (j?.active) write(wheelFromPuck(x, y, j.last), 'end'); }}
        onKeyDown={(e) => {
          const s = e.shiftKey ? 0.1 : 0.01;
          let m = master;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') m -= s; else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') m += s;
          else if (e.key === '0' || e.key === 'Delete') m = 0; else return;
          e.preventDefault(); e.stopPropagation();
          write(wheelFromPuck(x, y, Math.max(-1, Math.min(1, m))), 'once');
        }}
      >
        <span className="ec-jog-ticks" />
        <span className="ec-jog-mark" />
      </div>
      <div className="ec-wheel-vals mono" aria-hidden="true">
        <span className="r">{fmt(wheel?.r ?? 0)}</span><span className="g">{fmt(wheel?.g ?? 0)}</span><span className="b">{fmt(wheel?.b ?? 0)}</span><span className="y">Y {fmt(master)}</span>
      </div>
    </div>
  );
}

export function WheelsTab({ grade, set }: { grade: ColorGrade; set: SetGrade }) {
  return (
    <div className="ec-wheels">
      {WHEEL_KEYS.map((k) => <WheelControl key={k} k={k} wheel={grade[k]} set={set} />)}
    </div>
  );
}
