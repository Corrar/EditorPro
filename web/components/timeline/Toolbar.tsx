'use client';
/* Barra de ferramentas da timeline */
import { memo } from 'react';
import { useEditor, useDuration } from '@/lib/store';
import { useTimelineUi } from '@/lib/timeline/ui';
import { formatTime } from '@/lib/util';
import { IFit, IMagnet, IPause, IPlay, IRedo, ISplit, ITrash, IUndo, IZoomIn, IZoomOut } from './icons';

export const ZMIN = 8;
export const ZMAX = 400;
const toSlider = (z: number) => (Math.log(z / ZMIN) / Math.log(ZMAX / ZMIN)) * 100;
const fromSlider = (v: number) => ZMIN * Math.pow(ZMAX / ZMIN, v / 100);

export interface ToolbarActions {
  split: () => void;
  remove: () => void;
  zoomTo: (z: number) => void;
  fit: () => void;
}

function TimeReadout() {
  const t = useEditor((s) => s.playhead);
  const fps = useEditor((s) => s.project.fps);
  const total = useDuration();
  return (
    <div className="ep-tl-time mono" aria-label="Tempo atual e total">
      <b>{formatTime(t, { fps })}</b>
      <span>/</span>
      <span>{formatTime(total, { fps })}</span>
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
