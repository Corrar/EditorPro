/* =====================================================================
   Engine de renderização (dono: sessão "engine").
   Desenha o quadro do tempo t num canvas 2D a partir do Project.
   Usado pelo <Preview> (tempo real) e pelo export (quadro a quadro).
   ===================================================================== */
import type { Clip, Id, Project, Seconds } from '../types';
import { trackLayers } from './timing';
import { drawCaptions, drawLayer, drawTextClip } from './draw';

export type MediaElement = HTMLVideoElement | HTMLImageElement | HTMLAudioElement | ImageBitmap;

/** de onde o engine tira a mídia já carregada de cada asset */
export interface MediaSources {
  get(assetId: Id): MediaElement | undefined;
  /** opcional: elemento dedicado a um clipe (dois clipes do mesmo asset tocando juntos numa transição) */
  getForClip?(clip: Clip): MediaElement | undefined;
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
  ctx.fillStyle = project.background || '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';

  for (const track of project.tracks) {
    if (track.hidden) continue;
    if (track.kind === 'video') {
      for (const layer of trackLayers(track, t)) {
        const el = media.getForClip?.(layer.clip) ?? media.get(layer.clip.assetId);
        drawLayer(ctx, layer, t, el, W, H);
      }
    } else if (track.kind === 'text') {
      for (const c of track.clips) {
        if (c.type === 'text' && t >= c.start && t < c.start + c.duration && c.text.trim()) drawTextClip(ctx, c, t, W, H);
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
