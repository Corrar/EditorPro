'use client';
/* Marcadores, batidas e comentários na régua + popovers (marcador e trecho selecionado). */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Marker } from '@/lib/types';
import { useEditor } from '@/lib/store';
import { useTimelineUi } from '@/lib/timeline/ui';
import { beatTimes } from '@/lib/timeline/edit';
import { MARKER_COLORS, addMarker, askAiAboutRange } from '@/lib/timeline/actions';
import { formatTime } from '@/lib/util';
import { useFloatAt } from '@/lib/timeline/floating';
import { IAsk, IComment, IFlag, ITrash } from './icons';

/* ---------------- na régua ---------------- */

function markerTimes(m: Marker, drag: { id: string; t: number; end?: number } | null) {
  if (drag && drag.id === m.id) return { t: drag.t, end: drag.end };
  return { t: m.t, end: m.end };
}

export const RulerMarkers = memo(function RulerMarkers({ zoom }: { zoom: number }) {
  const markers = useEditor((s) => s.project.markers);
  const tracks = useEditor((s) => s.project.tracks);
  const assets = useEditor((s) => s.assets);
  const project = useEditor((s) => s.project);
  const drag = useTimelineUi((s) => (s.drag?.mode === 'marker' ? s.drag : null));
  const range = useTimelineUi((s) => s.range);
  const short = useTimelineUi((s) => s.dims.short);
  // batidas derivadas das mídias (só recalcula quando trilhas/assets mudam)
  const beats = useMemo(() => beatTimes(project, assets), [tracks, assets]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {range && (
        <span className="ep-tl-rulerange" style={{ transform: `translateX(${range.start * zoom}px)`, width: Math.max(2, (range.end - range.start) * zoom) }} />
      )}
      {!short && beats.length > 0 && zoom * minGap(beats) > 3 &&
        beats.map((b, i) => <i key={i} className="ep-tl-beat" style={{ transform: `translateX(${b * zoom}px)` }} />)}
      {(markers ?? []).map((m) => {
        const { t, end } = markerTimes(m, drag);
        const kind = m.kind ?? 'user';
        if (kind === 'beat')
          return <i key={m.id} className="ep-tl-beat mk" data-marker-id={m.id} style={{ transform: `translateX(${t * zoom}px)`, background: m.color }} title={m.label ?? 'Batida'} />;
        const color = kind === 'comment' ? (m.resolved ? 'var(--muted)' : 'var(--green)') : m.color ?? 'var(--green)';
        return (
          <span
            key={m.id}
            className={`ep-tl-marker k-${kind}${m.resolved ? ' resolved' : ''}${drag?.id === m.id ? ' dragging' : ''}`}
            data-marker-id={m.id}
            style={{ transform: `translateX(${t * zoom}px)`, ['--mc' as string]: color }}
            title={`${kind === 'comment' ? 'Comentário' : kind === 'chapter' ? 'Capítulo' : 'Marcador'} · ${formatTime(t, { decimals: true })}${m.label ? ` — ${m.label}` : ''}`}
            role="button"
            aria-label={m.label || (kind === 'comment' ? 'Comentário' : 'Marcador')}
          >
            {end != null && end > t && <span className="span" style={{ width: (end - t) * zoom }} />}
            {kind === 'comment' ? <IComment size={15} /> : <span className="pin" />}
            {kind === 'chapter' && m.label && zoom > 20 && <span className="lbl">{m.label}</span>}
          </span>
        );
      })}
    </>
  );
});

function minGap(arr: number[]): number {
  let g = Infinity;
  for (let i = 1; i < arr.length; i++) g = Math.min(g, arr[i] - arr[i - 1]);
  return g === Infinity ? 1 : g;
}

/** marcadores de comentário como linhas tracejadas finas por cima das trilhas */
export const MarkerLines = memo(function MarkerLines({ zoom, height, headerW }: { zoom: number; height: number; headerW: number }) {
  const markers = useEditor((s) => s.project.markers);
  const drag = useTimelineUi((s) => (s.drag?.mode === 'marker' ? s.drag : null));
  const range = useTimelineUi((s) => s.range);
  return (
    <>
      {range && (
        <div className="ep-tl-range" style={{ transform: `translateX(${headerW + range.start * zoom}px)`, width: Math.max(2, (range.end - range.start) * zoom), height }} />
      )}
      {(markers ?? []).filter((m) => m.kind !== 'beat').map((m) => {
        const { t, end } = markerTimes(m, drag);
        const kind = m.kind ?? 'user';
        const color = kind === 'comment' ? (m.resolved ? 'var(--muted)' : 'var(--green)') : m.color ?? 'var(--green)';
        return (
          <div key={m.id} className={`ep-tl-mline k-${kind}`} style={{ transform: `translateX(${headerW + t * zoom}px)`, height, ['--mc' as string]: color }}>
            {end != null && end > t && <span className="span" style={{ width: (end - t) * zoom }} />}
          </div>
        );
      })}
    </>
  );
});

/* ---------------- popovers ---------------- */

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement>, close: () => void, ignoreSel?: string) {
  useEffect(() => {
    if (!open) return;
    const h = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (e instanceof PointerEvent && (ref.current?.contains(t) || (ignoreSel && t.closest?.(ignoreSel)))) return;
      close();
    };
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('pointerdown', h, true);
      window.removeEventListener('keydown', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open, ref, close, ignoreSel]);
}

export function MarkerPop() {
  const pop = useTimelineUi((s) => s.markerPop);
  const setUi = useTimelineUi((s) => s.set);
  const marker = useEditor((s) => (pop ? s.project.markers?.find((m) => m.id === pop.id) : undefined));
  const dispatch = useEditor((s) => s.dispatch);
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  useEffect(() => setText(marker?.label ?? ''), [marker?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (marker && text !== (marker.label ?? '')) dispatch({ op: 'update_marker', markerId: marker.id, patch: { label: text } });
  };
  const close = () => {
    save();
    setUi({ markerPop: null });
  };
  // só o marcador ABERTO é ignorado: tocar em outro salva o texto deste antes de trocar
  useOutsideClose(!!pop, ref, close, pop ? `[data-marker-id="${pop.id}"]` : undefined);
  const floatStyle = useFloatAt(ref, !!pop && !!marker, pop?.x ?? 0, pop?.y ?? 0, -16, [pop, marker?.kind]);
  if (!pop || !marker) return null;
  const kind = marker.kind ?? 'user';
  const isComment = kind === 'comment';
  const upd = (patch: Partial<Marker>) => dispatch({ op: 'update_marker', markerId: marker.id, patch });
  return (
    <div ref={ref} className="ep-tl-menu ep-tl-mpop" style={floatStyle} role="dialog" aria-label={isComment ? 'Comentário de revisão' : 'Marcador'}>
      <div className="ep-tl-menuhead">
        {isComment ? <IComment size={12} /> : <IFlag size={12} />} {isComment ? 'Comentário' : 'Marcador'} · {formatTime(marker.t, { decimals: true })}
        {marker.end != null && `–${formatTime(marker.end, { decimals: true })}`}
      </div>
      {isComment ? (
        <textarea
          className="ep-tl-rename area"
          autoFocus={pop.isNew}
          placeholder="O que deve mudar aqui? (a IA lê os comentários pendentes)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close(); }}
          rows={3}
        />
      ) : (
        <input
          className="ep-tl-rename"
          autoFocus={pop.isNew}
          placeholder="Nome do marcador"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') close(); }}
        />
      )}
      {!isComment && (
        <div className="ep-tl-swatches" role="radiogroup" aria-label="Cor">
          {MARKER_COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={marker.color === c} aria-label={`Cor ${c}`} className={marker.color === c ? 'on' : ''} style={{ background: c }} onClick={() => upd({ color: c })} />
          ))}
          <button className={`chip${kind === 'chapter' ? ' on' : ''}`} onClick={() => upd({ kind: kind === 'chapter' ? 'user' : 'chapter' })}>Capítulo</button>
        </div>
      )}
      {isComment && (
        <button role="menuitemcheckbox" aria-checked={!!marker.resolved} onClick={() => upd({ resolved: !marker.resolved })}>
          <span className={`ep-tl-check${marker.resolved ? ' on' : ''}`} /> {marker.resolved ? 'Resolvido' : 'Marcar como resolvido'}
        </button>
      )}
      <button
        role="menuitem"
        onClick={() => {
          save();
          useEditor.getState().setChatContext({
            markerId: marker.id,
            range: { start: marker.t, end: marker.end ?? marker.t },
            label: `${isComment ? 'Comentário' : 'Marcador'} · ${formatTime(marker.t)}${text ? ` “${text.slice(0, 20)}”` : ''}`,
          });
          setUi({ markerPop: null });
        }}
      >
        <IAsk size={15} /> Perguntar à IA sobre isto
      </button>
      <div className="ep-tl-menusep" />
      <button role="menuitem" className="danger" onClick={() => { dispatch({ op: 'remove_marker', markerId: marker.id }); setUi({ markerPop: null }); }}>
        <ITrash size={15} /> Remover
      </button>
    </div>
  );
}

export function RangePop() {
  const pop = useTimelineUi((s) => s.rangePop);
  const range = useTimelineUi((s) => s.range);
  const setUi = useTimelineUi((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(!!pop, ref, () => setUi({ rangePop: null }), '.ep-tl-scale');
  const floatStyle = useFloatAt(ref, !!pop && !!range, pop?.x ?? 0, pop?.y ?? 0, -16, [pop]);
  if (!pop || !range) return null;
  const run = (fn: () => void) => () => { fn(); setUi({ rangePop: null }); };
  return (
    <div ref={ref} className="ep-tl-menu" style={floatStyle} role="menu">
      <div className="ep-tl-menuhead">Trecho {formatTime(range.start, { decimals: true })}–{formatTime(range.end, { decimals: true })}</div>
      <button role="menuitem" onClick={run(() => askAiAboutRange(range.start, range.end))}><IAsk size={15} /> Perguntar à IA sobre isto</button>
      <button
        role="menuitem"
        onClick={() => {
          const id = addMarker('comment', { t: range.start, end: range.end });
          setUi({ rangePop: null, range: null, markerPop: { id, x: pop.x, y: pop.y, isNew: true } });
        }}
      >
        <IComment size={15} /> Comentar trecho
      </button>
      <button role="menuitem" onClick={run(() => { useEditor.getState().dispatch({ op: 'ripple_delete', start: range.start, end: range.end, explain: 'Cortando o trecho' }); setUi({ range: null }); })}>
        <ITrash size={15} /> Cortar trecho (ripple)
      </button>
      <div className="ep-tl-menusep" />
      <button role="menuitem" onClick={run(() => setUi({ range: null }))}>Limpar seleção</button>
    </div>
  );
}
