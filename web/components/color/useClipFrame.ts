'use client';
/* =====================================================================
   Quadro reduzido e SEM correção do clipe selecionado no tempo do playhead
   (miniaturas dos looks e escopos). Usa um <video>/<img> próprio, oculto,
   para não disputar com o preview. Atualiza no máximo a ~5 fps.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import type { Clip, MediaAsset, Project, Seconds } from '@/lib/types';
import { sourceTime } from '@/lib/engine/timing';

export const FRAME_MAX = 320;

/** clipe que fornece a imagem: o próprio (vídeo/imagem) ou, p/ camada de ajuste, o vídeo/imagem por baixo */
export function frameSourceClip(p: Project, clip: Clip, t: Seconds): Clip | null {
  if (clip.type === 'video' || clip.type === 'image') return clip;
  if (clip.type !== 'adjustment') return null;
  const at = Math.min(Math.max(t, clip.start), clip.start + clip.duration - 1e-3);
  for (const tr of p.tracks) {
    if (tr.hidden || (tr.kind !== 'video' && tr.kind !== 'overlay')) continue;
    const c = tr.clips.find((k) => (k.type === 'video' || k.type === 'image') && at >= k.start && at < k.start + k.duration);
    if (c) return c;
  }
  return null;
}

function urlOf(a?: MediaAsset): string | undefined {
  return a ? a.proxyUrl || a.url : undefined;
}

export interface ClipFrame {
  /** canvas com o quadro original reduzido (≤ FRAME_MAX no lado maior) */
  canvas: HTMLCanvasElement;
  /** muda a cada novo quadro (dependência p/ efeitos) */
  version: number;
}

export function useClipFrame(clip: Clip | null, active = true): ClipFrame | null {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const playhead = useEditor((s) => s.playhead);
  const [version, setVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<{ url: string; img: HTMLImageElement } | null>(null);
  const pending = useRef<{ t: number; url: string } | null>(null);
  const busy = useRef(false);
  const lastAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  if (typeof document !== 'undefined' && !canvasRef.current) {
    canvasRef.current = document.createElement('canvas');
    canvasRef.current.width = 2; canvasRef.current.height = 2;
  }

  const src = clip ? frameSourceClip(project, clip, playhead) : null;
  const asset = src && 'assetId' in src && src.assetId ? assets[src.assetId] : undefined;
  const url = urlOf(asset);
  const kind = src?.type;
  const t = src && src.type === 'video' ? Math.max(0, sourceTime(src, Math.min(Math.max(playhead, src.start), src.start + src.duration - 1 / 60))) : 0;

  useEffect(() => {
    if (!active || !url || !canvasRef.current) return;
    const cv = canvasRef.current;
    const paint = (el: CanvasImageSource, w: number, h: number) => {
      if (!w || !h) return;
      const k = Math.min(1, FRAME_MAX / Math.max(w, h));
      const W = Math.max(2, Math.round(w * k)), H = Math.max(2, Math.round(h * k));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      try { ctx.drawImage(el, 0, 0, W, H); setVersion((v) => v + 1); } catch { /* sem quadro ainda */ }
    };
    if (kind === 'image') {
      if (imgRef.current?.url === url && imgRef.current.img.complete) { paint(imgRef.current.img, imgRef.current.img.naturalWidth, imgRef.current.img.naturalHeight); return; }
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      imgRef.current = { url, img };
      img.onload = () => paint(img, img.naturalWidth, img.naturalHeight);
      return;
    }
    // vídeo: busca com limite de frequência (~5 fps) e coalescendo pedidos
    pending.current = { t, url };
    const run = () => {
      const job = pending.current;
      if (!job || busy.current) return;
      pending.current = null;
      busy.current = true;
      lastAt.current = performance.now();
      let v = videoRef.current;
      if (!v) {
        v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('aria-hidden', 'true');
        videoRef.current = v;
      }
      const done = () => {
        busy.current = false;
        if (pending.current) timer.current = window.setTimeout(run, Math.max(0, 200 - (performance.now() - lastAt.current)));
      };
      const seekAndPaint = () => {
        const target = Math.min(job.t, Math.max(0, (v!.duration || job.t + 1) - 0.05));
        if (Math.abs(v!.currentTime - target) < 0.02 && v!.readyState >= 2) { paint(v!, v!.videoWidth, v!.videoHeight); done(); return; }
        const onSeek = () => { v!.removeEventListener('seeked', onSeek); paint(v!, v!.videoWidth, v!.videoHeight); done(); };
        v!.addEventListener('seeked', onSeek);
        try { v!.currentTime = target; } catch { v!.removeEventListener('seeked', onSeek); done(); }
      };
      if (v.src !== job.url && v.getAttribute('data-src') !== job.url) {
        v.setAttribute('data-src', job.url);
        v.src = job.url;
        const onMeta = () => { v!.removeEventListener('loadeddata', onMeta); seekAndPaint(); };
        v.addEventListener('loadeddata', onMeta);
        v.addEventListener('error', () => { busy.current = false; }, { once: true });
      } else seekAndPaint();
    };
    const wait = Math.max(0, 200 - (performance.now() - lastAt.current));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, wait);
    return () => window.clearTimeout(timer.current);
  }, [active, url, kind, t]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    const v = videoRef.current;
    if (v) { v.removeAttribute('src'); v.load(); videoRef.current = null; }
  }, []);

  if (!canvasRef.current || !url || version === 0) return null;
  return { canvas: canvasRef.current, version };
}
