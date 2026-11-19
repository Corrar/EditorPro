'use client';
/* =====================================================================
   "Mostrar desempenho": sobreposição pequena no preview com fps real,
   quadros perdidos, modo (nativo/canvas), fonte (proxy/original), codec e
   eventos de espera/busca — para o usuário mandar print do celular.
   ===================================================================== */
import { useEffect, useState } from 'react';
import { useEditor } from '@/lib/store';
import type { LiveMediaPool } from './livePool';

export interface PreviewStats { draws: number; held: number; costEma: number; quality: number; width: number; mode: 'nativo' | 'canvas'; reason: string }

interface Row { k: string; v: string; warn?: boolean }

export default function PerfHud({ stats, pool, canvas }: { stats: PreviewStats; pool: LiveMediaPool | null; canvas: HTMLCanvasElement | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let prev = { at: performance.now(), draws: stats.draws, frames: 0, dropped: 0, el: null as HTMLVideoElement | null };
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.max(0.001, (now - prev.at) / 1000);
      const el = pool?.shownElement ?? null;
      const q = el?.getVideoPlaybackQuality?.();
      const frames = q?.totalVideoFrames ?? 0, dropped = q?.droppedVideoFrames ?? 0;
      const same = el && el === prev.el;
      const vfps = same ? Math.max(0, (frames - prev.frames) / dt) : NaN;
      const playing = useEditor.getState().playing;
      const asset = el?.dataset.asset ? useEditor.getState().assets[el.dataset.asset] : undefined;
      const proxy = !!(asset && (asset as { proxyUrl?: string }).proxyUrl && el?.dataset.url === (asset as { proxyUrl?: string }).proxyUrl);
      const dfps = (stats.draws - prev.draws) / dt;
      setRows([
        { k: 'modo', v: stats.mode === 'nativo' ? 'nativo (vídeo do aparelho)' : `canvas · ${stats.reason || '—'}`, warn: stats.mode !== 'nativo' && playing },
        { k: 'fps vídeo', v: stats.mode === 'nativo' && playing && Number.isFinite(vfps) ? vfps.toFixed(0) : '—', warn: playing && vfps < 24 },
        { k: 'fps desenho', v: playing ? dfps.toFixed(0) : '—' },
        { k: 'perdidos', v: `${dropped} dec · ${stats.held} esp.`, warn: same ? dropped > prev.dropped : false },
        { k: 'fonte', v: el ? `${el.videoWidth}×${el.videoHeight} · ${proxy ? 'proxy' : 'original'}` : '—' },
        { k: 'codec', v: asset?.mime || '—' },
        { k: 'espera/busca', v: `${pool?.stats.waiting ?? 0} / ${pool?.stats.seeks ?? 0}` },
        { k: 'erros', v: String(pool?.stats.errors ?? 0), warn: (pool?.stats.errors ?? 0) > 0 },
        { k: 'canvas', v: canvas ? `${canvas.width}×${canvas.height} · ${stats.costEma.toFixed(1)} ms` : '—' },
      ]);
      prev = { at: now, draws: stats.draws, frames, dropped, el };
    }, 500);
    return () => clearInterval(id);
  }, [stats, pool, canvas]);
  return (
    <div className="ep-pv-perf" role="status" aria-label="Desempenho do preview">
      {rows.map((r) => (
        <div key={r.k} className={r.warn ? 'warn' : ''}><span>{r.k}</span><b>{r.v}</b></div>
      ))}
    </div>
  );
}
