'use client';
/* Conteúdo visual de um clipe (miniaturas, waveform, texto). Puro/memoizado. */
import { memo, useMemo } from 'react';
import type { Clip, MediaAsset } from '@/lib/types';
import { thumbIndexAt, waveformSlice } from '@/lib/timeline/edit';
import { IAudio, ICaptions, IImage, IMute, IText, IVideo } from './icons';

const MAX_TILES = 360;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** onda decorativa determinística (fallback quando não há waveform real) */
function fakePeaks(seed: string, n: number): number[] {
  let x = hash(seed) || 1;
  const out: number[] = [];
  let v = 0.5;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const r = ((x >>> 0) % 1000) / 1000;
    v = v * 0.6 + r * 0.4;
    out.push(0.25 + v * 0.55 * (0.6 + 0.4 * Math.sin(i / 7)));
  }
  return out;
}

function Thumbs({ clip, asset, width, height }: { clip: Extract<Clip, { type: 'video' | 'image' }>; asset?: MediaAsset; width: number; height: number }) {
  const thumbs = asset?.thumbnails ?? [];
  const still = clip.type === 'image' ? thumbs[0] ?? asset?.url : undefined;
  const ratio = asset?.width && asset?.height ? asset.width / asset.height : 9 / 16;
  let tileW = Math.max(28, Math.round(height * ratio));
  if (width / tileW > MAX_TILES) tileW = Math.ceil(width / MAX_TILES);
  const count = Math.max(1, Math.ceil(width / tileW));

  if (!thumbs.length && !still) return <div className="ep-tl-film" />;

  const tiles = [];
  for (let i = 0; i < count; i++) {
    let src = still;
    if (!src && clip.type === 'video') {
      const tTimeline = ((i + 0.5) * tileW) / Math.max(width, 1) * clip.duration;
      const srcT = clip.in + tTimeline * (clip.speed || 1);
      src = thumbs[thumbIndexAt(srcT, asset?.duration ?? 0, thumbs.length)];
    }
    tiles.push(<span key={i} className="ep-tl-tile" style={{ width: tileW, backgroundImage: src ? `url("${src}")` : undefined }} />);
  }
  return <div className="ep-tl-thumbs">{tiles}</div>;
}

function Wave({ clip, asset, width }: { clip: Extract<Clip, { type: 'audio' | 'video' }>; asset?: MediaAsset; width: number }) {
  const buckets = Math.max(4, Math.min(1200, Math.floor(width / 3)));
  const real = !!asset?.waveform?.length;
  const peaks = useMemo(() => {
    if (real && asset?.waveform) return waveformSlice(asset.waveform, asset.duration, clip.in, clip.duration * (clip.speed || 1), buckets);
    return fakePeaks(clip.id, buckets);
  }, [real, asset?.waveform, asset?.duration, clip.in, clip.duration, clip.speed, clip.id, buckets]);
  const muted = clip.type === 'video' && clip.muted;
  const vol = Math.min(1.6, Math.max(0.15, muted ? 0.15 : clip.volume ?? 1));
  const d = useMemo(() => {
    let s = '';
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(0.03, Math.min(1, peaks[i] * vol));
      s += `M${i + 0.5} ${50 - h * 46}V${50 + h * 46}`;
    }
    return s;
  }, [peaks, vol]);
  return (
    <svg className={`ep-tl-wave${real ? '' : ' fake'}`} viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth={0.62} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Fades({ clip, zoom }: { clip: Clip; zoom: number }) {
  if (clip.type !== 'audio' && clip.type !== 'video') return null;
  const fi = (clip.fadeIn ?? 0) * zoom;
  const fo = (clip.fadeOut ?? 0) * zoom;
  return (
    <>
      {fi > 2 && <span className="ep-tl-fade in" style={{ width: fi }} />}
      {fo > 2 && <span className="ep-tl-fade out" style={{ width: fo }} />}
    </>
  );
}

function ClipBodyInner({ clip, asset, width, height, zoom }: { clip: Clip; asset?: MediaAsset; width: number; height: number; zoom: number }) {
  const name = clip.type === 'text' ? clip.text : asset?.name ?? clip.label ?? 'Mídia';
  const speed = (clip.type === 'video' || clip.type === 'audio') && clip.speed !== 1 ? `${+clip.speed.toFixed(2)}x` : null;
  const Icon = clip.type === 'video' ? IVideo : clip.type === 'image' ? IImage : clip.type === 'audio' ? IAudio : IText;
  const showLabel = width > 26;

  return (
    <>
      {(clip.type === 'video' || clip.type === 'image') && <Thumbs clip={clip} asset={asset} width={width} height={height} />}
      {clip.type === 'audio' && <Wave clip={clip} asset={asset} width={width} />}
      {clip.type === 'text' && <div className="ep-tl-textbg" />}
      <Fades clip={clip} zoom={zoom} />
      {'transitionIn' in clip && clip.transitionIn && clip.transitionIn.kind !== 'cut' && (
        <span className="ep-tl-trans" title={`Transição: ${clip.transitionIn.kind}`} style={{ width: Math.max(8, clip.transitionIn.duration * zoom) }} />
      )}
      {showLabel && (
        <div className="ep-tl-cliplabel">
          <Icon size={11} />
          <span className="nm">{name}</span>
          {clip.label && clip.type !== 'text' && clip.label !== name && <span className="tag">{clip.label}</span>}
          {speed && <span className="tag">{speed}</span>}
          {clip.type === 'video' && clip.muted && <IMute size={11} />}
        </div>
      )}
    </>
  );
}

export const ClipBody = memo(ClipBodyInner);

export function CaptionBody({ text }: { text: string }) {
  return (
    <div className="ep-tl-cliplabel cap">
      <ICaptions size={11} />
      <span className="nm">{text}</span>
    </div>
  );
}
