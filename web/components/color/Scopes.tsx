'use client';
/* =====================================================================
   Escopos: histograma RGB, forma de onda e vetorscópio do quadro do clipe
   COM a correção, a ~5 fps. Cálculo num Web Worker (fallback: thread
   principal). useScopes() também alimenta o histograma das curvas.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import type { ColorGrade } from '@/lib/types';
import { getColorGrader } from '@/lib/color/gl';
import { resolveGrade } from '@/lib/color/pipeline';
import { getLut } from '@/lib/color/luts';
import { isNeutralGrade } from '@/lib/color/grade';
import { computeScopes, drawHistogram, drawVectorscope, drawWaveform, type ScopeData, type ScopeOpts } from '@/lib/color/scopes';
import { Pills } from './controls';
import type { ClipFrame } from './useClipFrame';

const OPTS: ScopeOpts = { waveW: 240, waveH: 128, vecSize: 128 };
const INTERVAL = 200;

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, (s: ScopeData) => void>();
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../../lib/color/scopes.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; s: ScopeData }>) => { waiting.get(e.data.id)?.(e.data.s); waiting.delete(e.data.id); };
    worker.onerror = () => { worker = null; waiting.clear(); };
  } catch { worker = null; }
  return worker;
}

function scopesAsync(img: ImageData): Promise<ScopeData> {
  const w = getWorker();
  if (!w) return Promise.resolve(computeScopes(img, OPTS));
  return new Promise((res) => {
    const id = ++seq;
    const t = window.setTimeout(() => { waiting.delete(id); res(computeScopes(img, OPTS)); }, 1500);
    waiting.set(id, (s) => { window.clearTimeout(t); res(s); });
    w.postMessage({ id, data: img.data, width: img.width, height: img.height, opts: OPTS }, [img.data.buffer]);
  });
}

let readCanvas: HTMLCanvasElement | null = null;
/** quadro com a grade aplicada, como ImageData */
function gradedPixels(frame: ClipFrame, grade: ColorGrade): ImageData | null {
  const src = frame.canvas;
  const W = src.width, H = src.height;
  if (!readCanvas) readCanvas = document.createElement('canvas');
  if (readCanvas.width !== W || readCanvas.height !== H) { readCanvas.width = W; readCanvas.height = H; }
  const ctx = readCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, W, H);
  const out = isNeutralGrade(grade) ? null : getColorGrader('ui')?.render(src, resolveGrade(grade, getLut), W, H);
  ctx.drawImage((out ?? src) as CanvasImageSource, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

export function useScopes(frame: ClipFrame | null, grade: ColorGrade, active: boolean): ScopeData | null {
  const [data, setData] = useState<ScopeData | null>(null);
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const want = useRef<{ frame: ClipFrame; grade: ColorGrade } | null>(null);
  useEffect(() => {
    if (!active || !frame) return;
    want.current = { frame, grade };
    const run = async () => {
      if (inflight.current || !want.current) return;
      const job = want.current;
      want.current = null;
      inflight.current = true;
      last.current = performance.now();
      try {
        const img = gradedPixels(job.frame, job.grade);
        if (img) setData(await scopesAsync(img));
      } finally {
        inflight.current = false;
        if (want.current) timer.current = window.setTimeout(run, INTERVAL);
      }
    };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, Math.max(0, INTERVAL - (performance.now() - last.current)));
    return () => window.clearTimeout(timer.current);
  }, [active, frame?.version, frame, grade]);
  return active ? data : null;
}

type Kind = 'all' | 'hist' | 'wave' | 'vec';

function ScopeCanvas({ data, kind, label }: { data: ScopeData | null; kind: Exclude<Kind, 'all'>; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    const W = Math.max(50, Math.round(r.width * dpr)), H = Math.max(50, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (!data) { ctx.fillStyle = '#0B0C0E'; ctx.fillRect(0, 0, W, H); return; }
    if (kind === 'hist') drawHistogram(ctx, data, W, H);
    else if (kind === 'wave') drawWaveform(ctx, data, W, H);
    else drawVectorscope(ctx, data, W, H);
  }, [data, kind]);
  return (
    <figure className={`ec-scope ec-scope-${kind}`}>
      <canvas ref={ref} role="img" aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function ScopesTab({ data, hasFrame }: { data: ScopeData | null; hasFrame: boolean }) {
  const [kind, setKind] = useState<Kind>('all');
  return (
    <div className="ec-scopes">
      <Pills<Kind> label="Escopo" value={kind} onChange={setKind} options={[
        { id: 'all', label: 'Todos' }, { id: 'hist', label: 'Histograma' }, { id: 'wave', label: 'Forma de onda' }, { id: 'vec', label: 'Vetorscópio' },
      ]} />
      {!hasFrame && <p className="ec-hint">Carregando o quadro do clipe…</p>}
      <div className={`ec-scope-grid ${kind}`}>
        {(kind === 'all' || kind === 'wave') && <ScopeCanvas data={data} kind="wave" label="Forma de onda (RGB)" />}
        {(kind === 'all' || kind === 'vec') && <ScopeCanvas data={data} kind="vec" label="Vetorscópio" />}
        {(kind === 'all' || kind === 'hist') && <ScopeCanvas data={data} kind="hist" label="Histograma RGB" />}
      </div>
    </div>
  );
}
