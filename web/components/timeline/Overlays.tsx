'use client';
/* Faixa "IA editando…" e menu de contexto do clipe */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { findClip, clipEnd } from '@/lib/ops';
import { useTimelineUi } from '@/lib/timeline/ui';
import { IClose, ISliders, IAsk, IAudioSplit, IClipboard, ICopy, IDiamond, IEye, IEyeOff, IGauge, ILock, IMute, IRipple, ISnowflake, ISparkle, ISplit, ITrash, IUnlock, IVolume } from './icons';
import { askAiAboutCaption, askAiAboutClips, copyClips, detachAudio, freezeFrame, pasteClips, removeClips, setSpeed, toggleKeyframe } from '@/lib/timeline/actions';
import { supportsKeyframes } from '@/lib/timeline/keyframes';
import { expandGroups } from '@/lib/timeline/edit';
import { useFloatAt } from '@/lib/timeline/floating';
import { thumbIndexAt } from '@/lib/timeline/edit';
import { assetOf } from '@/lib/timeline/clip';
import type { MonitorFrame } from '@/lib/timeline/trim';
import { formatTime } from '@/lib/util';

export function LiveBanner() {
  const running = useEditor((s) => s.live.running);
  const explain = useEditor((s) => s.live.current?.explain);
  const done = useEditor((s) => s.live.done);
  const total = useEditor((s) => s.live.total);
  const cancel = useEditor((s) => s.cancelLive);
  if (!running) return null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="ep-tl-live" role="status" aria-live="polite">
      <span className="ep-tl-liveic"><ISparkle size={14} /></span>
      <span className="txt">
        <b>IA editando:</b> {explain || 'aplicando alterações…'}
      </span>
      <span className="ep-tl-liveprog" aria-label={`${done} de ${total}`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="mono cnt">{done}/{total}</span>
      <button className="ep-tl-livestop" onClick={cancel}>Parar</button>
    </div>
  );
}

export interface MenuActions {
  split: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  remove: (ids: string[], ripple: boolean) => void;
}

const SPEEDS = [0.5, 1, 1.5, 2, 3];

export function ClipMenu({ actions }: { actions: MenuActions }) {
  const menu = useTimelineUi((s) => s.menu);
  const setUi = useTimelineUi((s) => s.set);
  const hasClipboard = useTimelineUi((s) => s.clipboard.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    if (menu) openedAt.current = performance.now();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      setUi({ menu: null });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, setUi]);
  const floatStyle = useFloatAt(ref, !!menu, menu?.x ?? 0, menu?.y ?? 0, 0, [menu]);

  if (!menu) return null;
  const { project, playhead, selection } = useEditor.getState();
  const run = (fn: () => void) => () => {
    if (menu.touch && performance.now() - openedAt.current < 350) return; // soltar o dedo do toque longo não aciona item
    setUi({ menu: null });
    fn();
  };

  // ----- legenda -----
  if (menu.capId) {
    const seg = project.captions.segments.find((s) => s.id === menu.capId);
    if (!seg) return null;
    return (
      <div ref={ref} className="ep-tl-menu" style={floatStyle} role="menu" onContextMenu={(e) => e.preventDefault()}>
        <div className="ep-tl-menuhead">Legenda · {seg.text.slice(0, 26)}</div>
        <button role="menuitem" onClick={run(() => askAiAboutCaption(seg.id))}><IAsk size={14} /> Perguntar à IA sobre isto</button>
        <div className="ep-tl-menusep" />
        <button role="menuitem" className="danger" disabled={!project.captions.enabled} onClick={run(() => removeClips([], false))}>
          <ITrash size={14} /> Excluir legenda <kbd>Del</kbd>
        </button>
      </div>
    );
  }

  const clipId = menu.clipId!;
  const found = findClip(project, clipId);
  if (!found) return null;
  const ids = selection.includes(clipId) ? selection : [clipId];
  const inside = (id: string) => {
    const f = findClip(project, id);
    return !!f && playhead > f.clip.start && playhead < clipEnd(f.clip);
  };
  const canSplit = ids.some(inside);
  const locked = !!found.track.locked || !!found.clip.locked;
  const c = found.clip;
  const isVideo = c.type === 'video';
  const hasSpeed = c.type === 'video' || c.type === 'audio';
  const curSpeed = hasSpeed ? (c as { speed: number }).speed : 1;
  return (
    <div ref={ref} className="ep-tl-menu" style={floatStyle} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <div className="ep-tl-menuhead">{ids.length > 1 ? `${ids.length} clipes selecionados` : found.track.name}</div>
      <button role="menuitem" onClick={run(() => askAiAboutClips(ids))}><IAsk size={14} /> Perguntar à IA sobre isto</button>
      {c.groupId && (ids.length > 1 ? (
        <button role="menuitem" onClick={run(() => useEditor.getState().select([clipId]))}><ISliders size={14} /> Editar só este <kbd>Alt</kbd></button>
      ) : (
        <button role="menuitem" onClick={run(() => useEditor.getState().select(expandGroups(project, [clipId])))}><ISliders size={14} /> Selecionar o modelo inteiro</button>
      ))}
      <div className="ep-tl-menusep" />
      <button role="menuitem" disabled={!canSplit || locked} onClick={run(() => actions.split(ids))}>
        <ISplit size={14} /> Dividir no cursor <kbd>S</kbd>
      </button>
      <button role="menuitem" disabled={locked} onClick={run(() => actions.duplicate(ids))}>
        <ICopy size={14} /> Duplicar <kbd>Ctrl+D</kbd>
      </button>
      <button role="menuitem" onClick={run(() => copyClips(ids))}><IClipboard size={14} /> Copiar <kbd>Ctrl+C</kbd></button>
      <button role="menuitem" disabled={!hasClipboard} onClick={run(() => pasteClips())}><IClipboard size={14} /> Colar no cursor <kbd>Ctrl+V</kbd></button>
      {hasSpeed && (
        <div className="ep-tl-speedrow" role="group" aria-label="Velocidade">
          <IGauge size={14} />
          {SPEEDS.map((sp) => (
            <button key={sp} className={Math.abs(curSpeed - sp) < 1e-3 ? 'on' : ''} disabled={locked} onClick={run(() => setSpeed(sp, ids))}>{sp}x</button>
          ))}
        </div>
      )}
      {isVideo && (
        <button role="menuitem" disabled={locked} onClick={run(() => detachAudio(ids))}><IAudioSplit size={14} /> Separar áudio</button>
      )}
      {isVideo && (
        <button role="menuitem" disabled={locked || !inside(clipId)} onClick={run(() => freezeFrame(undefined, { clipId }))}><ISnowflake size={14} /> Congelar quadro</button>
      )}
      {supportsKeyframes(c) && (
        <button role="menuitem" disabled={locked || !inside(clipId)} onClick={run(() => toggleKeyframe([clipId]))}><IDiamond size={14} /> Keyframe no cursor <kbd>⇧K</kbd></button>
      )}
      <div className="ep-tl-menusep" />
      <button role="menuitem" className="danger" disabled={locked} onClick={run(() => actions.remove(ids, false))}>
        <ITrash size={14} /> Excluir <kbd>Del</kbd>
      </button>
      <button role="menuitem" className="danger" disabled={locked} onClick={run(() => actions.remove(ids, true))}>
        <IRipple size={14} /> Excluir com ripple <kbd>⇧Del</kbd>
      </button>
    </div>
  );
}

/* opções de uma trilha no modo compacto (cabeçalho só com ícone) */
export function TrackPop() {
  const pop = useTimelineUi((s) => s.trackPop);
  const setUi = useTimelineUi((s) => s.set);
  const track = useEditor((s) => (pop ? s.project.tracks.find((t) => t.id === pop.id) : undefined));
  const dispatch = useEditor((s) => s.dispatch);
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  useEffect(() => setName(track?.name ?? ''), [track?.id, track?.name]);

  useEffect(() => {
    if (!pop) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (e instanceof PointerEvent && (ref.current?.contains(t) || t.closest?.('[data-trackpop]'))) return;
      setUi({ trackPop: null });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pop, setUi]);
  const floatStyle = useFloatAt(ref, !!pop && !!track, pop?.x ?? 0, pop?.y ?? 0, 0, [pop, track]);

  if (!pop || !track) return null;
  const upd = (patch: Record<string, unknown>) => dispatch({ op: 'update_track', trackId: track.id, patch });
  const commit = () => {
    const n = name.trim();
    if (n && n !== track.name) upd({ name: n });
  };
  return (
    <div ref={ref} className="ep-tl-menu ep-tl-trackpop" style={floatStyle} role="dialog" aria-label={`Opções da trilha ${track.name}`}>
      <input
        className="ep-tl-rename"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
        aria-label="Nome da trilha"
      />
      <small className="ep-tl-menuhead">{track.clips.length} {track.clips.length === 1 ? 'clipe' : 'clipes'}</small>
      {(track.kind === 'video' || track.kind === 'audio') && (
        <button role="menuitemcheckbox" aria-checked={!!track.muted} onClick={() => upd({ muted: !track.muted })}>
          {track.muted ? <IMute size={15} /> : <IVolume size={15} />} {track.muted ? 'Ativar som' : 'Silenciar'}
        </button>
      )}
      {track.kind !== 'audio' && (
        <button role="menuitemcheckbox" aria-checked={!!track.hidden} onClick={() => upd({ hidden: !track.hidden })}>
          {track.hidden ? <IEyeOff size={15} /> : <IEye size={15} />} {track.hidden ? 'Mostrar' : 'Ocultar'}
        </button>
      )}
      <button role="menuitemcheckbox" aria-checked={!!track.locked} onClick={() => upd({ locked: !track.locked })}>
        {track.locked ? <ILock size={15} /> : <IUnlock size={15} />} {track.locked ? 'Destravar' : 'Travar'}
      </button>
      <div className="ep-tl-menusep" />
      {(['up', 'down'] as const).map((dir) => {
        const tracks = useEditor.getState().project.tracks;
        const i = tracks.findIndex((t) => t.id === track.id);
        // trilhas visuais aparecem da camada mais alta p/ a mais baixa; áudio na ordem
        const step = track.kind === 'audio' ? (dir === 'up' ? -1 : 1) : dir === 'up' ? 1 : -1;
        const j = i + step;
        const ok = j >= 0 && j < tracks.length && (tracks[j].kind === 'audio') === (track.kind === 'audio');
        return (
          <button key={dir} role="menuitem" disabled={!ok} onClick={() => dispatch({ op: 'move_track', trackId: track.id, index: j })}>
            {dir === 'up' ? '↑ Mover para cima' : '↓ Mover para baixo'}
          </button>
        );
      })}
    </div>
  );
}

/* monitor de trim (estilo 2-up do DaVinci): quadro de saída × quadro de entrada durante ripple/roll/slip/slide */
const TOOL_NAMES: Record<string, string> = { ripple: 'Ripple', roll: 'Roll', slip: 'Slip', slide: 'Slide' };

function MonitorSide({ frame }: { frame: MonitorFrame | null }) {
  const thumb = useEditor((s) => {
    if (!frame) return null;
    const f = findClip(s.project, frame.clipId);
    const asset = f ? assetOf(f.clip, s.assets) : undefined;
    const th = asset?.thumbnails;
    if (!th?.length) return null;
    return th[thumbIndexAt(frame.srcT, asset?.duration ?? 0, th.length)] ?? null;
  });
  const fps = useEditor((s) => s.project.fps);
  if (!frame) return <div className="ep-tl-mon-side empty"><span>—</span></div>;
  return (
    <div className="ep-tl-mon-side">
      {thumb ? <img src={thumb} alt="" draggable={false} /> : <i />}
      <span className="mono">{frame.label} · {formatTime(Math.max(0, frame.srcT), { fps })}</span>
    </div>
  );
}

export function TrimMonitor() {
  const drag = useTimelineUi((s) => (s.drag?.mode === 'pro' ? s.drag : null));
  const fps = useEditor((s) => s.project.fps || 30);
  if (!drag) return null;
  const frames = Math.round(drag.delta * fps);
  return (
    <div className="ep-tl-monitor" role="status" aria-live="polite">
      <div className="ep-tl-mon-head">
        <b>{TOOL_NAMES[drag.tool]}</b>
        <span className="mono">{frames > 0 ? '+' : ''}{frames} quadros · {drag.delta >= 0 ? '+' : '−'}{Math.abs(drag.delta).toFixed(2)}s</span>
      </div>
      <div className="ep-tl-mon-frames">
        <MonitorSide frame={drag.frames[0]} />
        <MonitorSide frame={drag.frames[1]} />
      </div>
    </div>
  );
}

/* tela de ajuda de atalhos (?) — estilo DaVinci */
const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  { group: 'Ferramentas', items: [['A', 'Seleção'], ['B', 'Lâmina (clique corta)'], ['T', 'Trim: ripple → roll → slip → slide'], ['N', 'Liga/desliga o ímã'], ['Alt + arrastar', 'Só este clipe (J/L-cut)']] },
  { group: 'Reprodução', items: [['Espaço', 'Reproduzir / pausar'], ['L', 'Para frente (L de novo: 2×, 4×, 8×)'], ['J', 'Para trás (J de novo acelera)'], ['K', 'Parar'], ['← / →', 'Quadro a quadro (Shift = 1 s)'], ['↑ / ↓', 'Corte anterior / próximo'], ['Home / End', 'Início / fim']] },
  { group: 'Edição', items: [['S · Ctrl+B', 'Dividir no cursor'], ['Ctrl+Shift+B', 'Cortar todas as trilhas'], ['Delete', 'Excluir'], ['Shift+Delete', 'Excluir com ripple'], ['Ctrl+D', 'Duplicar'], ['Ctrl+C / X / V', 'Copiar / recortar / colar'], [', / .', 'Empurrar 1 quadro (Shift = 5)'], ['Ctrl+Alt+L', 'Vincular / desvincular áudio e vídeo'], ['Ctrl+Z / Ctrl+Shift+Z', 'Desfazer / refazer']] },
  { group: 'Marcação', items: [['I / O', 'Início / fim do trecho'], ['X', 'Trecho = clipe sob o cursor'], ['Alt+X', 'Limpar trecho'], ['M', 'Marcador'], ['C', 'Comentário de revisão'], ['Shift+K', 'Keyframe no cursor']] },
  { group: 'Visualização', items: [['Shift+Z', 'Ajustar à janela'], ['+ / −', 'Zoom'], ['Ctrl + roda', 'Zoom no ponteiro'], ['?', 'Esta ajuda']] },
];

export function ShortcutsHelp() {
  const open = useTimelineUi((s) => s.helpOpen);
  const setUi = useTimelineUi((s) => s.set);
  if (!open) return null;
  const close = () => setUi({ helpOpen: false });
  return (
    <div className="ep-tl-help-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="ep-tl-help" role="dialog" aria-modal="true" aria-label="Atalhos do teclado">
        <div className="ep-tl-help-head">
          <b>Atalhos do teclado</b>
          <button className="ep-tl-btn" onClick={close} aria-label="Fechar" autoFocus><IClose /></button>
        </div>
        <div className="ep-tl-help-grid">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h4>{g.group}</h4>
              <dl>
                {g.items.map(([k, v]) => (
                  <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
