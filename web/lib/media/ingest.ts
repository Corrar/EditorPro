'use client';
/* =====================================================================
   Ingestão de mídia: File -> MediaAsset no store (+ blob no IndexedDB).
   1) detecta o tipo, cria object URL e lê duração/dimensões (elemento oculto)
   2) adiciona o asset no store JÁ (a biblioteca mostra na hora)
   3) gera miniaturas (canvas) e waveform (decodeAudioData) e atualiza o asset
   Escuta 'ep:attach-files' (chat/IA) via listenAttachFiles().
   Dono: sessão "shell".
   ===================================================================== */
import { create } from 'zustand';
import { emit, on } from '../events';
import { putBlob } from '../persist/db';
import { rememberRecent } from '../persist/recents';
import { useEditor } from '../store';
import type { MediaAsset, MediaRole } from '../types';
import { uid } from '../util';
import { startPreviewProxy } from './proxy';
import { UNDECODABLE_MSG, looksUndecodable, defaultRoleFor, mediaKindOf, peakCountFor, reducePeaks, thumbCountFor, thumbSize, thumbTimes } from './pure';

/* ---------- fila de importação (p/ a UI mostrar progresso) ---------- */

export interface IngestJob { id: string; name: string; stage: string }
export const useIngestQueue = create<{ jobs: IngestJob[] }>(() => ({ jobs: [] }));
const setJob = (j: IngestJob) =>
  useIngestQueue.setState((s) => ({ jobs: s.jobs.some((x) => x.id === j.id) ? s.jobs.map((x) => (x.id === j.id ? j : x)) : [...s.jobs, j] }));
const endJob = (id: string) => useIngestQueue.setState((s) => ({ jobs: s.jobs.filter((x) => x.id !== id) }));

/* ---------- helpers de DOM ---------- */

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

function loadVideoMeta(url: string, kind: 'video' | 'audio'): Promise<HTMLVideoElement | HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'auto';
    el.muted = true;
    (el as HTMLVideoElement).playsInline = true;
    el.crossOrigin = 'anonymous';
    el.onloadedmetadata = async () => {
      // alguns webm (MediaRecorder) vêm com duração Infinity: força o cálculo
      if (!isFinite(el.duration)) {
        await new Promise<void>((r) => {
          el.ontimeupdate = () => { el.ontimeupdate = null; r(); };
          el.currentTime = 1e7;
        });
        el.currentTime = 0;
      }
      resolve(el);
    };
    el.onerror = () => reject(new Error('não foi possível ler a mídia'));
    el.src = url;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('não foi possível ler a imagem'));
    img.src = url;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

async function videoThumbnails(v: HTMLVideoElement, duration: number): Promise<string[]> {
  const { width, height } = thumbSize(v.videoWidth, v.videoHeight, 96);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const out: string[] = [];
  for (const t of thumbTimes(duration, thumbCountFor(duration))) {
    await withTimeout(seek(v, t), 4000, undefined);
    try {
      ctx.drawImage(v, 0, 0, width, height);
      out.push(canvas.toDataURL('image/jpeg', 0.62));
    } catch {
      break;
    }
  }
  return out;
}

function imageThumbnail(img: HTMLImageElement): string[] {
  const { width, height } = thumbSize(img.naturalWidth, img.naturalHeight, 160);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, width, height);
  return [canvas.toDataURL('image/jpeg', 0.72)];
}

const MAX_DECODE_BYTES = 350 * 1024 * 1024;

async function waveformOf(file: Blob, duration: number): Promise<number[] | undefined> {
  if (file.size > MAX_DECODE_BYTES) return undefined;
  const AC: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return undefined;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const chans: Float32Array[] = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) chans.push(buf.getChannelData(i));
    return reducePeaks(chans, peakCountFor(duration || buf.duration));
  } catch {
    return undefined; // vídeo sem trilha de áudio, codec não suportado etc.
  } finally {
    ctx.close().catch(() => {});
  }
}

/* ---------- API ---------- */

export class IngestError extends Error {}

/**
 * Ingere um arquivo: devolve o MediaAsset completo (com miniaturas/waveform).
 * O asset entra no store assim que os metadados são lidos (antes das miniaturas).
 */
export async function ingestFile(file: File, role?: MediaRole): Promise<MediaAsset> {
  const kind = mediaKindOf(file.type, file.name);
  if (!kind) throw new IngestError(`Formato não suportado: ${file.name}`);
  const id = uid('asset');
  setJob({ id, name: file.name, stage: 'Lendo arquivo…' });
  const url = URL.createObjectURL(file);
  let asset: MediaAsset = {
    id, kind, role: defaultRoleFor(kind, role), name: file.name,
    mime: file.type || (kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/jpeg'),
    size: file.size, duration: 0, url,
  };
  const { addAsset, updateAsset } = useEditor.getState();
  const blobSaved = putBlob(id, file).catch((e) => console.warn('[ingest] blob não salvo', e));

  try {
    if (kind === 'image') {
      const img = await loadImage(url);
      asset = { ...asset, width: img.naturalWidth, height: img.naturalHeight, thumbnails: imageThumbnail(img) };
      addAsset(asset);
    } else {
      const el = await withTimeout(loadVideoMeta(url, kind), 15000, null as unknown as HTMLVideoElement);
      if (!el) throw new IngestError(`Não consegui ler ${file.name}`);
      const duration = isFinite(el.duration) ? el.duration : 0;
      asset = { ...asset, duration };
      if (kind === 'video') {
        const v = el as HTMLVideoElement;
        asset = { ...asset, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
      }
      addAsset(asset);
      if (kind === 'video') startPreviewProxy(file, asset); // cópia leve em segundo plano (vídeo pesado)
      if (kind === 'video') {
        setJob({ id, name: file.name, stage: 'Gerando miniaturas…' });
        const thumbnails = await videoThumbnails(el as HTMLVideoElement, duration);
        if (thumbnails.length) { asset = { ...asset, thumbnails }; updateAsset(id, { thumbnails }); }
        // HEVC/HDR que o aparelho não decodifica: avisa já na importação (mesmo texto do preview/export)
        if (looksUndecodable({ width: asset.width, height: asset.height, thumbCount: thumbnails.length, duration })) {
          emit('ep:toast', { text: UNDECODABLE_MSG(file.name), kind: 'error' });
        }
      }
      el.removeAttribute('src');
      el.load();
      setJob({ id, name: file.name, stage: 'Analisando áudio…' });
      const waveform = await waveformOf(file, duration);
      if (waveform) { asset = { ...asset, waveform }; updateAsset(id, { waveform }); }
    }
    await blobSaved;
    void rememberRecent(asset); // galeria "Recentes" do seletor dentro do app
    return asset;
  } catch (e) {
    if (!useEditor.getState().assets[id]) URL.revokeObjectURL(url);
    throw e instanceof IngestError ? e : new IngestError(`Não consegui importar ${file.name}`);
  } finally {
    endJob(id);
  }
}

/** ingere vários; falhas viram toast e são puladas. Mantém a ordem dos que deram certo. */
export async function ingestFiles(files: File[], role?: MediaRole, onEach?: (done: number, total: number) => void): Promise<MediaAsset[]> {
  const out: MediaAsset[] = [];
  let done = 0;
  for (const f of files) {
    try {
      out.push(await ingestFile(f, role));
    } catch (e) {
      emit('ep:toast', { text: e instanceof Error ? e.message : `Falha ao importar ${f.name}`, kind: 'error' });
    }
    onEach?.(++done, files.length);
  }
  return out;
}

/** liga a escuta de 'ep:attach-files' (chame uma vez no shell) */
export function listenAttachFiles(): () => void {
  return on('ep:attach-files', async ({ files, role }) => {
    if (!files?.length) return;
    const assets = await ingestFiles(files, role);
    // vídeo modelo (estilo): fica só na biblioteca (nunca na timeline) e vira a referência do projeto
    const ref = role === 'reference' ? assets.find((x) => x.kind === 'video') : undefined;
    if (ref) useEditor.getState().dispatch({ op: 'set_project', patch: { referenceAssetId: ref.id } }, { history: false });
    if (assets.length) emit('ep:toast', { text: assets.length === 1 ? `“${assets[0].name}” adicionado à mídia` : `${assets.length} arquivos adicionados à mídia`, kind: 'ok' });
  });
}
