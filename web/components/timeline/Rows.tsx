'use client';
/* Cabeçalhos e faixas das trilhas, linha de legendas, camada de arraste, playhead. */
import { memo, useEffect, useRef, useState } from 'react';
import type { Clip, Project, Track } from '@/lib/types';
import { useEditor } from '@/lib/store';
import { findClip } from '@/lib/ops';
import { HEADER_W, type RowInfo, useTimelineUi } from '@/lib/timeline/ui';
import { ClipView } from './ClipView';
import { CaptionBody, ClipBody } from './ClipBody';
import { IAudio, ICaptions, IEye, IEyeOff, ILock, IMute, IPlus, IText, IUnlock, IVideo, IVolume } from './icons';

/* ---------------- cabeçalho ---------------- */

function TrackHeaderInner({ track, height }: { track: Track; height: number }) {
  const dispatch = useEditor((s) => s.dispatch);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  const Icon = track.kind === 'video' ? IVideo : track.kind === 'audio' ? IAudio : IText;
  const upd = (patch: Partial<Track>) => dispatch({ op: 'update_track', trackId: track.id, patch });
  const commit = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== track.name) upd({ name: n });
    else setName(track.name);
  };
  return (
    <div className={`ep-tl-head k-${track.kind}${track.locked ? ' locked' : ''}`} style={{ width: HEADER_W, height }}>
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
        {track.kind !== 'text' && (
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
  return (
    <div className="ep-tl-head k-captions" style={{ width: HEADER_W, height }}>
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

function TrackLaneInner({ track, zoom, height, width }: { track: Track; zoom: number; height: number; width: number }) {
  const hint = useTimelineUi((s) => s.dropHint?.rowId === track.id || (s.drag?.mode === 'move' && s.drag.trackId === track.id && !s.drag.newTrack));
  return (
    <div className={`ep-tl-lane k-${track.kind}${track.hidden ? ' hidden' : ''}${track.locked ? ' locked' : ''}${hint ? ' hint' : ''}`} style={{ width, height }} data-row={track.id}>
      {track.clips.map((c) => (
        <ClipView key={c.id} clip={c} kind={track.kind} zoom={zoom} height={height} locked={!!track.locked} />
      ))}
    </div>
  );
}
const TrackLane = memo(TrackLaneInner);

function CaptionLane({ zoom, height, width }: { zoom: number; height: number; width: number }) {
  const segs = useEditor((s) => s.project.captions.segments);
  const enabled = useEditor((s) => s.project.captions.enabled);
  const sel = useTimelineUi((s) => s.captionSel);
  const drag = useTimelineUi((s) => (s.drag && s.drag.mode.startsWith('cap') ? (s.drag as { id: string; start: number; end: number }) : null));
  return (
    <div className={`ep-tl-lane k-captions${enabled ? '' : ' hidden'}`} style={{ width, height }} data-row="captions">
      {!segs.length && <span className="ep-tl-lanehint">Sem legendas — gere pelo painel Legendas ou peça no chat</span>}
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
      <span className="ep-tl-lanehint"><IPlus size={12} /> Solte aqui para criar uma trilha nova</span>
    </div>
  );
}

/* ---------------- linhas ---------------- */

export const Rows = memo(function Rows({ rows, zoom, width }: { rows: RowInfo[]; zoom: number; width: number }) {
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
              <div className="ep-tl-head k-new" style={{ width: HEADER_W, height: r.height }}>
                <span className="ep-tl-headic"><IPlus size={13} /></span>
                <div className="ep-tl-headname"><b>Nova trilha</b></div>
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
            <ClipBody clip={clip} asset={'assetId' in clip ? assets[clip.assetId] : undefined} width={w} height={h} zoom={zoom} />
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
  const last = useRef(t);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragging) return;
    const x = HEADER_W + t * zoom;
    const left = el.scrollLeft + HEADER_W;
    const right = el.scrollLeft + el.clientWidth;
    if (playing) {
      // paginação suave: quando passa da borda direita, pula p/ deixar o playhead perto da esquerda
      if (x > right - 40 || x < left) el.scrollLeft = Math.max(0, x - HEADER_W - 60);
    } else if (live) {
      if (x > right - 80 || x < left + 20) el.scrollTo({ left: Math.max(0, x - HEADER_W - (el.clientWidth - HEADER_W) / 2), behavior: 'smooth' });
    } else if (t !== last.current && (x > right || x < left)) {
      // saltos (Home/End, setas) trazem o playhead para a vista
      el.scrollLeft = Math.max(0, x - HEADER_W - (el.clientWidth - HEADER_W) / 2);
    }
    last.current = t;
  }, [t, zoom, playing, live, dragging, scrollRef]);

  return <div className={`ep-tl-pline${live ? ' smooth' : ''}`} style={{ transform: `translateX(${HEADER_W + t * zoom}px)`, height }} aria-hidden />;
});
