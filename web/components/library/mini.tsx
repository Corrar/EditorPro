'use client';
/* =====================================================================
   Biblioteca · infraestrutura das miniaturas animadas.
   Um único laço requestAnimationFrame (~24 fps) desenha só as miniaturas
   visíveis (IntersectionObserver), usando o renderFrame do engine num
   canvas pequeno. Respeita prefers-reduced-motion (quadro estático).
   ===================================================================== */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { renderFrame, type MediaElement, type MediaSources } from '@/lib/engine';
import { createProject } from '@/lib/defaults';
import { DEFAULT_TRANSFORM, type AspectRatio, type Clip, type Filter, type Project, type Track } from '@/lib/types';

/* ---------- laço compartilhado ---------- */

interface Job { draw: (t: number) => void; visible: boolean; animate: boolean }
const jobs = new Set<Job>();
let raf = 0;
let last = 0;
const FRAME = 1000 / 24;

function loop(now: number) {
  raf = 0;
  if (now - last >= FRAME) {
    last = now;
    for (const j of jobs) if (j.visible && j.animate) j.draw(now / 1000);
  }
  if ([...jobs].some((j) => j.visible && j.animate)) raf = requestAnimationFrame(loop);
}
function kick() { if (!raf && typeof window !== 'undefined') raf = requestAnimationFrame(loop); }

/** redesenha tudo quando uma fonte termina de carregar (miniaturas estáticas também) */
let fontHook = false;
function hookFonts() {
  if (fontHook || typeof document === 'undefined' || !('fonts' in document)) return;
  fontHook = true;
  document.fonts.addEventListener('loadingdone', () => { for (const j of jobs) if (j.visible) j.draw(performance.now() / 1000); });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Registra um canvas no laço. `draw(t)` recebe o tempo do relógio (s).
 * Com animate=false desenha uma vez (e de novo quando deps/fontes mudam).
 */
export function useMiniLoop(ref: RefObject<HTMLCanvasElement | null>, draw: (ctx: CanvasRenderingContext2D, clock: number) => void, animate: boolean, deps: unknown[]) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    hookFonts();
    const job: Job = {
      visible: false,
      animate: animate && !prefersReducedMotion(),
      draw: (t) => {
        const c = ref.current;
        if (!c) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(2, Math.round(c.clientWidth * dpr));
        const h = Math.max(2, Math.round(c.clientHeight * dpr));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext('2d');
        if (ctx) drawRef.current(ctx, t);
      },
    };
    jobs.add(job);
    const io = new IntersectionObserver((ents) => {
      job.visible = ents.some((e) => e.isIntersecting);
      if (job.visible) { job.draw(performance.now() / 1000); kick(); }
    }, { rootMargin: '80px' });
    io.observe(el);
    return () => { io.disconnect(); jobs.delete(job); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, ...deps]);
}

/** quando o elemento entra na tela (p/ carregar fontes sob demanda) */
export function useVisible<T extends Element>(ref: RefObject<T | null>, once = true): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((ents) => {
      const vis = ents.some((e) => e.isIntersecting);
      if (vis || !once) setV(vis);
      if (vis && once) io.disconnect();
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once]);
  return v;
}

/* ---------- cena de fundo gerada (sem arquivo) ---------- */

let sceneCanvas: HTMLCanvasElement | null = null;

/** paisagem estilizada (céu de fim de tarde, sol, morros) usada atrás das prévias */
export function previewScene(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (sceneCanvas) return sceneCanvas;
  const c = document.createElement('canvas');
  c.width = 640; c.height = 800;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, '#2B3A67'); sky.addColorStop(0.45, '#C0587E'); sky.addColorStop(0.7, '#F49A54'); sky.addColorStop(1, '#3B2A3A');
  g.fillStyle = sky; g.fillRect(0, 0, 640, 800);
  const sun = g.createRadialGradient(400, 470, 10, 400, 470, 170);
  sun.addColorStop(0, 'rgba(255,236,190,1)'); sun.addColorStop(0.35, 'rgba(255,190,120,.85)'); sun.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 640, 800);
  g.fillStyle = '#4A2E46';
  g.beginPath(); g.moveTo(0, 560); g.quadraticCurveTo(160, 470, 330, 560); g.quadraticCurveTo(480, 640, 640, 540); g.lineTo(640, 800); g.lineTo(0, 800); g.fill();
  g.fillStyle = '#2A1B2E';
  g.beginPath(); g.moveTo(0, 650); g.quadraticCurveTo(220, 590, 400, 670); g.quadraticCurveTo(540, 720, 640, 660); g.lineTo(640, 800); g.lineTo(0, 800); g.fill();
  // pessoa estilizada (silhueta) p/ dar escala e pele aproximada nos looks
  g.fillStyle = '#E8A57E';
  g.beginPath(); g.arc(210, 520, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1F2A44';
  g.beginPath(); g.moveTo(130, 800); g.quadraticCurveTo(140, 590, 210, 585); g.quadraticCurveTo(285, 590, 292, 800); g.fill();
  sceneCanvas = c;
  return c;
}

/* ---------- projeto mínimo p/ prévias ---------- */

export const SCENE_ASSET = '__lib_scene__';

/** fontes de mídia: a cena gerada + imagens extras (quadro atual etc.) */
export function miniMedia(extra?: Record<string, MediaElement | HTMLCanvasElement | undefined>): MediaSources {
  return {
    get: (id) => (extra?.[id] ?? (id === SCENE_ASSET ? previewScene() : undefined)) as MediaElement | undefined,
  };
}

/** projeto com a cena de fundo (ou um asset) e as trilhas dadas por cima */
export function miniProject(aspect: AspectRatio, layers: { kind: Track['kind']; clips: Clip[] }[], opts: { background?: string; sceneAsset?: string | null; sceneFilters?: Filter[] } = {}): Project {
  const p = createProject({ aspect });
  const tracks: Track[] = [];
  if (opts.sceneAsset !== null) {
    tracks.push({
      id: 'mini_bg', kind: 'video', name: 'bg',
      clips: [{ id: 'mini_scene', type: 'image', assetId: opts.sceneAsset ?? SCENE_ASSET, start: 0, duration: 1e6, transform: { ...DEFAULT_TRANSFORM }, filters: opts.sceneFilters ?? [] }],
    });
  }
  layers.forEach((l, i) => tracks.push({ id: `mini_${i}`, kind: l.kind, name: l.kind, clips: [...l.clips].sort((a, b) => a.start - b.start) }));
  return { ...p, background: opts.background ?? '#1B1C20', tracks };
}

/** desenha o projeto mínimo no tempo t (engine real) */
export function drawMini(ctx: CanvasRenderingContext2D, p: Project, t: number, media?: MediaSources) {
  try {
    renderFrame(ctx, p, t, media ?? miniMedia());
  } catch (e) {
    // miniatura nunca derruba a galeria
    ctx.fillStyle = '#26272b';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (process.env.NODE_ENV !== 'production') console.warn('[biblioteca] miniatura', e);
  }
}

let zoomCanvas: HTMLCanvasElement | null = null;

/** região (frações do quadro) a mostrar ampliada na miniatura */
export interface Region { x: number; y: number; w: number; h: number }

/**
 * Desenha só a região do quadro (zoom), renderizando o quadro inteiro num
 * canvas auxiliar maior e recortando. Mantém o texto legível em miniaturas.
 */
export function drawMiniRegion(ctx: CanvasRenderingContext2D, p: Project, t: number, region: Region, media?: MediaSources) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (region.w >= 0.999 && region.h >= 0.999) return drawMini(ctx, p, t, media);
  zoomCanvas ??= document.createElement('canvas');
  const fw = Math.min(2400, Math.round(W / region.w));
  const fh = Math.min(3000, Math.round(H / region.h));
  if (zoomCanvas.width !== fw || zoomCanvas.height !== fh) { zoomCanvas.width = fw; zoomCanvas.height = fh; }
  const zc = zoomCanvas.getContext('2d');
  if (!zc) return;
  drawMini(zc, p, t, media);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(zoomCanvas, region.x * fw, region.y * fh, region.w * fw, region.h * fh, 0, 0, W, H);
  ctx.restore();
}

/** canvas de miniatura que ocupa o contêiner */
export function MiniCanvas({ draw, animate = true, deps, className, label }: {
  draw: (ctx: CanvasRenderingContext2D, clock: number) => void; animate?: boolean; deps: unknown[]; className?: string; label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useMiniLoop(ref, draw, animate, deps);
  return <canvas ref={ref} className={`ep-lib-canvas ${className ?? ''}`} aria-label={label} role={label ? 'img' : undefined} />;
}
