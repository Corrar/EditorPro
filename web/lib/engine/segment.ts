/* =====================================================================
   Remover fundo: segmentação de pessoa no navegador (MediaPipe
   ImageSegmenter "selfie"), carregada sob demanda na 1ª vez que um clipe
   usa removeBackground. renderFrame (síncrono) usa a última máscara pronta
   do clipe; o export aguarda a máscara exata de cada quadro (ensureSegMask).
   ===================================================================== */
import { makeCanvas, type AnyCanvas, type Ctx } from './surface';

const VERSION = '1.2.3';
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const INPUT = 256;

type Segmenter = { segment: (img: CanvasImageSource | ImageData | OffscreenCanvas) => { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array; close(): void }[]; close?: () => void } };

let loading: Promise<Segmenter | null> | null = null;
let failed = false;
const masks = new Map<string, { canvas: AnyCanvas; time: number }>();
const busy = new Set<string>();
/** chamado quando uma máscara nova fica pronta (o preview re-renderiza) */
export const segEvents = { onReady: () => {} };

export function segmentationStatus(): 'idle' | 'loading' | 'ready' | 'failed' {
  if (failed) return 'failed';
  if (!loading) return 'idle';
  return masks.size || readyFlag ? 'ready' : 'loading';
}
let readyFlag = false;

function load(): Promise<Segmenter | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const files = await vision.FilesetResolver.forVisionTasks(WASM);
      const seg = await vision.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      readyFlag = true;
      return seg as unknown as Segmenter;
    } catch (e) {
      console.warn('[engine] não deu para carregar a segmentação (remover fundo)', e);
      failed = true;
      return null;
    }
  })();
  return loading;
}

const inputCanvas = () => makeCanvas(INPUT, INPUT);
let input: AnyCanvas | null = null;

function run(seg: Segmenter, key: string, src: CanvasImageSource, sw: number, sh: number, time: number) {
  const k = INPUT / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  input = input ?? inputCanvas();
  if (input.width !== w || input.height !== h) { input.width = w; input.height = h; }
  const ictx = input.getContext('2d') as Ctx;
  ictx.drawImage(src, 0, 0, w, h);
  const res = seg.segment(input as unknown as CanvasImageSource);
  const m = res.confidenceMasks?.[0];
  if (!m) return;
  const data = m.getAsFloat32Array();
  let entry = masks.get(key);
  if (!entry || entry.canvas.width !== m.width || entry.canvas.height !== m.height) {
    entry = { canvas: makeCanvas(m.width, m.height), time };
    masks.set(key, entry);
  }
  const mctx = entry.canvas.getContext('2d') as Ctx;
  const img = mctx.createImageData(m.width, m.height);
  for (let i = 0; i < data.length; i++) {
    const a = Math.min(255, Math.max(0, Math.round((data[i] - 0.15) * 1.6 * 255)));
    img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = a;
  }
  mctx.putImageData(img, 0, 0);
  entry.time = time;
  res.confidenceMasks?.forEach((x) => x.close());
}

/** última máscara (alfa = pessoa) conhecida do clipe, se houver */
export function getSegMask(key: string): AnyCanvas | undefined {
  return masks.get(key)?.canvas;
}

/** pede (sem esperar) uma máscara nova para o quadro atual do clipe */
export function requestSegMask(key: string, src: CanvasImageSource, sw: number, sh: number, time: number) {
  if (failed || busy.has(key)) return;
  const cur = masks.get(key);
  if (cur && Math.abs(cur.time - time) < 1 / 60) return;
  busy.add(key);
  load().then((seg) => {
    if (seg) {
      try { run(seg, key, src, sw, sh, time); segEvents.onReady(); } catch (e) { console.warn('[engine] segmentação falhou', e); }
    }
  }).finally(() => busy.delete(key));
}

/** export: calcula a máscara exata do quadro antes de desenhar */
export async function ensureSegMask(key: string, src: CanvasImageSource, sw: number, sh: number, time: number): Promise<void> {
  const seg = await load();
  if (!seg) return;
  try { run(seg, key, src, sw, sh, time); } catch (e) { console.warn('[engine] segmentação falhou', e); }
}
