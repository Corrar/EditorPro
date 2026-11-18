'use client';
/* Barra de ferramentas da timeline (desktop e compacta) */
import { memo, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { TrackKind } from '@/lib/types';
import { useEditor, useDuration } from '@/lib/store';
import { useDims, useTimelineUi } from '@/lib/timeline/ui';
import { TRACK_NAMES } from '@/lib/ops';
import { formatTime } from '@/lib/util';
import {
  addTrack, copyClips, detachAudio, freezeFrame, pasteClips, setSpeed, toggleKeyframe,
} from '@/lib/timeline/actions';
import {
  IAudio, IAudioSplit, IClipboard, IComment, ICopy, IDiamond, IFit, IFlag, IGauge, IInsert, IMagnet, IMagnetTrack, IMore,
  IPause, IPlay, IPlus, IRedo, IRipple, ISliders, ISnowflake, ISplit, ISticker, IText, ITrash, IUndo, IVideo, IZoomIn, IZoomOut,
} from './icons';

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
  marker: () => void;
  comment: () => void;
}

const SPEEDS = [0.5, 1, 1.5, 2, 3];
const TRACK_KINDS: { kind: TrackKind; icon: typeof IVideo }[] = [
  { kind: 'video', icon: IVideo },
  { kind: 'text', icon: IText },
  { kind: 'audio', icon: IAudio },
  { kind: 'overlay', icon: ISticker },
  { kind: 'effect', icon: ISliders },
];

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

/** popover genérico ancorado num botão (fecha ao tocar fora / Esc) */
function Popover({ open, anchor, onClose, children, width = 240, role = 'menu' }: {
  open: boolean; anchor: RefObject<HTMLElement>; onClose: () => void; children: ReactNode; width?: number; role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      const t = e.target as Node;
      if (e instanceof PointerEvent && (ref.current?.contains(t) || anchor.current?.contains(t))) return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, onClose, anchor]);
  if (!open || !anchor.current) return null;
  const r = anchor.current.getBoundingClientRect();
  const estH = 320;
  const top = r.bottom + 6 + estH > window.innerHeight ? Math.max(8, r.top - 6 - estH) : r.bottom + 6;
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
  return (
    <div ref={ref} className="ep-tl-menu" role={role} style={{ top, left, minWidth: width }}>
      {children}
    </div>
  );
}

/** itens de configuração/ações menos usados (menu "⋯") */
function MoreItems({ actions, close, compact }: { actions: ToolbarActions; close: () => void; compact: boolean }) {
  const ui = useTimelineUi();
  const hasSel = useEditor((s) => s.selection.length > 0);
  const run = (fn: () => void) => () => { close(); fn(); };
  return (
    <>
      <div className="ep-tl-menuhead">Edição</div>
      <button role="menuitemcheckbox" aria-checked={ui.snapping} onClick={run(() => ui.set({ snapping: !ui.snapping }))}>
        <IMagnet size={15} /> Ímã (encaixe) <span className={`ep-tl-check${ui.snapping ? ' on' : ''}`} />
      </button>
      <button role="menuitemcheckbox" aria-checked={ui.magnetic} onClick={run(() => ui.set({ magnetic: !ui.magnetic }))}>
        <IMagnetTrack size={15} /> Trilha principal magnética <span className={`ep-tl-check${ui.magnetic ? ' on' : ''}`} />
      </button>
      <button role="menuitemcheckbox" aria-checked={ui.dropMode === 'overwrite'} onClick={run(() => ui.set({ dropMode: ui.dropMode === 'insert' ? 'overwrite' : 'insert' }))}>
        <IInsert size={15} /> Ao soltar: {ui.dropMode === 'insert' ? 'inserir (empurra)' : 'sobrescrever'}
      </button>
      <button role="menuitemcheckbox" aria-checked={ui.rangeMode} onClick={run(() => ui.set({ rangeMode: !ui.rangeMode }))}>
        <IFlag size={15} /> Selecionar trecho na régua <span className={`ep-tl-check${ui.rangeMode ? ' on' : ''}`} />
      </button>
      {!ui.dims.short && (
        <button role="menuitemcheckbox" aria-checked={ui.showMinimap} onClick={run(() => ui.set({ showMinimap: !ui.showMinimap }))}>
          <IFit size={15} /> Minimapa <span className={`ep-tl-check${ui.showMinimap ? ' on' : ''}`} />
        </button>
      )}
      <button role="menuitem" onClick={run(actions.fit)}><IFit size={15} /> Ajustar à tela</button>
      {compact && (
        <>
          <div className="ep-tl-menusep" />
          <div className="ep-tl-menuhead">Clipe</div>
          <button role="menuitem" disabled={!hasSel} onClick={run(actions.duplicate)}><ICopy size={15} /> Duplicar</button>
          <button role="menuitem" disabled={!hasSel} onClick={run(() => copyClips())}><IClipboard size={15} /> Copiar</button>
          <button role="menuitem" disabled={!ui.clipboard.length} onClick={run(() => pasteClips())}><IClipboard size={15} /> Colar no cursor</button>
          <button role="menuitem" disabled={!hasSel} onClick={run(() => detachAudio())}><IAudioSplit size={15} /> Separar áudio</button>
          <button role="menuitem" disabled={!hasSel} onClick={run(() => freezeFrame())}><ISnowflake size={15} /> Congelar quadro</button>
          <button role="menuitem" onClick={run(actions.marker)}><IFlag size={15} /> Marcador no cursor</button>
          <button role="menuitem" onClick={run(actions.comment)}><IComment size={15} /> Comentar</button>
          <button role="menuitem" className="danger" disabled={!hasSel} onClick={run(actions.rippleRemove)}><IRipple size={15} /> Excluir com ripple</button>
        </>
      )}
    </>
  );
}

function SpeedItems({ close }: { close: () => void }) {
  const cur = useEditor((s) => {
    const id = s.selection[0];
    for (const t of s.project.tracks) for (const c of t.clips) if (c.id === id && (c.type === 'video' || c.type === 'audio')) return c.speed;
    return undefined;
  });
  return (
    <>
      <div className="ep-tl-menuhead">Velocidade do clipe</div>
      <div className="ep-tl-speedrow big">
        {SPEEDS.map((sp) => (
          <button key={sp} className={cur != null && Math.abs(cur - sp) < 1e-3 ? 'on' : ''} disabled={cur == null} onClick={() => { close(); setSpeed(sp); }}>{sp}x</button>
        ))}
      </div>
      {cur == null && <div className="ep-tl-menunote">Selecione um clipe de vídeo ou áudio.</div>}
      <div className="ep-tl-menunote">Curvas (montagem, herói, bala…) ficam no painel do clipe.</div>
    </>
  );
}

function AddTrackItems({ close }: { close: () => void }) {
  return (
    <>
      <div className="ep-tl-menuhead">Adicionar trilha</div>
      {TRACK_KINDS.map(({ kind, icon: I }) => (
        <button key={kind} role="menuitem" onClick={() => { close(); addTrack(kind); }}>
          <I size={15} /> {TRACK_NAMES[kind]}
        </button>
      ))}
    </>
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

type PopKind = 'more' | 'speed' | 'add' | null;

function ToolbarInner({ actions }: { actions: ToolbarActions }) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useTimelineUi((s) => s.snapping);
  const magnetic = useTimelineUi((s) => s.magnetic);
  const setUi = useTimelineUi((s) => s.set);
  const open = useTimelineUi((s) => (s.overflowOpen ? 'more' : s.addTrackOpen ? 'add' : s.speedPop ? 'speed' : null)) as PopKind;
  const { compact } = useDims();
  const moreRef = useRef<HTMLButtonElement>(null);
  const speedRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const setOpen = (k: PopKind) => setUi({ overflowOpen: k === 'more', addTrackOpen: k === 'add', speedPop: k === 'speed' ? { x: 0, y: 0 } : null });
  const toggle = (k: PopKind) => () => setOpen(open === k ? null : k);
  const close = () => setOpen(null);

  const pops = (
    <>
      <Popover open={open === 'more'} anchor={moreRef} onClose={close} width={250}><MoreItems actions={actions} close={close} compact={compact} /></Popover>
      <Popover open={open === 'speed'} anchor={speedRef} onClose={close} width={250}><SpeedItems close={close} /></Popover>
      <Popover open={open === 'add'} anchor={addRef} onClose={close} width={210}><AddTrackItems close={close} /></Popover>
    </>
  );

  const editBtns = (
    <>
      <button className="ep-tl-btn" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><IUndo /></button>
      <button className="ep-tl-btn" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><IRedo /></button>
      <span className="ep-tl-sep" />
      <button className="ep-tl-btn" onClick={actions.split} title="Dividir no cursor (S)" aria-label="Dividir"><ISplit /></button>
      <button className="ep-tl-btn" onClick={actions.remove} disabled={!hasSel} title="Excluir (Delete) · Shift+Delete exclui com ripple" aria-label="Excluir"><ITrash /></button>
      {!compact && <button className="ep-tl-btn" onClick={actions.duplicate} disabled={!hasSel} title="Duplicar (Ctrl+D)" aria-label="Duplicar"><ICopy /></button>}
      <span className="ep-tl-sep" />
      <button className="ep-tl-btn" onClick={() => toggleKeyframe()} disabled={!hasSel} title="Adicionar/remover keyframe no cursor (K)" aria-label="Keyframe"><IDiamond /></button>
      {!compact && <button className="ep-tl-btn" onClick={actions.marker} title="Marcador no cursor (M)" aria-label="Marcador"><IFlag /></button>}
      {!compact && <button className="ep-tl-btn" onClick={actions.comment} title="Comentário de revisão (C)" aria-label="Comentar"><IComment /></button>}
      <button ref={speedRef} className={`ep-tl-btn${open === 'speed' ? ' on' : ''}`} onClick={toggle('speed')} title="Velocidade" aria-label="Velocidade" aria-haspopup="menu" aria-expanded={open === 'speed'}><IGauge /></button>
    </>
  );

  if (compact)
    return (
      <div className="ep-tl-bar compact" role="toolbar" aria-label="Ferramentas da timeline">
        <div className="ep-tl-barscroll">
          <PlayBtn />
          <TimeReadout compact />
          <span className="ep-tl-sep" />
          {editBtns}
          <button ref={addRef} className={`ep-tl-btn${open === 'add' ? ' on' : ''}`} onClick={toggle('add')} aria-label="Adicionar trilha" aria-haspopup="menu"><IPlus /></button>
          <span className="ep-tl-sep" />
          <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom / 1.4)} aria-label="Diminuir zoom"><IZoomOut /></button>
          <button className="ep-tl-btn" onClick={() => actions.zoomTo(zoom * 1.4)} aria-label="Aumentar zoom"><IZoomIn /></button>
        </div>
        <button ref={moreRef} className={`ep-tl-btn more${open === 'more' ? ' on' : ''}`} onClick={toggle('more')} aria-label="Mais opções" aria-haspopup="menu" aria-expanded={open === 'more'}>
          <IMore />
        </button>
        {pops}
      </div>
    );

  return (
    <div className="ep-tl-bar" role="toolbar" aria-label="Ferramentas da timeline">
      <div className="ep-tl-grp scroll">{editBtns}</div>

      <div className="ep-tl-grp mid">
        <PlayBtn />
        <TimeReadout />
      </div>

      <div className="ep-tl-grp end">
        <button ref={addRef} className={`ep-tl-pill${open === 'add' ? ' on' : ''}`} onClick={toggle('add')} aria-haspopup="menu" aria-expanded={open === 'add'} title="Adicionar trilha">
          <IPlus size={14} /> Trilha
        </button>
        <button
          className={`ep-tl-btn${snapping ? ' on' : ''}`}
          onClick={() => setUi({ snapping: !snapping })}
          title={snapping ? 'Ímã ligado (encaixe automático)' : 'Ímã desligado'}
          aria-pressed={snapping}
          aria-label="Ímã"
        >
          <IMagnet />
        </button>
        <button
          className={`ep-tl-btn${magnetic ? ' on' : ''}`}
          onClick={() => setUi({ magnetic: !magnetic })}
          title={magnetic ? 'Trilha principal magnética: ligada (fecha buracos)' : 'Trilha principal magnética: desligada'}
          aria-pressed={magnetic}
          aria-label="Trilha principal magnética"
        >
          <IMagnetTrack />
        </button>
        <span className="ep-tl-sep" />
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
        <button className="ep-tl-btn" onClick={actions.fit} title="Ajustar à tela" aria-label="Ajustar à tela"><IFit /></button>
        <button ref={moreRef} className={`ep-tl-btn${open === 'more' ? ' on' : ''}`} onClick={toggle('more')} title="Mais opções" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={open === 'more'}>
          <IMore />
        </button>
      </div>
      {pops}
    </div>
  );
}

export const Toolbar = memo(ToolbarInner);
