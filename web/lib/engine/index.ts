/* =====================================================================
   Engine de renderização (dono: sessão "engine").
   Desenha o quadro do tempo t num canvas 2D a partir do Project.
   Usado pelo <Preview> (tempo real) e pelo export (quadro a quadro).
   ===================================================================== */
import type { Clip, Id, Project, Seconds } from '../types';
import { trackLayers, type LayerItem } from './timing';
import { applyAdjustment, drawBackground, drawCaptions, drawLayer, drawTextClip } from './draw';

export type MediaElement = HTMLVideoElement | HTMLImageElement | HTMLAudioElement | ImageBitmap;

/** de onde o engine tira a mídia já carregada de cada asset */
export interface MediaSources {
  get(assetId: Id): MediaElement | undefined;
  /** opcional: elemento dedicado a um clipe (dois clipes do mesmo asset tocando juntos numa transição) */
  getForClip?(clip: Clip): MediaElement | undefined;
  /** export: máscaras de segmentação já calculadas de forma exata (não pedir em segundo plano) */
  offline?: boolean;
}

/**
 * Desenha o projeto no tempo t. O canvas pode ter qualquer tamanho com o
 * aspecto do projeto: tudo é desenhado em coordenadas relativas ao canvas.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: Seconds, media: MediaSources): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.imageSmoothingQuality = 'high';
  const elFor = (clip: LayerItem['clip']) => {
    const byClip = media.getForClip?.(clip);
    if (byClip) return byClip;
    return 'assetId' in clip && clip.assetId ? media.get(clip.assetId) : undefined;
  };

  // fundo: cor / desfoque da mídia de baixo / imagem
  const firstVideo = project.tracks.find((tr) => tr.kind === 'video' && !tr.hidden);
  const bottomLayer = firstVideo ? trackLayers(firstVideo, t).filter((l) => l.clip.type === 'video' || l.clip.type === 'image').pop() : undefined;
  drawBackground(ctx, project, t, W, H,
    bottomLayer ? { layer: bottomLayer, el: elFor(bottomLayer.clip) } : null,
    project.canvas?.type === 'image' && project.canvas.assetId ? media.get(project.canvas.assetId) : undefined);

  for (const track of project.tracks) {
    if (track.hidden) continue;
    if (track.kind === 'video' || track.kind === 'overlay') {
      for (const layer of trackLayers(track, t)) drawLayer(ctx, layer, t, elFor(layer.clip), W, H, { offline: media.offline });
    } else if (track.kind === 'text') {
      for (const c of track.clips) {
        if (c.type === 'text' && t >= c.start && t < c.start + c.duration && c.text.trim()) drawTextClip(ctx, c, t, W, H);
      }
    } else if (track.kind === 'effect') {
      for (const c of track.clips) {
        if (c.type === 'adjustment' && t >= c.start && t < c.start + c.duration) applyAdjustment(ctx, c, t, W, H);
      }
    }
  }
  drawCaptions(ctx, project, t, W, H);
  ctx.restore();
}

export { interpolateTransform, ease } from './easing';
export { sourceTime, visualLayers, trackLayers, activeMediaClips, fadeOpacity, effectiveTransition, isVisual, clipSpeed } from './timing';
export type { LayerItem, VisualClip } from './timing';
export { COLOR_PRESETS, PRESET_LABELS, presetFilters, resolveFilters } from './filters';
export { TRANSITION_LABELS, transitionVisual } from './transitions';
export { chunkCaptions, chunkAt, captionLook, CAPTION_PRESET_LABELS, CAPTION_LOOKS, wordStates, segmentWords } from './captions';
export type { CaptionChunk } from './captions';
export { layoutWords, splitText, textAnimState, fontPx } from './text';
export { clipGainAt, voiceAt, audibleClips, gainEnvelope, DUCK_GAIN } from './audio';
export { mediaSize } from './draw';
export { SPEED_PRESETS, SPEED_PRESET_LABELS, mapSourceTime, sourceSpan, rateAt, curveOf, curveIntegral } from './speed';
export { clipAnimFx, CLIP_ANIMATION_LABELS } from './animations';
export { EFFECT_LABELS } from './effects';
export { FILTER_LABELS } from './filters';
export { ALL_TRANSITIONS } from './transitions';
export { TEXT_ANIMATION_LABELS } from './text';
export { MASK_LABELS } from './masks';
export { SHAPE_LABELS } from './shapes';
export { segEvents, segmentationStatus } from './segment';
