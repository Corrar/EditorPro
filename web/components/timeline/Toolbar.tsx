'use client';
/* Barra de ferramentas da timeline */
import { memo, useEffect, useRef } from 'react';
import { useEditor, useDuration } from '@/lib/store';
import { useDims, useTimelineUi } from '@/lib/timeline/ui';
import { formatTime } from '@/lib/util';
import { ICopy, IFit, IMagnet, IMore, IPause, IPlay, IRedo, IRipple, ISplit, ITrash, IUndo, IZoomIn, IZoomOut } from './icons';

export const ZMIN = 8;
export const ZMAX = 400;
const toSlider = (z: number) => (Math.log(z / ZMIN) / Math.log(ZMAX / ZMIN)) * 100;
const fromSlider = (v: number) => ZMIN * Math.pow(ZMAX / ZMIN, v / 100);

export interface ToolbarActions {
  split: () => void;
  remove: () => void;
  zoomTo: (z: number) => void;
  fit: () => void;
  duplicate: () => void;
  rippleRemove: () => void;
}

function TimeReadout({ compact }: { compact?: boolean }) {
  const t = useEditor((s) => s.playhead);
  const fps = useEditor((s) => s.project.fps);
  const total = useDuration();
  return (
    <div className={`ep-tl-time mono${compact ? ' compact' : ''}`} aria-label="Tempo atual e total">
      <b>{formatTime(t, { fps })}</b>
      {!compact && <span>/</span>}
      {!compact && <span>{formatTime(total, { fps })}</span>}
    </div>
  );
}

/* menu "⋯" com os itens menos usados (toolbar compacta) */
function OverflowMenu({ actions, anchor }: { actions: ToolbarActions; anchor: React.RefObject<HTMLButtonElement> }) {
  const open = useTimelineUi((s) => s.overflowOpen);
  const snapping = useTimelineUi((s) => s.snapping);
  const setUi = useTimelineUi((s) => s.set);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      const t = e.target as Node;
      if (e instanceof PointerEvent && (ref.current?.contains(t) || anchor.current?.contains(t))) return;
      setUi({ overflowOpen: false });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, setUi, anchor]);
  if (!open || !anchor.current) return null;
  const r = anchor.current.getBoundingClientRect();
  const run = (fn: () => void) => () => { setUi({ overflowOpen: false }); fn(); };
  const top = r.bottom + 6 + 230 > window.innerHeight ? Math.max(8, r.top - 6 - 230) : r.bottom + 6;
  return (
    <div ref={ref} className="ep-tl-menu" role="menu" style={{ top, right: Math.max(8, window.innerWidth - r.right) }}>
      <button role="menuitemcheckbox" aria-checked={snapping} onClick={run(() => setUi({ snapping: !snapping }))}>
        <IMagnet size={15} /> Ímã {snapping ? 'ligado' : 'desligado'}
      </button>
      <button role="menuitem" onClick={run(actions.fit)}><IFit size={15} /> Ajustar à tela</button>
      <div className="ep-tl-menusep" />
      <button role="menuitem" disabled={!hasSel} onClick={run(actions.duplicate)}><ICopy size={15} /> Duplicar</button>
      <button role="menuitem" className="danger" disabled={!hasSel} onClick={run(actions.rippleRemove)}><IRipple size={15} /> Excluir com ripple</button>
    </div>
  );
}

function PlayBtn() {
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  return (
    <button className="ep-tl-play" onClick={() => setPlaying(!playing)} title={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
      {playing ? <IPause size={14} /> : <IPlay size={14} />}
    </button>
  );
}

function ToolbarInner({ actions }: { actions: ToolbarActions }) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useTimelineUi((s) => s.snapping);
  const setUi = useTimelineUi((s) => s.set);
  const overflowOpen = useTimelineUi((s) => s.overflowOpen);
  const { compact } = useDims();
  const moreRef = useRef<HTMLButtonElement>(null);

  if (compact)
    return (
      <div className="ep-tl-bar compact" role="toolbar" aria-label="Ferramentas da timeline">
        <div className="ep-tl-barscroll">
          <PlayBtn />
          <TimeReadout compact />
          <span className="ep-tl-sep" />
          <button className="ep-tl-btn" onClick={undo} disabled={!canUndo} aria-label="Desfazer"><IUndo /></button>
          <button className="ep-tl-btn" onClick={redo} disabled={!canRedo} aria-label="Refazer"><IRedo /></button>
          <button className="ep-tl-btn" onClick={actions.split} aria-label="Dividir no cursor"><ISplit /></button>
          <button className="ep-tl-btn" onClick={actions.remove} disabled={!hasSel} aria-label="Excluir"><ITrash /></button>
          <span className="ep-tl-sep" />
          <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom / 1.4)} aria-label="Diminuir zoom"><IZoomOut /></button>
          <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom * 1.4)} aria-label="Aumentar zoom"><IZoomIn /></button>
        </div>
        <button
          ref={moreRef}
          className={`ep-tl-btn more${overflowOpen ? ' on' : ''}`}
          onClick={() => setUi({ overflowOpen: !overflowOpen })}
          aria-label="Mais opções"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
        >
          <IMore />
        </button>
        <OverflowMenu actions={actions} anchor={moreRef} />
      </div>
    );

  return (
    <div className="ep-tl-bar" role="toolbar" aria-label="Ferramentas da timeline">
      <div className="ep-tl-grp">
        <button className="ep-tl-btn" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><IUndo /></button>
        <button className="ep-tl-btn" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><IRedo /></button>
        <span className="ep-tl-sep" />
        <button className="ep-tl-btn" onClick={actions.split} title="Dividir no playhead (S)" aria-label="Dividir"><ISplit /></button>
        <button className="ep-tl-btn" onClick={actions.remove} disabled={!hasSel} title="Excluir (Delete) · Shift+Delete exclui com ripple" aria-label="Excluir"><ITrash /></button>
        <span className="ep-tl-sep" />
        <button
          className={`ep-tl-btn${snapping ? ' on' : ''}`}
          onClick={() => setUi({ snapping: !snapping })}
          title={snapping ? 'Ímã ligado (encaixe automático)' : 'Ímã desligado'}
          aria-pressed={snapping}
          aria-label="Ímã"
        >
          <IMagnet />
        </button>
      </div>

      <div className="ep-tl-grp mid">
        <PlayBtn />
        <TimeReadout />
      </div>

      <div className="ep-tl-grp end">
        <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom / 1.4)} title="Diminuir zoom (-)" aria-label="Diminuir zoom"><IZoomOut /></button>
        <input
          className="ep-tl-zoom"
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={toSlider(zoom)}
          onChange={(e) => actions.zoomTo(fromSlider(+e.target.value))}
          aria-label="Zoom da timeline"
          style={{ ['--p' as string]: `${toSlider(zoom)}%` }}
        />
        <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom * 1.4)} title="Aumentar zoom (+)" aria-label="Aumentar zoom"><IZoomIn /></button>
        <button className="ep-tl-pill" onClick={actions.fit} title="Ajustar à tela"><IFit size={14} /> Ajustar à tela</button>
      </div>
    </div>
  );
}

export const Toolbar = memo(ToolbarInner);
