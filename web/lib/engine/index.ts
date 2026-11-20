/* =====================================================================
   Engine de renderização (dono: sessão "engine").
   Desenha o quadro do tempo t num canvas 2D a partir do Project.
   Usado pelo <Preview> (tempo real) e pelo export (quadro a quadro).
   ===================================================================== */
import type { Clip, Id, Project, Seconds } from '../types';
import { trackLayers, type LayerItem } from './timing';
import { applyAdjustment, drawBackground, drawCaptions, drawLayer, drawTextClip } from './draw';
import { isShaderTransition, runShaderTransition, shaderTransitionsAvailable } from './shaderTransitions';
import { scratch } from './surface';
import { animateClip } from './animate';

export type MediaElement = HTMLVideoElement | HTMLImageElement | HTMLAudioElement | ImageBitmap | VideoFrame | HTMLCanvasElement | OffscreenCanvas;

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
export interface RenderOpts {
  /** preview híbrido: a base (fundo + trilha principal) é o <video> nativo — desenha só o que vai por cima, com fundo transparente */
  overlayOnly?: { skipTrackId: string };
}

export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: Seconds, media: MediaSources, opts: RenderOpts = {}): void {
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

  const skip = opts.overlayOnly?.skipTrackId;
  if (skip) ctx.clearRect(0, 0, W, H);
  // fundo: cor / desfoque da mídia de baixo / imagem
  const firstVideo = project.tracks.find((tr) => tr.kind === 'video' && !tr.hidden);
  const bottomLayer = firstVideo ? trackLayers(firstVideo, t).filter((l) => l.clip.type === 'video' || l.clip.type === 'image').pop() : undefined;
  if (!skip) drawBackground(ctx, project, t, W, H,
    bottomLayer ? { layer: bottomLayer, el: elFor(bottomLayer.clip) } : null,
    project.canvas?.type === 'image' && project.canvas.assetId ? media.get(project.canvas.assetId) : undefined);

  for (const track of project.tracks) {
    if (track.hidden || track.id === skip) continue;
    if (track.kind === 'video' || track.kind === 'overlay') {
      const layers = trackLayers(track, t);
      const inL = layers.find((l) => l.transition?.role === 'in' && isShaderTransition(l.transition.kind));
      if (inL && shaderTransitionsAvailable()) {
        // transição em shader: "de" = quadro até aqui + clipe que sai; "para" = quadro até aqui + clipe que entra
        const outL = layers.find((l) => l.transition?.role === 'out');
        const plain = (l: LayerItem): LayerItem => ({ clip: l.clip });
        const { c: base, ctx: bc } = scratch(ctx.canvas, W, H, 20);
        bc.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
        const { c: from, ctx: fc } = scratch(ctx.canvas, W, H, 21);
        fc.drawImage(base as CanvasImageSource, 0, 0);
        if (outL) drawLayer(fc, plain(outL), t, elFor(outL.clip), W, H, { offline: media.offline });
        const { c: to, ctx: tc } = scratch(ctx.canvas, W, H, 22);
        tc.drawImage(base as CanvasImageSource, 0, 0);
        drawLayer(tc, plain(inL), t, elFor(inL.clip), W, H, { offline: media.offline });
        // (fx) código/params da transição 'custom' — com os keyframes resolvidos ('transitionIn.params.N')
        const inClip = animateClip(inL.clip, t - inL.clip.start);
        const mixed = runShaderTransition(inL.transition!.kind as never, from as TexImageSource, to as TexImageSource, inL.transition!.progress, W, H,
          'transitionIn' in inClip ? inClip.transitionIn : undefined);
        ctx.drawImage((mixed ?? to) as CanvasImageSource, 0, 0);
        for (const l of layers) if (l !== inL && l !== outL) drawLayer(ctx, l, t, elFor(l.clip), W, H, { offline: media.offline });
      } else {
        for (const layer of layers) drawLayer(ctx, layer, t, elFor(layer.clip), W, H, { offline: media.offline });
      }
    } else if (track.kind === 'text') {
      for (const c of track.clips) {
        if (c.type === 'text' && t >= c.start && t < c.start + c.duration && c.text.trim()) drawTextClip(ctx, c, t, W, H);
      }
    } else if (track.kind === 'effect') {
      for (const c of track.clips) {
        if (c.type === 'adjustment' && t >= c.start && t < c.start + c.duration) applyAdjustment(ctx, c, t, W, H, media.offline);
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
export { SHADER_TRANSITIONS, SHADER_TRANSITION_LABELS, isShaderTransition } from './shaderTransitions';
export { TEXT_ANIMATION_LABELS } from './text';
export { MASK_LABELS } from './masks';
export { SHAPE_LABELS } from './shapes';
export { segEvents, segmentationStatus } from './segment';
export { assetEvents, ensureFontLoaded, ensureProjectFonts } from './fonts';
export { unitKindOf, unitFx, staggerStarts } from './textUnits';
