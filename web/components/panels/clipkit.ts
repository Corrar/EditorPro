import type { AudioClip, Clip, ImageClip, ShapeClip, StickerClip, VideoClip, AdjustmentClip } from '@/lib/types';

export type VisualClip = VideoClip | ImageClip | StickerClip | ShapeClip;
export type FilterableClip = VideoClip | ImageClip | AdjustmentClip;
export type SoundClip = VideoClip | AudioClip;

export const isVisual = (c: Clip | undefined | null): c is VisualClip => !!c && (c.type === 'video' || c.type === 'image' || c.type === 'sticker' || c.type === 'shape');
export const isFilterable = (c: Clip | undefined | null): c is FilterableClip => !!c && (c.type === 'video' || c.type === 'image' || c.type === 'adjustment');
export const isSound = (c: Clip | undefined | null): c is SoundClip => !!c && (c.type === 'video' || c.type === 'audio');
export const isMediaVisual = (c: Clip | undefined | null): c is VideoClip | ImageClip => !!c && (c.type === 'video' || c.type === 'image');
