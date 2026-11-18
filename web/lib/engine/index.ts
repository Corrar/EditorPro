/* =====================================================================
   Engine de renderização — CONTRATO (dono: sessão "engine").
   Desenha o quadro do tempo t num canvas 2D a partir do Project.
   É usado pelo <Preview> (tempo real) e pelo export (quadro a quadro).
   ===================================================================== */
import type { Id, Project, Seconds } from '../types';

export type MediaElement = HTMLVideoElement | HTMLImageElement | HTMLAudioElement | ImageBitmap;

/** de onde o engine tira a mídia já carregada de cada asset */
export interface MediaSources {
  get(assetId: Id): MediaElement | undefined;
}

/** desenha o projeto no tempo t (canvas já dimensionado para project.width/height ou proporcional) */
export function renderFrame(_ctx: CanvasRenderingContext2D, _project: Project, _t: Seconds, _media: MediaSources): void {
  throw new Error('engine: renderFrame ainda não implementado');
}
