'use client';
/* Barra de ferramentas da timeline (desktop e compacta) */
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { TrackKind } from '@/lib/types';
import { useEditor, useDuration } from '@/lib/store';
import { TOOL_LABEL, useDims, useTimelineUi, type EditTool } from '@/lib/timeline/ui';
import { TRACK_NAMES } from '@/lib/ops';
import { formatTime } from '@/lib/util';
import {
  addTrack, copyClips, detachAudio, freezeFrame, pasteClips, setSpeed, toggleKeyframe,
} from '@/lib/timeline/actions';
import {
  IAudio, IAudioSplit, IClipboard, IComment, ICopy, IDiamond, IFit, IFlag, IGauge, IInsert, IMagnet, IMagnetTrack, IMore,
  IPause, IPlay, IPlus, IRedo, IRipple, ISliders, ISnowflake, ISplit, ISticker, IText, ITrash, IUndo, IVideo, IZoomIn, IZoomOut,
  IBlade, IKeyboard, IRippleTool, IRoll, ISelect, ISlide, ISlip,
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
  // posição medida de verdade (altura real do menu), sempre dentro da tela visível;
  // se não couber nem acima nem abaixo, ocupa a altura disponível com rolagem
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current;
      const el = ref.current;
      if (!a || !el) return;
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const M = 8;
      const r = a.getBoundingClientRect();
      const w = Math.min(el.offsetWidth, vw - 2 * M);
      const h = el.scrollHeight;
      const below = vh - r.bottom - 6 - M;
      const above = r.top - 6 - M;
      let top: number;
      let maxH: number;
      if (h <= below) { top = r.bottom + 6; maxH = below; }
      else if (h <= above) { top = r.top - 6 - h; maxH = above; }
      else if (below >= above) { top = r.bottom + 6; maxH = below; }
      else { maxH = above; top = Math.max(M, r.top - 6 - Math.min(h, maxH)); }
      if (maxH < 220) { top = M; maxH = vh - 2 * M; }
      const left = Math.max(M, Math.min(r.right - w, vw - w - M));
      setPos((p) => (p && Math.abs(p.top - top) < 0.5 && Math.abs(p.left - left) < 0.5 && Math.abs(p.maxH - maxH) < 0.5 ? p : { top, left, maxH }));
    };
    place();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    return () => vv?.removeEventListener('resize', place);
  }, [open, anchor, children]);
  if (!open || !anchor.current) return null;
  return (
    <div
      ref={ref}
      className="ep-tl-menu"
      role={role}
      style={{
        top: pos?.top ?? 0, left: pos?.left ?? 0, minWidth: `min(${width}px, calc(100vw - 16px))`,
        maxWidth: 'calc(100vw - 16px)', maxHeight: pos?.maxH, overflowY: 'auto', overscrollBehavior: 'contain',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  );
}

/** itens de configuração/ações menos usados (menu "⋯") */
function MoreItems({ actions, close, compact, center }: { actions: ToolbarActions; close: () => void; compact: boolean; center?: boolean }) {
  const ui = useTimelineUi();
  const zoom = useEditor((s) => s.zoom);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const run = (fn: () => void) => () => { close(); fn(); };
  return (
    <>
      {center && (
        <>
          <div className="ep-tl-menuhead">Clipe no cursor</div>
          <div className="ep-tl-speedrow" role="group" aria-label="Ações rápidas">
            <button onClick={run(actions.split)} aria-label="Dividir no cursor" title="Dividir"><ISplit size={16} /></button>
            <button onClick={run(() => toggleKeyframe())} disabled={!hasSel} aria-label="Keyframe no cursor" title="Keyframe"><IDiamond size={16} /></button>
            <button onClick={run(actions.marker)} aria-label="Marcador no cursor" title="Marcador"><IFlag size={16} /></button>
          </div>
          <div className="ep-tl-menusep" />
        </>
      )}
      {center && (
        <>
          <div className="ep-tl-menuhead">Ferramenta</div>
          <ToolItems close={close} chips />
          <div className="ep-tl-menusep" />
        </>
      )}
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
        <div className="ep-tl-speedrow" role="group" aria-label="Zoom">
          <button onClick={() => actions.zoomTo(zoom / 1.4)} aria-label="Diminuir zoom"><IZoomOut size={15} /></button>
          <button onClick={() => actions.zoomTo(zoom * 1.4)} aria-label="Aumentar zoom"><IZoomIn size={15} /></button>
        </div>
      )}
      {compact && (
        <>
          <div className="ep-tl-menusep" />
          <div className="ep-tl-menuhead">Adicionar trilha</div>
          <div className="ep-tl-speedrow" role="group" aria-label="Adicionar trilha">
            {TRACK_KINDS.map(({ kind, icon: I }) => (
              <button key={kind} onClick={run(() => addTrack(kind))} aria-label={`Adicionar trilha de ${TRACK_NAMES[kind]}`} title={TRACK_NAMES[kind]}><I size={15} /></button>
            ))}
          </div>
        </>
      )}
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
      {!center && (
        <>
          <div className="ep-tl-menusep" />
          <button role="menuitem" onClick={run(() => ui.set({ helpOpen: true }))}><IKeyboard size={15} /> Atalhos do teclado <kbd>?</kbd></button>
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

export const TOOLS: { tool: EditTool; icon: (p: { size?: number }) => JSX.Element; key: string; hint: string }[] = [
  { tool: 'select', icon: ISelect, key: 'A', hint: 'mover e aparar' },
  { tool: 'blade', icon: IBlade, key: 'B', hint: 'clique corta o clipe' },
  { tool: 'ripple', icon: IRippleTool, key: 'T', hint: 'apara e empurra o resto' },
  { tool: 'roll', icon: IRoll, key: 'T', hint: 'move o corte entre 2 clipes' },
  { tool: 'slip', icon: ISlip, key: 'T', hint: 'troca o trecho, mesmo lugar' },
  { tool: 'slide', icon: ISlide, key: 'T', hint: 'move o clipe, vizinhos ajustam' },
];

/** lista de ferramentas (popover da barra e menu ⋯ do celular) */
function ToolItems({ close, chips }: { close: () => void; chips?: boolean }) {
  const tool = useTimelineUi((s) => s.tool);
  const setUi = useTimelineUi((s) => s.set);
  const pick = (t: EditTool) => () => { setUi({ tool: t }); close(); };
  if (chips)
    return (
      <div className="ep-tl-toolchips" role="radiogroup" aria-label="Ferramenta">
        {TOOLS.map(({ tool: t, icon: I }) => (
          <button key={t} role="radio" aria-checked={tool === t} className={tool === t ? 'on' : ''} onClick={pick(t)} title={TOOL_LABEL[t]}>
            <I size={16} /><span>{TOOL_LABEL[t]}</span>
          </button>
        ))}
      </div>
    );
  return (
    <>
      <div className="ep-tl-menuhead">Ferramenta</div>
      {TOOLS.map(({ tool: t, icon: I, key, hint }) => (
        <button key={t} role="menuitemradio" aria-checked={tool === t} className={tool === t ? 'cur' : ''} onClick={pick(t)}>
          <I size={15} /> <span className="ep-tl-toolname">{TOOL_LABEL[t]}<small>{hint}</small></span> <kbd>{key}</kbd>
        </button>
      ))}
      <div className="ep-tl-menunote">Alt durante o arraste: só este clipe (J/L-cut).</div>
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

type PopKind = 'more' | 'speed' | 'add' | 'tool' | null;

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
  const [toolOpen, setToolOpen] = useState(false);
  const tool = useTimelineUi((s) => s.tool);
  const open = useTimelineUi((s) => (s.overflowOpen ? 'more' : s.addTrackOpen ? 'add' : s.speedPop ? 'speed' : null)) as PopKind ?? (toolOpen ? 'tool' : null);
  const { barCompact: compact, compact: narrow } = useDims();
  const moreRef = useRef<HTMLButtonElement>(null);
  const speedRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const toolRef = useRef<HTMLButtonElement>(null);
  const setOpen = (k: PopKind) => {
    setToolOpen(k === 'tool');
    setUi({ overflowOpen: k === 'more', addTrackOpen: k === 'add', speedPop: k === 'speed' ? { x: 0, y: 0 } : null });
  };
  const toggle = (k: PopKind) => () => setOpen(open === k ? null : k);
  const close = () => setOpen(null);

  const pops = (
    <>
      <Popover open={open === 'more'} anchor={moreRef} onClose={close} width={250}><MoreItems actions={actions} close={close} compact={compact} /></Popover>
      <Popover open={open === 'speed'} anchor={speedRef} onClose={close} width={250}><SpeedItems close={close} /></Popover>
      <Popover open={open === 'add'} anchor={addRef} onClose={close} width={210}><AddTrackItems close={close} /></Popover>
      <Popover open={open === 'tool'} anchor={toolRef} onClose={close} width={260}><ToolItems close={close} /></Popover>
    </>
  );

  const CurTool = TOOLS.find((x) => x.tool === tool)!.icon;
  const trimActive = tool !== 'select' && tool !== 'blade';
  const toolBtns = compact ? (
    <button ref={toolRef} className={`ep-tl-btn${tool !== 'select' ? ' on' : ''}`} onClick={toggle('tool')} title={`Ferramenta: ${TOOL_LABEL[tool]}`} aria-label={`Ferramenta: ${TOOL_LABEL[tool]}`} aria-haspopup="menu" aria-expanded={open === 'tool'}>
      <CurTool />
    </button>
  ) : (
    <span className="ep-tl-seg" role="radiogroup" aria-label="Ferramenta">
      <button role="radio" aria-checked={tool === 'select'} className={`ep-tl-btn${tool === 'select' ? ' on' : ''}`} onClick={() => setUi({ tool: 'select' })} title="Seleção (A)" aria-label="Seleção"><ISelect /></button>
      <button role="radio" aria-checked={tool === 'blade'} className={`ep-tl-btn${tool === 'blade' ? ' on' : ''}`} onClick={() => setUi({ tool: 'blade' })} title="Lâmina (B): clique no clipe para cortar" aria-label="Lâmina"><IBlade /></button>
      <button ref={toolRef} role="radio" aria-checked={trimActive} className={`ep-tl-btn${trimActive ? ' on' : ''}`} onClick={toggle('tool')} title={`Trim (T): ${trimActive ? TOOL_LABEL[tool] : 'ripple, roll, slip, slide'}`} aria-label="Ferramentas de trim" aria-haspopup="menu" aria-expanded={open === 'tool'}>
        {trimActive ? <CurTool /> : <IRippleTool />}
      </button>
    </span>
  );

  const editBtns = (
    <>
      {toolBtns}
      <span className="ep-tl-sep" />
      <button className="ep-tl-btn" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><IUndo /></button>
      <button className="ep-tl-btn" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><IRedo /></button>
      <span className="ep-tl-sep" />
      <button className="ep-tl-btn" onClick={actions.split} title="Dividir no cursor (S · Ctrl+B) · Ctrl+Shift+B corta todas as trilhas" aria-label="Dividir"><ISplit /></button>
      <button className="ep-tl-btn" onClick={actions.remove} disabled={!hasSel} title="Excluir (Delete) · Shift+Delete exclui com ripple" aria-label="Excluir"><ITrash /></button>
      {!compact && <button className="ep-tl-btn" onClick={actions.duplicate} disabled={!hasSel} title="Duplicar (Ctrl+D)" aria-label="Duplicar"><ICopy /></button>}
      <span className="ep-tl-sep" />
      <button className="ep-tl-btn" onClick={() => toggleKeyframe()} disabled={!hasSel} title="Adicionar/remover keyframe no cursor (Shift+K)" aria-label="Keyframe"><IDiamond /></button>
      {!compact && <button className="ep-tl-btn" onClick={actions.marker} title="Marcador no cursor (M)" aria-label="Marcador"><IFlag /></button>}
      {!compact && <button className="ep-tl-btn" onClick={actions.comment} title="Comentário de revisão (C)" aria-label="Comentar"><IComment /></button>}
      <button ref={speedRef} className={`ep-tl-btn${open === 'speed' ? ' on' : ''}`} onClick={toggle('speed')} title="Velocidade" aria-label="Velocidade" aria-haspopup="menu" aria-expanded={open === 'speed'}><IGauge /></button>
    </>
  );

  if (compact && narrow)
    // celular: as ações do clipe ficam na barra contextual do shell; aqui só o essencial (+ ⋯)
    return (
      <div className="ep-tl-bar compact" role="toolbar" aria-label="Ferramentas da timeline">
        <div className="ep-tl-barscroll">
          <button className="ep-tl-btn" onClick={undo} disabled={!canUndo} aria-label="Desfazer"><IUndo /></button>
          <button className="ep-tl-btn" onClick={redo} disabled={!canRedo} aria-label="Refazer"><IRedo /></button>
          <span className="ep-tl-sep" />
          <button className="ep-tl-btn" onClick={actions.split} aria-label="Dividir no cursor"><ISplit /></button>
          <button className="ep-tl-btn" onClick={() => toggleKeyframe()} disabled={!hasSel} aria-label="Keyframe no cursor"><IDiamond /></button>
        </div>
        <button ref={moreRef} className={`ep-tl-btn more${open === 'more' ? ' on' : ''}`} onClick={toggle('more')} aria-label="Mais opções" aria-haspopup="menu" aria-expanded={open === 'more'}>
          <IMore />
        </button>
        {pops}
      </div>
    );

  if (compact)
    return (
      <div className="ep-tl-bar compact" role="toolbar" aria-label="Ferramentas da timeline">
        <div className="ep-tl-barscroll">
          {/* no celular (<600px) o preview já tem play e tempo: a linha fica para as ferramentas */}
          {!narrow && (
            <>
              <PlayBtn />
              <TimeReadout compact />
              <span className="ep-tl-sep" />
            </>
          )}
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

/* ---------------- modo celular (CapCut): playhead fixo, tempo e "⋯" sobre a timeline ---------------- */

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t + 1e-6));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function CenterTime() {
  const t = useEditor((s) => Math.floor(s.playhead));
  const total = useDuration();
  return (
    <div className="ep-tl-ctime mono" aria-label="Tempo atual e total">
      <b>{mmss(t)}</b>
      <i>/</i>
      <span>{mmss(total)}</span>
    </div>
  );
}

export function CenterOverlay({ actions }: { actions: ToolbarActions }) {
  const open = useTimelineUi((s) => s.overflowOpen);
  const setUi = useTimelineUi((s) => s.set);
  const live = useEditor((s) => s.live.running);
  const moreRef = useRef<HTMLButtonElement>(null);
  const close = () => setUi({ overflowOpen: false });
  return (
    <>
      <div className={`ep-tl-cline${live ? ' live' : ''}`} aria-hidden><i /></div>
      <CenterTime />
      <button
        ref={moreRef}
        className={`ep-tl-cmore${open ? ' on' : ''}`}
        onClick={() => setUi({ overflowOpen: !open })}
        aria-label="Mais opções da timeline"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IMore size={18} />
      </button>
      <Popover open={open} anchor={moreRef} onClose={close} width={260}>
        <MoreItems actions={actions} close={close} compact center />
      </Popover>
    </>
  );
}
