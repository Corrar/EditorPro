'use client';
/* Cabeçalhos e faixas das trilhas, linha de legendas, camada de arraste, playhead. */
import { memo, useEffect, useRef, useState } from 'react';
import type { Clip, Project, Track, TrackKind } from '@/lib/types';
import { useEditor } from '@/lib/store';
import { findClip } from '@/lib/ops';
import { type RowInfo, useDims, useTimelineUi, useVisibleWindow } from '@/lib/timeline/ui';
import { assetOf } from '@/lib/timeline/clip';
import { emit } from '@/lib/events';
import { formatTime } from '@/lib/util';
import { keyframesOf } from '@/lib/timeline/keyframes';
import { ClipView } from './ClipView';
import { CaptionBody, ClipBody } from './ClipBody';
import { ISparkle, ISliders, ISticker, IAudio, ICaptions, IEye, IEyeOff, ILock, IMute, IPlus, IText, IUnlock, IVideo, IVolume } from './icons';

/* ---------------- cabeçalho ---------------- */

export const TRACK_ICONS: Record<TrackKind, typeof IVideo> = { video: IVideo, audio: IAudio, text: IText, overlay: ISticker, effect: ISliders };

function TrackHeaderInner({ track, height }: { track: Track; height: number }) {
  const dispatch = useEditor((s) => s.dispatch);
  const { headerW, compact } = useDims();
  const popOpen = useTimelineUi((s) => s.trackPop?.id === track.id);
  const over = useTimelineUi((s) => s.reorderOver === track.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const Icon = TRACK_ICONS[track.kind] ?? IVideo;
  const upd = (patch: Partial<Track>) => dispatch({ op: 'update_track', trackId: track.id, patch });
  const commit = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== track.name) upd({ name: n });
    else setName(track.name);
  };
  if (compact) {
    const flags = [track.muted && 'mudo', track.hidden && 'oculta', track.locked && 'travada'].filter(Boolean).join(', ');
    return (
      <div className={`ep-tl-head compact k-${track.kind}${track.locked ? ' locked' : ''}`} style={{ width: headerW, height }}>
        <button
          className={`ep-tl-headic btn${popOpen ? ' on' : ''}`}
          data-trackpop={track.id}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const ui = useTimelineUi.getState();
            ui.set({ trackPop: popOpen ? null : { id: track.id, x: r.right + 6, y: r.top } });
          }}
          aria-label={`${track.name}${flags ? ` (${flags})` : ''} — opções da trilha`}
          aria-expanded={popOpen}
        >
          <Icon size={15} />
          {flags && <i className="ep-tl-flag" />}
        </button>
      </div>
    );
  }
  return (
    <div
      className={`ep-tl-head k-${track.kind}${track.locked ? ' locked' : ''}${over ? ' over' : ''}`}
      style={{ width: headerW, height }}
      data-track-id={track.id}
      title="Arraste para reordenar a trilha"
    >
      <span className="ep-tl-headic"><Icon size={13} /></span>
      <div className="ep-tl-headname">
        {editing ? (
          <input
            className="ep-tl-rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setName(track.name); setEditing(false); }
            }}
          />
        ) : (
          <b onDoubleClick={() => setEditing(true)} title="Clique duas vezes para renomear">{track.name}</b>
        )}
        <small>{track.clips.length} {track.clips.length === 1 ? 'clipe' : 'clipes'}</small>
      </div>
      <div className="ep-tl-headbtns">
        {(track.kind === 'video' || track.kind === 'audio') && (
          <button className={`ep-tl-hb${track.muted ? ' off' : ''}`} onClick={() => upd({ muted: !track.muted })} title={track.muted ? 'Ativar som' : 'Silenciar trilha'} aria-pressed={!!track.muted} aria-label="Mudo">
            {track.muted ? <IMute size={13} /> : <IVolume size={13} />}
          </button>
        )}
        {track.kind !== 'audio' && (
          <button className={`ep-tl-hb${track.hidden ? ' off' : ''}`} onClick={() => upd({ hidden: !track.hidden })} title={track.hidden ? 'Mostrar trilha' : 'Ocultar trilha'} aria-pressed={!!track.hidden} aria-label="Ocultar">
            {track.hidden ? <IEyeOff size={13} /> : <IEye size={13} />}
          </button>
        )}
        <button className={`ep-tl-hb${track.locked ? ' off' : ''}`} onClick={() => upd({ locked: !track.locked })} title={track.locked ? 'Destravar trilha' : 'Travar trilha'} aria-pressed={!!track.locked} aria-label="Travar">
          {track.locked ? <ILock size={13} /> : <IUnlock size={13} />}
        </button>
      </div>
    </div>
  );
}
const TrackHeader = memo(TrackHeaderInner);

function CaptionHeader({ height }: { height: number }) {
  const enabled = useEditor((s) => s.project.captions.enabled);
  const count = useEditor((s) => s.project.captions.segments.length);
  const dispatch = useEditor((s) => s.dispatch);
  const { headerW, compact } = useDims();
  if (compact)
    return (
      <div className="ep-tl-head compact k-captions" style={{ width: headerW, height }}>
        <button
          className={`ep-tl-headic btn${enabled ? '' : ' off'}`}
          onClick={() => dispatch({ op: 'toggle_captions', enabled: !enabled })}
          aria-label={enabled ? 'Legendas visíveis — tocar para ocultar' : 'Legendas ocultas — tocar para mostrar'}
          aria-pressed={!enabled}
        >
          {enabled ? <ICaptions size={15} /> : <IEyeOff size={15} />}
        </button>
      </div>
    );
  return (
    <div className="ep-tl-head k-captions" style={{ width: headerW, height }}>
      <span className="ep-tl-headic"><ICaptions size={13} /></span>
      <div className="ep-tl-headname">
        <b>Legendas</b>
        <small>{count ? `${count} trechos` : 'nenhuma'}</small>
      </div>
      <div className="ep-tl-headbtns">
        <button className={`ep-tl-hb${enabled ? '' : ' off'}`} onClick={() => dispatch({ op: 'toggle_captions', enabled: !enabled })} title={enabled ? 'Ocultar legendas' : 'Mostrar legendas'} aria-pressed={!enabled} aria-label="Ocultar legendas">
          {enabled ? <IEye size={13} /> : <IEyeOff size={13} />}
        </button>
      </div>
    </div>
  );
}

/* ---------------- faixas ---------------- */

const ADD_LINE: Record<TrackKind, { label: string; tool: string }> = {
  video: { label: 'Adicionar mídia', tool: 'media' },
  audio: { label: 'Adicionar áudio', tool: 'audio' },
  text: { label: 'Adicionar texto', tool: 'text' },
  overlay: { label: 'Adicionar sticker', tool: 'stickers' },
  effect: { label: 'Adicionar ajuste', tool: 'adjust' },
};

function TrackLaneInner({ track, zoom, height, width, main }: { track: Track; zoom: number; height: number; width: number; main?: boolean }) {
  const [w0, w1] = useVisibleWindow(zoom);
  const hint = useTimelineUi((s) => s.dropHint?.rowId === track.id || (s.drag?.mode === 'move' && s.drag.trackId === track.id && !s.drag.newTrack));
  const center = useTimelineUi((s) => s.dims.center);
  const end = track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const Icon = TRACK_ICONS[track.kind] ?? IVideo;
  return (
    <div className={`ep-tl-lane k-${track.kind}${track.hidden ? ' hidden' : ''}${track.locked ? ' locked' : ''}${hint ? ' hint' : ''}${main ? ' main' : ''}`} style={{ width, height }} data-row={track.id}>
      {track.clips.filter((c) => c.start <= w1 && c.start + c.duration >= w0).map((c) => (
        <ClipView key={c.id} clip={c} kind={track.kind} zoom={zoom} height={height} locked={!!track.locked} />
      ))}
      {center && !track.clips.length && (
        <button className="ep-tl-addline" onClick={() => emit('ep:open-tool', { tool: ADD_LINE[track.kind].tool })}>
          <Icon size={15} /> <span>+ {ADD_LINE[track.kind].label}</span>
        </button>
      )}
      {center && main && track.clips.length > 0 && (
        <button
          className="ep-tl-addend"
          style={{ transform: `translate(${end * zoom + 10}px, -50%)` }}
          onClick={() => emit('ep:open-tool', { tool: 'media' })}
          aria-label="Adicionar mídia"
        >
          <IPlus size={20} />
        </button>
      )}
    </div>
  );
}
const TrackLane = memo(TrackLaneInner);

function CaptionLane({ zoom, height, width }: { zoom: number; height: number; width: number }) {
  const allSegs = useEditor((s) => s.project.captions.segments);
  const [w0, w1] = useVisibleWindow(zoom);
  const segs = allSegs.filter((s) => s.start <= w1 && s.end >= w0);
  const enabled = useEditor((s) => s.project.captions.enabled);
  const sel = useTimelineUi((s) => s.captionSel);
  const drag = useTimelineUi((s) => (s.drag && s.drag.mode.startsWith('cap') ? (s.drag as { id: string; start: number; end: number }) : null));
  const compact = useTimelineUi((s) => s.dims.compact);
  const center = useTimelineUi((s) => s.dims.center);
  return (
    <div className={`ep-tl-lane k-captions${enabled ? '' : ' hidden'}`} style={{ width, height }} data-row="captions">
      {!allSegs.length && (center ? (
        <button className="ep-tl-addline" onClick={() => emit('ep:open-tool', { tool: 'captions' })}>
          <ICaptions size={15} /> <span>+ Adicionar legendas</span>
        </button>
      ) : (
        <span className="ep-tl-lanehint">{compact ? 'Sem legendas' : 'Sem legendas — gere no painel Legendas ou peça no chat'}</span>
      ))}
      {segs.map((s) => {
        const st = drag?.id === s.id ? drag.start : s.start;
        const en = drag?.id === s.id ? drag.end : s.end;
        return (
          <div
            key={s.id}
            className={`ep-tl-cap${sel === s.id ? ' sel' : ''}${drag?.id === s.id ? ' trimming' : ''}`}
            style={{ transform: `translate(${st * zoom}px, 3px)`, width: Math.max(2, (en - st) * zoom), height: height - 6 }}
            data-cap-id={s.id}
            title={s.text}
          >
            {(en - st) * zoom > 22 && <CaptionBody text={s.text} />}
            <span className="ep-tl-handle l" data-handle="start" />
            <span className="ep-tl-handle r" data-handle="end" />
          </div>
        );
      })}
    </div>
  );
}

function NewTrackLane({ height, width }: { height: number; width: number }) {
  const hint = useTimelineUi((s) => s.drag?.mode === 'move' && !!s.drag.newTrack);
  return (
    <div className={`ep-tl-lane k-new${hint ? ' hint' : ''}`} style={{ width, height }} data-row="new">
      <span className="ep-tl-lanehint"><IPlus size={12} /> Solte aqui: nova trilha</span>
    </div>
  );
}

/* ---------------- linhas ---------------- */

export const Rows = memo(function Rows({ rows, zoom, width }: { rows: RowInfo[]; zoom: number; width: number }) {
  const { headerW, compact, center } = useDims();
  const firstVideo = useEditor((s) => s.project.tracks.find((t) => t.kind === 'video')?.id);
  if (center)
    return (
      <>
        {rows.map((r) => (
          <div key={r.id} className="ep-tl-row" style={{ top: r.top, height: r.height }}>
            <div className="ep-tl-lead" style={{ width: headerW, height: r.height }}>
              {r.id === firstVideo && <MainLead height={r.height} />}
            </div>
            {r.kind === 'captions' ? (
              <CaptionLane zoom={zoom} height={r.height} width={width} />
            ) : r.kind === 'new' ? (
              <NewTrackLane height={r.height} width={width} />
            ) : (
              <TrackLane track={r.track!} zoom={zoom} height={r.height} width={width} main={r.id === firstVideo} />
            )}
          </div>
        ))}
      </>
    );
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className="ep-tl-row" style={{ top: r.top, height: r.height }}>
          {r.kind === 'captions' ? (
            <>
              <CaptionHeader height={r.height} />
              <CaptionLane zoom={zoom} height={r.height} width={width} />
            </>
          ) : r.kind === 'new' ? (
            <>
              <div className={`ep-tl-head k-new${compact ? ' compact' : ''}`} style={{ width: headerW, height: r.height }}>
                <span className="ep-tl-headic"><IPlus size={13} /></span>
                {!compact && <div className="ep-tl-headname"><b>Nova trilha</b></div>}
              </div>
              <NewTrackLane height={r.height} width={width} />
            </>
          ) : (
            <>
              <TrackHeader track={r.track!} height={r.height} />
              <TrackLane track={r.track!} zoom={zoom} height={r.height} width={width} />
            </>
          )}
        </div>
      ))}
    </>
  );
});

/* ---------------- camada de arraste (clipes "fantasma" na posição de destino) ---------------- */

export const DragLayer = memo(function DragLayer({ project, rows, zoom }: { project: Project; rows: RowInfo[]; zoom: number }) {
  const drag = useTimelineUi((s) => (s.drag?.mode === 'move' ? s.drag : null));
  const assets = useEditor((s) => s.assets);
  const { headerW: HEADER_W } = useDims();
  if (!drag) return null;
  const items: { clip: Clip; row: RowInfo }[] = [];
  for (const id of drag.ids) {
    const f = findClip(project, id);
    if (!f) continue;
    const rowId = id === drag.primary ? (drag.newTrack ? 'new' : drag.trackId ?? f.track.id) : f.track.id;
    const row = rows.find((r) => r.id === rowId) ?? rows.find((r) => r.id === f.track.id);
    if (!row) continue;
    items.push({ clip: { ...f.clip, start: Math.max(0, f.clip.start + drag.delta) } as Clip, row });
  }
  return (
    <>
      {items.map(({ clip, row }) => {
        const h = Math.max(12, row.height - 6);
        const w = Math.max(2, clip.duration * zoom);
        return (
          <div
            key={clip.id}
            className={`ep-tl-clip ghost k-${clip.type}`}
            style={{ transform: `translate(${HEADER_W + clip.start * zoom}px, ${row.top + (row.height - h) / 2}px)`, width: w, height: h }}
          >
            <ClipBody clip={clip} asset={assetOf(clip, assets)} width={w} height={h} zoom={zoom} />
          </div>
        );
      })}
    </>
  );
});

/* ---------------- guias: linha de encaixe, alvo de soltura, seleção em área ---------------- */

export const Guides = memo(function Guides({ zoom, height }: { zoom: number; height: number }) {
  const snapLine = useTimelineUi((s) => s.snapLine);
  const drop = useTimelineUi((s) => s.dropHint);
  const mq = useTimelineUi((s) => s.marquee);
  const { headerW: HEADER_W } = useDims();
  return (
    <>
      {snapLine != null && <div className="ep-tl-snapline" style={{ transform: `translateX(${HEADER_W + snapLine * zoom}px)`, height }} />}
      {drop && <div className="ep-tl-dropline" style={{ transform: `translateX(${HEADER_W + drop.t * zoom}px)`, height }} />}
      {mq && (
        <div
          className="ep-tl-marquee"
          style={{ left: Math.min(mq.x0, mq.x1), top: Math.min(mq.y0, mq.y1), width: Math.abs(mq.x1 - mq.x0), height: Math.abs(mq.y1 - mq.y0) }}
        />
      )}
    </>
  );
});

/* ---------------- linha do playhead + auto-rolagem ---------------- */

export const PlayheadLine = memo(function PlayheadLine({ zoom, height, scrollRef }: { zoom: number; height: number; scrollRef: React.RefObject<HTMLDivElement> }) {
  const t = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const live = useEditor((s) => s.live.running);
  const dragging = useTimelineUi((s) => !!s.drag);
  const { headerW: HEADER_W, center } = useDims();
  const last = useRef(t);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragging || center) return; // modo centro: a própria timeline mantém o playhead no meio
    const x = HEADER_W + t * zoom;
    const left = el.scrollLeft + HEADER_W;
    const right = el.scrollLeft + el.clientWidth;
    if (playing) {
      // paginação suave: quando passa da borda direita, pula p/ deixar o playhead perto da esquerda
      if (x > right - 40 || x < left) el.scrollLeft = Math.max(0, x - HEADER_W - 60);
    } else if (live) {
      // instantâneo: o cursor da IA lê a posição na tela logo em seguida
      if (x > right - 48 || x < left + 24) el.scrollLeft = Math.max(0, x - HEADER_W - (el.clientWidth - HEADER_W) * 0.3);
    } else if (t !== last.current && (x > right || x < left)) {
      // saltos (Home/End, setas) trazem o playhead para a vista
      el.scrollLeft = Math.max(0, x - HEADER_W - (el.clientWidth - HEADER_W) / 2);
    }
    last.current = t;
  }, [t, zoom, playing, live, dragging, scrollRef, HEADER_W]);

  return <div className={`ep-tl-pline${live ? ' smooth' : ''}`} style={{ transform: `translateX(${HEADER_W + t * zoom}px)`, height }} aria-hidden />;
});

/* ---------------- alças de toque (ponteiro grosso) ----------------
   Fora do clipe (não cortadas pelo overflow), área de 44px centrada na borda,
   só no(s) item(ns) selecionado(s) — no toque nada depende de hover. */

const TOUCH_HIT = 44;

export const TouchHandles = memo(function TouchHandles({ project, rows, zoom }: { project: Project; rows: RowInfo[]; zoom: number }) {
  const { headerW, coarse } = useDims();
  const selection = useEditor((s) => s.selection);
  const captionSel = useTimelineUi((s) => s.captionSel);
  const drag = useTimelineUi((s) => s.drag);
  if (!coarse) return null;
  if (drag?.mode === 'move') return null;
  const items: { key: string; start: number; end: number; row: RowInfo; clipId?: string; capId?: string }[] = [];
  for (const id of selection.slice(0, 8)) {
    const f = findClip(project, id);
    if (!f || f.track.locked || f.clip.locked) continue;
    const row = rows.find((r) => r.id === f.track.id);
    if (!row) continue;
    let start = f.clip.start;
    let end = f.clip.start + f.clip.duration;
    if (drag && (drag.mode === 'trim-start' || drag.mode === 'trim-end') && drag.id === id) ({ start, end } = drag);
    items.push({ key: id, start, end, row, clipId: id });
  }
  if (captionSel) {
    const seg = project.captions.segments.find((s) => s.id === captionSel);
    const row = rows.find((r) => r.id === 'captions');
    if (seg && row) {
      let { start, end } = seg;
      if (drag && drag.mode.startsWith('cap') && (drag as { id: string }).id === seg.id) ({ start, end } = drag as { start: number; end: number });
      items.push({ key: seg.id, start, end, row, capId: seg.id });
    }
  }
  return (
    <>
      {items.flatMap((it) =>
        (['start', 'end'] as const).map((edge) => {
          const x = headerW + (edge === 'start' ? it.start : it.end) * zoom;
          const h = Math.max(TOUCH_HIT, it.row.height);
          // parte da área que invade o clipe: no máx. 1/4 da largura, p/ o miolo continuar arrastável
          const inner = Math.max(6, Math.min(TOUCH_HIT / 2, ((it.end - it.start) * zoom) / 4));
          const x0 = edge === 'start' ? x - (TOUCH_HIT - inner) : x - inner;
          return (
            <span
              key={`${it.key}-${edge}`}
              className={`ep-tl-thandle ${edge === 'start' ? 'l' : 'r'}`}
              data-handle={edge}
              {...(it.clipId ? { 'data-clip-id': it.clipId } : { 'data-cap-id': it.capId })}
              style={{ transform: `translate(${x0}px, ${it.row.top + (it.row.height - h) / 2}px)`, width: TOUCH_HIT, height: h }}
              aria-label={edge === 'start' ? 'Aparar início' : 'Aparar fim'}
            >
              <i style={{ left: (edge === 'start' ? TOUCH_HIT - inner : inner) - 5 }} />
            </span>
          );
        }),
      )}
    </>
  );
});

/* ---------------- losangos de keyframe (clipe selecionado) ---------------- */

export const KeyframeLayer = memo(function KeyframeLayer({ project, rows, zoom }: { project: Project; rows: RowInfo[]; zoom: number }) {
  const { headerW, coarse } = useDims();
  const selection = useEditor((s) => s.selection);
  const drag = useTimelineUi((s) => (s.drag?.mode === 'keyframe' ? s.drag : null));
  const items: { key: string; x: number; y: number; data: string }[] = [];
  for (const id of selection.slice(0, 6)) {
    const f = findClip(project, id);
    if (!f) continue;
    const row = rows.find((r) => r.id === f.track.id);
    if (!row) continue;
    keyframesOf(f.clip).forEach((k, i) => {
      const t = drag && drag.clipId === id && drag.index === i ? drag.t : k.t;
      items.push({ key: `${id}-${i}`, x: headerW + (f.clip.start + t) * zoom, y: row.top + row.height - 3, data: `${id}|${i}` });
    });
  }
  const hit = coarse ? 32 : 16;
  return (
    <>
      {items.map((it) => (
        <span
          key={it.key}
          className="ep-tl-kf"
          data-kf={it.data}
          style={{ transform: `translate(${it.x - hit / 2}px, ${it.y - hit / 2}px)`, width: hit, height: hit }}
          title="Keyframe — arraste para mudar o tempo"
          aria-label="Keyframe"
        >
          <i />
        </span>
      ))}
    </>
  );
});

/* ---------------- contorno de grupo (clipes de um mesmo modelo) ---------------- */

export const GroupOutlines = memo(function GroupOutlines({ project, rows, zoom }: { project: Project; rows: RowInfo[]; zoom: number }) {
  const { headerW } = useDims();
  const selection = useEditor((s) => s.selection);
  const drag = useTimelineUi((s) => (s.drag?.mode === 'move' ? s.drag : null));
  const groups = new Map<string, { t0: number; t1: number; y0: number; y1: number; sel: boolean; label?: string }>();
  const sel = new Set(selection);
  for (const r of rows) {
    if (!r.track) continue;
    for (const c of r.track.clips) {
      if (!c.groupId) continue;
      const shift = drag && drag.ids.includes(c.id) ? drag.delta : 0;
      const g = groups.get(c.groupId) ?? { t0: Infinity, t1: -Infinity, y0: Infinity, y1: -Infinity, sel: false, label: undefined as string | undefined };
      g.t0 = Math.min(g.t0, c.start + shift);
      g.t1 = Math.max(g.t1, c.start + c.duration + shift);
      g.y0 = Math.min(g.y0, r.top);
      g.y1 = Math.max(g.y1, r.top + r.height);
      g.sel = g.sel || sel.has(c.id);
      g.label = g.label ?? c.label;
      groups.set(c.groupId, g);
    }
  }
  return (
    <>
      {[...groups.entries()].map(([id, g]) => (
        <div
          key={id}
          className={`ep-tl-group${g.sel ? ' sel' : ''}`}
          style={{ transform: `translate(${headerW + g.t0 * zoom - 3}px, ${g.y0 - 1}px)`, width: (g.t1 - g.t0) * zoom + 6, height: g.y1 - g.y0 + 2 }}
          aria-hidden
        >
          {g.sel && g.label && <span className="lbl">{g.label}</span>}
        </div>
      ))}
    </>
  );
});

/* ---------------- modo celular: "Capa" e "Editar com IA" antes do início da trilha principal ---------------- */

/** id do marcador usado ANTES de existir Project.coverTime (migrado automaticamente pela Timeline) */
export const COVER_MARKER_ID = 'cover';

function MainLead({ height }: { height: number }) {
  const coverTime = useEditor((s) => s.project.coverTime);
  const thumb = useEditor((s) => {
    const t = coverTime ?? 0;
    const main = s.project.tracks.find((tr) => tr.kind === 'video');
    const c = main?.clips.find((cl) => t >= cl.start && t < cl.start + cl.duration) ?? main?.clips[0];
    if (!c || !('assetId' in c) || !c.assetId) return undefined;
    const a = s.assets[c.assetId];
    if (!a) return undefined;
    if (c.type === 'image') return a.thumbnails?.[0] ?? a.url;
    const th = a.thumbnails ?? [];
    if (!th.length || c.type !== 'video') return undefined;
    const src = c.in + Math.max(0, t - c.start) * (c.speed || 1);
    return th[Math.max(0, Math.min(th.length - 1, Math.floor((src / Math.max(a.duration, 0.001)) * th.length)))];
  });
  const h = Math.max(36, height - 6);
  const setCover = () => {
    const st = useEditor.getState();
    st.dispatch({ op: 'set_project', patch: { coverTime: st.playhead }, explain: 'Definindo a capa' });
    emit('ep:toast', { text: `Capa definida em ${formatTime(st.playhead)} — role e toque de novo para trocar`, kind: 'ok' });
  };
  return (
    <div className="ep-tl-mainlead">
      <button className="ep-tl-leadbtn ai" style={{ height: h }} onClick={() => { useEditor.getState().setChatContext(undefined); emit('ep:open-ai-popup', {}); }}>
        <ISparkle size={16} />
        <span>Editar com IA</span>
      </button>
      <button
        className="ep-tl-leadbtn cover"
        style={{ height: h, backgroundImage: thumb ? `url("${thumb}")` : undefined }}
        onClick={setCover}
        title="Usa o quadro no cursor como capa"
      >
        <span>Capa</span>
      </button>
    </div>
  );
}
