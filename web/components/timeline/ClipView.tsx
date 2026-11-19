'use client';
/* Um clipe posicionado na trilha: seleção, alças de corte, brilho da IA, prévia de corte. */
import { memo, useRef } from 'react';
import type { Clip, TrackKind } from '@/lib/types';
import { useEditor } from '@/lib/store';
import { useTimelineUi } from '@/lib/timeline/ui';
import { formatTime } from '@/lib/util';
import { assetOf } from '@/lib/timeline/clip';
import { ClipBody } from './ClipBody';

interface Props {
  clip: Clip;
  kind: TrackKind;
  zoom: number;
  height: number;
  locked: boolean;
}

function ClipViewInner({ clip, kind, zoom, height, locked }: Props) {
  const selected = useEditor((s) => s.selection.includes(clip.id));
  const glowing = useEditor((s) => s.live.running && s.live.highlightClipId === clip.id);
  const asset = useEditor((s) => assetOf(clip, s.assets));
  // entra animado se nasceu durante a edição ao vivo da IA
  const enter = useRef(useEditor.getState().live.running);
  const drag = useTimelineUi((s) => {
    const d = s.drag;
    if (!d) return null;
    if (d.mode === 'move' && d.ids.includes(clip.id)) return d;
    if ((d.mode === 'trim-start' || d.mode === 'trim-end') && d.id === clip.id) return d;
    return null;
  });
  // trims profissionais: valores provisórios deste clipe (ripple/roll/slip/slide)
  const over = useTimelineUi((s) => (s.drag?.mode === 'pro' ? s.drag.over[clip.id] : undefined));
  const proMain = useTimelineUi((s) => s.drag?.mode === 'pro' && s.drag.clipId === clip.id);
  const blade = useTimelineUi((s) => (s.bladeAt?.clipId === clip.id ? s.bladeAt.t : null));

  let start = clip.start;
  let duration = clip.duration;
  const trimming = drag && drag.mode !== 'move';
  if (trimming) {
    start = drag.start;
    duration = drag.end - drag.start;
  }
  if (over) {
    start = over.start;
    duration = over.duration;
  }
  const h = Math.max(12, height - 6);
  const left = start * zoom;
  const width = Math.max(2, duration * zoom);
  // conteúdo continua ancorado na mídia ao aparar o início
  const shown = over
    ? ({ ...clip, start, duration, ...(over.in != null ? { in: over.in } : {}) } as Clip)
    : trimming ? previewClip(clip, start, duration) : clip;

  const cls = [
    'ep-tl-clip',
    `k-${clip.type}`,
    `t-${kind}`,
    selected && 'sel',
    glowing && 'glow',
    enter.current && 'enter',
    drag?.mode === 'move' && 'src',
    (trimming || proMain) && 'trimming',
    over && !proMain && 'pro-touched',
    (locked || clip.locked) && 'locked',
    width < 36 && 'tiny',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ transform: `translate(${left}px, 3px)`, width, height: h }}
      data-clip-id={clip.id}
      data-ep-clip={clip.id}
      title={`${clip.type === 'text' ? clip.text : asset?.name ?? clip.label ?? ''} · ${formatTime(clip.start, { decimals: true })} – ${formatTime(clip.start + clip.duration, { decimals: true })}`}
    >
      <ClipBody clip={shown} asset={asset} width={width} height={h} zoom={zoom} />
      {!locked && !clip.locked && (
        <>
          <span className="ep-tl-handle l" data-handle="start" />
          <span className="ep-tl-handle r" data-handle="end" />
        </>
      )}
      {blade != null && blade > clip.start && blade < clip.start + clip.duration && (
        <span className="ep-tl-bladeline" style={{ left: (blade - start) * zoom }} aria-hidden />
      )}
      {(trimming || proMain) && <span className="ep-tl-durtip mono">{formatTime(duration, { decimals: true })}</span>}
    </div>
  );
}

function previewClip(c: Clip, start: number, duration: number): Clip {
  const out = { ...c, start, duration } as Clip;
  if (out.type === 'video' || out.type === 'audio') {
    const sp = (c as typeof out).speed || 1;
    out.in = Math.max(0, (c as typeof out).in + (start - c.start) * sp);
  }
  return out;
}

export const ClipView = memo(ClipViewInner);
