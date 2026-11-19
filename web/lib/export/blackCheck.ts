/* =====================================================================
   Detector de quadro preto do export: amostra poucos pixels da fonte de um
   clipe (VideoFrame / <video>) num canvas 16×16. Usado nos primeiros quadros
   de cada clipe (e de vez em quando): se a fonte saiu toda preta, o pool
   re-tenta pelo caminho alternativo (WebCodecs ⇄ <video>).
   ===================================================================== */
import type { MediaElement } from '../engine';

/** luma máxima abaixo da qual a amostra conta como "preta" (0..255) */
export const BLACK_MAX_LUMA = 12;

/** estatísticas de luma (Rec.601) de pixels RGBA: média e máximo */
export function lumaStats(data: ArrayLike<number>): { avg: number; max: number } {
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += y;
    if (y > max) max = y;
    n++;
  }
  return { avg: n ? sum / n : 0, max };
}

/** a amostra é "toda preta"? (nenhum pixel passa do limite) */
export function isBlackSample(data: ArrayLike<number>, maxLuma = BLACK_MAX_LUMA): boolean {
  return lumaStats(data).max <= maxLuma;
}

/** quais quadros de um clipe checar: os 3 primeiros e depois 1 a cada `every` */
export function shouldCheck(nth: number, every = 90): boolean {
  return nth < 3 || nth % every === 0;
}

const SIZE = 16;
let probe: { cx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;

function probeCtx() {
  if (probe) return probe.cx;
  const c: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(SIZE, SIZE)
    : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const cx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!cx) return null;
  probe = { cx };
  return cx;
}

/**
 * true = a fonte está toda preta; false = tem imagem; null = não deu p/ medir
 * (sem quadro, canvas "tainted", etc. — nesse caso não se troca de caminho).
 */
export function sourceIsBlack(el: MediaElement | undefined): boolean | null {
  if (!el) return null;
  const cx = probeCtx();
  if (!cx) return null;
  try {
    if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement && (el.readyState < 2 || !el.videoWidth)) return null;
    cx.globalCompositeOperation = 'copy';
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, SIZE, SIZE);
    cx.drawImage(el as CanvasImageSource, 0, 0, SIZE, SIZE);
    return isBlackSample(cx.getImageData(0, 0, SIZE, SIZE).data);
  } catch {
    return null;
  }
}
