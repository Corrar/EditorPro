'use client';
/* Minimapa: visão do projeto inteiro + janela visível; tocar/arrastar rola a timeline. */
import { memo, useRef } from 'react';
import { useEditor, useDuration } from '@/lib/store';
import { useTimelineUi } from '@/lib/timeline/ui';

export const Minimap = memo(function Minimap({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement> }) {
  const tracks = useEditor((s) => s.project.tracks);
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const duration = useDuration();
  const scrollLeft = useTimelineUi((s) => s.scrollLeft);
  const viewW = useTimelineUi((s) => s.viewW);
  const headerW = useTimelineUi((s) => s.dims.headerW);
  const ref = useRef<HTMLDivElement>(null);
  const total = Math.max(duration, 1) * 1.05;
  const pct = (t: number) => `${(t / total) * 100}%`;
  const winStart = Math.max(0, scrollLeft / zoom);
  const winLen = Math.max(0, (viewW - headerW) / zoom);
  const visual = tracks.filter((t) => t.clips.length);

  const scrollTo = (clientX: number, grabOffset = winLen / 2) => {
    const el = scrollRef.current;
    const r = ref.current?.getBoundingClientRect();
    if (!el || !r) return;
    const t = ((clientX - r.left) / r.width) * total - grabOffset;
    el.scrollLeft = Math.max(0, t * zoom);
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const tAt = ((e.clientX - r.left) / r.width) * total;
    const inside = tAt >= winStart && tAt <= winStart + winLen;
    const grab = inside ? tAt - winStart : winLen / 2;
    scrollTo(e.clientX, grab);
    const move = (ev: PointerEvent) => scrollTo(ev.clientX, grab);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (winLen >= total) return null; // tudo cabe na tela: minimapa não ajuda
  return (
    <div className="ep-tl-mini" ref={ref} onPointerDown={onDown} role="scrollbar" aria-label="Minimapa da timeline" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(winStart)}>
      {visual.map((t, i) => (
        <div key={t.id} className={`row k-${t.kind}`} style={{ top: `${(i / Math.max(visual.length, 1)) * 100}%`, height: `${100 / Math.max(visual.length, 1)}%` }}>
          {t.clips.map((c) => (
            <i key={c.id} style={{ left: pct(c.start), width: pct(c.duration) }} />
          ))}
        </div>
      ))}
      <span className="win" style={{ left: pct(winStart), width: pct(winLen) }} />
      <span className="ph" style={{ left: pct(playhead) }} />
    </div>
  );
});
