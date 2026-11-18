'use client';
/* Régua com timecodes adaptados ao zoom + cabeça do playhead.
   Marcas menores/maiores são gradientes CSS; rótulos só na faixa visível. */
import { memo } from 'react';
import { useEditor } from '@/lib/store';
import { useDims, useTimelineUi } from '@/lib/timeline/ui';
import { formatTick, rulerSteps } from '@/lib/timeline/edit';
import { RulerMarkers } from './Markers';

function Labels({ zoom, fps, width }: { zoom: number; fps: number; width: number }) {
  const scrollLeft = useTimelineUi((s) => s.scrollLeft);
  const viewW = useTimelineUi((s) => s.viewW);
  const { headerW: HEADER_W, compact } = useDims();
  const { major } = rulerSteps(zoom, fps, compact ? 56 : 72);
  const from = Math.max(0, Math.floor((scrollLeft - HEADER_W) / zoom / major) - 1);
  const to = Math.ceil((scrollLeft + viewW) / zoom / major) + 1;
  const out = [];
  for (let i = from; i <= to; i++) {
    const t = i * major;
    const x = t * zoom;
    if (x > width) break;
    const label = formatTick(t, major, fps);
    out.push(
      <span key={i} className={`ep-tl-tick mono${label.endsWith('f') ? ' sub' : ''}`} style={{ transform: `translateX(${x}px)` }}>
        {label}
      </span>,
    );
  }
  return <>{out}</>;
}

function PlayheadHead({ zoom }: { zoom: number }) {
  const t = useEditor((s) => s.playhead);
  const live = useEditor((s) => s.live.running);
  return (
    <div className={`ep-tl-phead${live ? ' smooth' : ''}`} style={{ transform: `translateX(${t * zoom}px)` }} aria-hidden>
      <svg width="14" height="16" viewBox="0 0 14 16"><path d="M1 1h12v8l-6 6-6-6z" /></svg>
    </div>
  );
}

function RulerInner({ zoom, width, onScrubStart }: { zoom: number; width: number; onScrubStart: (e: React.PointerEvent) => void }) {
  const fps = useEditor((s) => s.project.fps);
  const { headerW, rulerH, compact, short } = useDims();
  const { major, minor } = rulerSteps(zoom, fps, compact ? 56 : 72);
  const majorPx = major * zoom;
  const minorPx = minor * zoom;
  return (
    <div className={`ep-tl-ruler${short ? ' short' : ''}`} style={{ height: rulerH }}>
      <div className="ep-tl-corner" style={{ width: headerW }}>
        {!compact && !short && <span className="ep-label">Trilhas</span>}
      </div>
      <div
        className="ep-tl-scale"
        style={{
          width,
          backgroundImage: short
            ? `repeating-linear-gradient(90deg, var(--tl-tickMajor) 0 1px, transparent 1px ${majorPx}px)`
            : `repeating-linear-gradient(90deg, var(--tl-tickMajor) 0 1px, transparent 1px ${majorPx}px),` +
              `repeating-linear-gradient(90deg, var(--tl-tick) 0 1px, transparent 1px ${minorPx}px)`,
        }}
        onPointerDown={onScrubStart}
        title="Clique ou arraste para mover o cursor de reprodução"
      >
        {!short && <Labels zoom={zoom} fps={fps} width={width} />}
        <RulerMarkers zoom={zoom} />
        <PlayheadHead zoom={zoom} />
      </div>
    </div>
  );
}

export const Ruler = memo(RulerInner);
