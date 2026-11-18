'use client';
/* Conteúdo visual de um clipe (miniaturas, waveform, texto). Puro/memoizado. */
import { memo, useMemo } from 'react';
import type { Clip, MediaAsset } from '@/lib/types';
import { thumbIndexAt, waveformSlice } from '@/lib/timeline/edit';
import { clipBadges } from '@/lib/timeline/clip';
import { IAudio, ICaptions, IChroma, IImage, IMask, IMute, IReverse, IShape, ISliders, ISparkle, ISticker, IText, IVideo } from './icons';

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

const SHAPE_NAMES: Record<string, string> = {
  rect: 'Retângulo', 'rounded-rect': 'Retângulo arredondado', circle: 'Círculo', triangle: 'Triângulo', star: 'Estrela',
  arrow: 'Seta', line: 'Linha', heart: 'Coração', 'speech-bubble': 'Balão',
};

/** desenho mínimo de cada forma (viewBox 0 0 24 24) */
function ShapeGlyph({ shape, fill, size = 18 }: { shape: string; fill: string; size?: number }) {
  const common = { fill, stroke: 'rgba(0,0,0,.25)', strokeWidth: 1 };
  let el;
  switch (shape) {
    case 'circle': el = <circle cx="12" cy="12" r="9" {...common} />; break;
    case 'triangle': el = <path d="M12 3 22 20H2z" {...common} />; break;
    case 'star': el = <path d="m12 2 3 6.6 7 .8-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.8z" {...common} />; break;
    case 'arrow': el = <path d="M3 10h11V5l7 7-7 7v-5H3z" {...common} />; break;
    case 'line': el = <rect x="2" y="10.5" width="20" height="3" rx="1.5" {...common} />; break;
    case 'heart': el = <path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" {...common} />; break;
    case 'speech-bubble': el = <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" {...common} />; break;
    case 'rounded-rect': el = <rect x="3" y="5" width="18" height="14" rx="4" {...common} />; break;
    default: el = <rect x="3" y="5" width="18" height="14" {...common} />;
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>{el}</svg>;
}

function Badges({ clip }: { clip: Clip }) {
  const b = clipBadges(clip);
  return (
    <>
      {b.speed && <span className="tag" title="Velocidade">{b.speed}</span>}
      {b.reverse && <span className="ic" title="Reverso"><IReverse size={10} /></span>}
      {b.effects ? <span className="ic" title={`${b.effects} efeito(s)`}><ISparkle size={10} />{b.effects > 1 ? b.effects : ''}</span> : null}
      {b.mask && <span className="ic" title="Máscara"><IMask size={10} /></span>}
      {b.chroma && <span className="ic" title="Chroma key"><IChroma size={10} /></span>}
    </>
  );
}

function clipName(clip: Clip, asset?: MediaAsset): string {
  switch (clip.type) {
    case 'text': return clip.text;
    case 'sticker': return clip.emoji ? `Sticker ${clip.emoji}` : asset?.name ?? clip.label ?? 'Sticker';
    case 'shape': return clip.label ?? SHAPE_NAMES[clip.shape] ?? 'Forma';
    case 'adjustment': return clip.label ?? 'Ajuste';
    default: return asset?.name ?? clip.label ?? 'Mídia';
  }
}

function ClipBodyInner({ clip, asset, width, height, zoom }: { clip: Clip; asset?: MediaAsset; width: number; height: number; zoom: number }) {
  const name = clipName(clip, asset);
  const Icon =
    clip.type === 'video' ? IVideo
    : clip.type === 'image' ? IImage
    : clip.type === 'audio' ? IAudio
    : clip.type === 'sticker' ? ISticker
    : clip.type === 'shape' ? IShape
    : clip.type === 'adjustment' ? ISliders
    : IText;
  const showLabel = width > 26;

  return (
    <>
      {(clip.type === 'video' || clip.type === 'image') && <Thumbs clip={clip} asset={asset} width={width} height={height} />}
      {clip.type === 'audio' && <Wave clip={clip} asset={asset} width={width} />}
      {clip.type === 'text' && <div className="ep-tl-textbg" />}
      {clip.type === 'sticker' && (
        <div className="ep-tl-sticker">
          {clip.emoji ? (
            <span className="emo" style={{ fontSize: Math.max(12, height * 0.55) }}>{clip.emoji}</span>
          ) : asset?.thumbnails?.[0] || asset?.url ? (
            <span className="img" style={{ backgroundImage: `url("${asset.thumbnails?.[0] ?? asset.url}")`, width: height - 8, height: height - 8 }} />
          ) : (
            <ISticker size={Math.max(12, height * 0.45)} />
          )}
        </div>
      )}
      {clip.type === 'shape' && (
        <div className="ep-tl-shape">
          <ShapeGlyph shape={clip.shape} fill={clip.fill} size={Math.max(12, Math.min(26, height - 10))} />
        </div>
      )}
      {clip.type === 'adjustment' && <div className="ep-tl-adjbg" />}
      <Fades clip={clip} zoom={zoom} />
      {'transitionIn' in clip && clip.transitionIn && clip.transitionIn.kind !== 'cut' && (
        <span className="ep-tl-trans" title={`Transição: ${clip.transitionIn.kind}`} style={{ width: Math.max(8, clip.transitionIn.duration * zoom) }} />
      )}
      {showLabel && (
        <div className="ep-tl-cliplabel">
          <Icon size={11} />
          <span className="nm">{name}</span>
          {clip.label && clip.type !== 'text' && clip.label !== name && <span className="tag">{clip.label}</span>}
          <Badges clip={clip} />
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
