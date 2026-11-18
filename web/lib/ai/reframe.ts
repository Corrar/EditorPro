/* =====================================================================
   Auto-reframe no NAVEGADOR: acha a posição horizontal do assunto ao longo
   do vídeo (rosto pelo MediaPipe FaceDetector, carregado do CDN; sem ele,
   "centro de detalhe" da imagem) e devolve pontos {t, x} p/ features.reframeOps.
   ===================================================================== */
import type { MediaAsset } from '../types';
import { deviceProfile, sampleVideo } from './frames';

const MP_VERSION = '1.2.3';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

interface MPDetection { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: { score: number }[] }
interface MPFaceDetector { detect(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): { detections: MPDetection[] }; close(): void }

let detectorP: Promise<MPFaceDetector | null> | null = null;

/** carrega o detector de rosto (14 MB de wasm na 1ª vez); null se o navegador não aguentar */
function faceDetector(): Promise<MPFaceDetector | null> {
  detectorP ??= (async () => {
    try {
      const mp = (await import(/* webpackIgnore: true */ `${MP_BASE}/vision_bundle.mjs`)) as {
        FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
        FaceDetector: { createFromOptions(fs: unknown, o: Record<string, unknown>): Promise<MPFaceDetector> };
      };
      const fs = await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return await mp.FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
    } catch (e) {
      console.warn('[ai] detector de rosto indisponível, usando centro de detalhe', e);
      return null;
    }
  })();
  return detectorP;
}

function loadImage(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('quadro inválido'));
    img.src = `data:image/jpeg;base64,${b64}`;
  });
}

/** "centro de detalhe": média horizontal ponderada pelo gradiente (onde está o que importa) */
function detailCenter(img: HTMLImageElement): number {
  const W = 64, H = Math.max(8, Math.round((64 * img.height) / Math.max(1, img.width)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0.5;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const lum = (x: number, y: number) => { const i = (y * W + x) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
  let sum = 0, wsum = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const g = Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
    // centro da imagem pesa um pouco mais (assunto costuma estar perto do meio)
    const w = g * (1.2 - Math.abs(x / W - 0.5));
    sum += (x / W) * w; wsum += w;
  }
  return wsum > 0 ? sum / wsum : 0.5;
}

export interface SubjectTrack { points: { t: number; x: number }[]; method: 'faces' | 'detail' | 'center' }

/** posição horizontal do assunto (0..1 da largura) ao longo da mídia */
export async function trackSubject(asset: MediaAsset, onProgress?: (f: number) => void): Promise<SubjectTrack> {
  if (!asset.url || asset.kind !== 'video') return { points: [], method: 'center' };
  const dev = deviceProfile();
  const frameEvery = asset.duration > 60 ? 2 : 1;
  const s = await sampleVideo(asset.url, { noDiffs: true, frameEvery, maxFrames: dev.weak ? 20 : 45, maxSide: 320, quality: 0.6, budgetBytes: 4_000_000, maxDuration: 600, onProgress: (f) => onProgress?.(f * 0.5) });
  const det = await faceDetector();
  let faces = 0;
  const points: { t: number; x: number }[] = [];
  for (let i = 0; i < s.frames.length; i++) {
    const f = s.frames[i];
    const img = await loadImage(f.data);
    let x: number | undefined;
    if (det) {
      try {
        const r = det.detect(img);
        // rosto maior (mais perto) = assunto principal
        const best = r.detections.filter((d) => d.boundingBox).sort((a, b) => b.boundingBox!.width * b.boundingBox!.height - a.boundingBox!.width * a.boundingBox!.height)[0];
        if (best?.boundingBox) { x = (best.boundingBox.originX + best.boundingBox.width / 2) / img.width; faces++; }
      } catch { /* quadro problemático: usa detalhe */ }
    }
    points.push({ t: f.t, x: x ?? detailCenter(img) });
    onProgress?.(0.5 + ((i + 1) / s.frames.length) * 0.5);
  }
  return { points, method: faces >= Math.max(1, s.frames.length / 3) ? 'faces' : points.length ? 'detail' : 'center' };
}
