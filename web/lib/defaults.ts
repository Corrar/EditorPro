/* fábricas de objetos padrão (projeto, clipes, estilos) */
import type {
  AspectRatio, AudioClip, CaptionStyle, MediaAsset, Project, Seconds, TextClip, TextStyle, VideoClip, ImageClip,
  StickerClip, ShapeClip, ShapeKind, AdjustmentClip,
} from './types';
import { ASPECT_SIZES, DEFAULT_TRANSFORM } from './types';
import { uid } from './util';

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Poppins',
  fontSize: 84,
  fontWeight: 800,
  color: '#FFFFFF',
  highlightColor: '#FFD23F',
  strokeColor: '#000000',
  strokeWidth: 6,
  background: '',
  shadow: true,
  uppercase: false,
  align: 'center',
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  ...DEFAULT_TEXT_STYLE,
  fontSize: 76,
  preset: 'bold-pop',
  position: { x: 0.5, y: 0.72 },
  animation: 'pop',
  maxWords: 3,
  uppercase: true,
};

export function createProject(opts: { name?: string; aspect?: AspectRatio; brief?: string } = {}): Project {
  const aspect = opts.aspect ?? '9:16';
  const now = Date.now();
  return {
    id: uid('proj'),
    name: opts.name ?? 'Projeto sem título',
    aspect,
    ...ASPECT_SIZES[aspect],
    fps: 30,
    background: '#000000',
    tracks: [
      { id: 'track_video_1', kind: 'video', name: 'Vídeo 1', clips: [] },
      { id: 'track_text_1', kind: 'text', name: 'Texto 1', clips: [] },
      { id: 'track_audio_1', kind: 'audio', name: 'Música', clips: [] },
    ],
    captions: { enabled: false, language: 'pt-BR', segments: [], style: DEFAULT_CAPTION_STYLE },
    brief: opts.brief ?? '',
    createdAt: now,
    updatedAt: now,
  };
}

export function makeVideoClip(asset: MediaAsset, start: Seconds, opts: Partial<VideoClip> = {}): VideoClip {
  return {
    id: uid('clip'),
    type: 'video',
    assetId: asset.id,
    start,
    duration: asset.duration,
    in: 0,
    speed: 1,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    filters: [],
    label: asset.name,
    ...opts,
  };
}

export function makeImageClip(asset: MediaAsset, start: Seconds, duration: Seconds = 3, opts: Partial<ImageClip> = {}): ImageClip {
  return { id: uid('clip'), type: 'image', assetId: asset.id, start, duration, transform: { ...DEFAULT_TRANSFORM }, filters: [], ...opts };
}

export function makeAudioClip(asset: MediaAsset, start: Seconds, opts: Partial<AudioClip> = {}): AudioClip {
  return { id: uid('clip'), type: 'audio', assetId: asset.id, start, duration: asset.duration, in: 0, speed: 1, volume: 1, ...opts };
}

export function makeTextClip(text: string, start: Seconds, duration: Seconds = 2.5, opts: Partial<TextClip> = {}): TextClip {
  return {
    id: uid('clip'),
    type: 'text',
    text,
    start,
    duration,
    style: { ...DEFAULT_TEXT_STYLE },
    position: { x: 0.5, y: 0.3 },
    animation: 'pop',
    ...opts,
  };
}

export function makeStickerClip(start: Seconds, src: { assetId?: string; emoji?: string }, duration: Seconds = 3, opts: Partial<StickerClip> = {}): StickerClip {
  return { id: uid('clip'), type: 'sticker', start, duration, ...src, transform: { ...DEFAULT_TRANSFORM, scale: 0.35 }, animationIn: { kind: 'pop', duration: 0.3 }, ...opts };
}

export function makeShapeClip(shape: ShapeKind, start: Seconds, duration: Seconds = 3, opts: Partial<ShapeClip> = {}): ShapeClip {
  return { id: uid('clip'), type: 'shape', shape, start, duration, fill: '#D9641E', transform: { ...DEFAULT_TRANSFORM, scale: 0.3 }, ...opts };
}

export function makeAdjustmentClip(start: Seconds, duration: Seconds = 5, opts: Partial<AdjustmentClip> = {}): AdjustmentClip {
  return { id: uid('clip'), type: 'adjustment', start, duration, filters: [], ...opts };
}
