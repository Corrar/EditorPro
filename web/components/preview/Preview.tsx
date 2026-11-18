'use client';
/* =====================================================================
   Preview em tempo real (dono: sessão "engine").
   Canvas com o aspecto do projeto, relógio próprio em requestAnimationFrame,
   <video>/<audio> sincronizados (LiveMediaPool) e o mesmo renderFrame do export.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';
import { renderFrame } from '@/lib/engine';
import { emit, on } from '@/lib/events';
import { formatTime } from '@/lib/util';
import { LiveMediaPool } from './livePool';
import ExportDialog from './ExportDialog';
import { IcExport, IcFilm, IcFull, IcPause, IcPlay, IcRewind, IcSafe, IcSpark, IcUpload } from './icons';

/** lado menor máximo do canvas interno do preview (o export usa a resolução cheia) */
const PREVIEW_MAX_SHORT = 720;
const PREVIEW_MIN_SHORT = 360;

function fmt(t: number) {
  return formatTime(t, { decimals: true });
}

export default function Preview() {
  const aspect = useEditor((s) => `${s.project.width}:${s.project.height}`);
  const projW = useEditor((s) => s.project.width);
  const projH = useEditor((s) => s.project.height);
  const projAspect = useEditor((s) => s.project.aspect);
  const duration = useEditor((s) => projectDuration(s.project));
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const liveRunning = useEditor((s) => s.live.running);
  const liveText = useEditor((s) => s.live.current?.explain);
  const liveDone = useEditor((s) => s.live.done);
  const liveTotal = useEditor((s) => s.live.total);

  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<LiveMediaPool | null>(null);
  const lastSetRef = useRef(0);
  const clockRef = useRef({ t0: 0, wall0: 0 });
  const pendingRef = useRef(0);

  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [safe, setSafe] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  if (!poolRef.current && typeof window !== 'undefined') poolRef.current = new LiveMediaPool();

  /* ---------- desenho ---------- */
  const draw = useCallback((t: number) => {
    const cv = canvasRef.current;
    const pool = poolRef.current;
    if (!cv || !pool) return;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) return;
    const st = useEditor.getState();
    try {
      renderFrame(ctx, st.project, t, pool);
    } catch (e) {
      console.error('[preview] falha ao desenhar', e);
    }
    const d = projectDuration(st.project);
    if (timeRef.current) timeRef.current.textContent = fmt(t);
    if (barRef.current) barRef.current.style.transform = `scaleX(${d > 0 ? Math.min(1, t / d) : 0})`;
  }, []);

  /** re-render quando pausado (agrupa pedidos num único rAF) */
  const requestStill = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = requestAnimationFrame(() => {
      pendingRef.current = 0;
      const st = useEditor.getState();
      if (st.playing) return;
      poolRef.current?.sync(st.project, st.assets, st.playhead, false, st.project.fps);
      draw(st.playhead);
    });
  }, [draw]);

  /* pool: host oculto p/ os elementos + callback de quadro novo */
  useEffect(() => {
    // (StrictMode monta/desmonta 2x: recria o pool se a limpeza anterior o descartou)
    const pool = poolRef.current ?? (poolRef.current = new LiveMediaPool());
    if (hostRef.current) pool.attach(hostRef.current);
    pool.onFrame = () => { if (!useEditor.getState().playing) requestStill(); };
    return () => { pool.dispose(); poolRef.current = null; };
  }, [requestStill]);

  /* ---------- tamanho: encaixa o quadro no palco mantendo o aspecto ---------- */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / projW, r.height / projH);
      setFit({ w: Math.max(0, Math.floor(projW * k)), h: Math.max(0, Math.floor(projH * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [projW, projH, fullscreen]);

  /* resolução interna adaptativa */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !fit.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const short = Math.min(projW, projH);
    const cssShort = Math.min(fit.w, fit.h) * dpr;
    const targetShort = Math.max(PREVIEW_MIN_SHORT, Math.min(PREVIEW_MAX_SHORT, cssShort, short));
    const k = targetShort / short;
    const w = Math.round((projW * k) / 2) * 2;
    const h = Math.round((projH * k) / 2) * 2;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      requestStill();
    }
  }, [fit.w, fit.h, projW, projH, requestStill]);

  /* ---------- pausado: re-renderiza ao mudar playhead/projeto/mídia ---------- */
  useEffect(() => {
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.playing) {
        // seek externo durante a reprodução (ex.: clique na régua): reposiciona o relógio
        if (s.playhead !== prev.playhead && Math.abs(s.playhead - lastSetRef.current) > 0.05) {
          clockRef.current = { t0: s.playhead, wall0: performance.now() };
          lastSetRef.current = s.playhead;
        }
        return;
      }
      if (s.playhead !== prev.playhead || s.project !== prev.project || s.assets !== prev.assets || s.playing !== prev.playing) {
        requestStill();
      }
    });
    requestStill();
    return unsub;
  }, [requestStill]);

  /* ---------- reprodução: relógio próprio ---------- */
  useEffect(() => {
    const pool = poolRef.current;
    if (!playing || !pool) {
      pool?.pauseAll();
      return;
    }
    const st0 = useEditor.getState();
    const d0 = projectDuration(st0.project);
    if (d0 <= 0) { setPlaying(false); return; }
    let start = st0.playhead;
    if (start >= d0 - 1 / 30) start = 0;
    clockRef.current = { t0: start, wall0: performance.now() };
    lastSetRef.current = start;
    if (start !== st0.playhead) setPlayhead(start);
    let raf = 0;
    const tick = () => {
      const st = useEditor.getState();
      if (!st.playing) return;
      const d = projectDuration(st.project);
      let t = clockRef.current.t0 + (performance.now() - clockRef.current.wall0) / 1000;
      if (t >= d) {
        t = d;
        pool.pauseAll();
        lastSetRef.current = d;
        st.setPlayhead(d);
        st.setPlaying(false);
        draw(Math.max(0, d - 1 / (st.project.fps || 30)));
        return;
      }
      pool.sync(st.project, st.assets, t, true, st.project.fps);
      draw(t);
      lastSetRef.current = t;
      st.setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, setPlaying, setPlayhead]);

  /* ---------- eventos / tela cheia ---------- */
  useEffect(() => on('ep:open-export', () => { setPlaying(false); setExportOpen(true); }), [setPlaying]);
  useEffect(() => {
    const h = () => setFullscreen(document.fullscreenElement === frameRef.current?.parentElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const togglePlay = () => setPlaying(!useEditor.getState().playing);
  const toStart = () => { setPlayhead(0); if (playing) clockRef.current = { t0: 0, wall0: performance.now() }; };
  const toggleFull = async () => {
    const el = frameRef.current?.parentElement;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch { /* sem permissão */ }
  };
  const seekFromBar = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setPlayhead(f * duration);
  };

  const empty = duration <= 0;
  const isVertical = projAspect === '9:16';

  return (
    <div className={`ep-pv${fullscreen ? ' is-full' : ''}`}>
      <div className="ep-pv-box" ref={boxRef}>
        <div className="ep-pv-frame" ref={frameRef} style={{ width: fit.w, height: fit.h }} data-aspect={aspect}>
          <canvas ref={canvasRef} className="ep-pv-canvas" onClick={empty ? undefined : togglePlay} aria-label="Pré-visualização do vídeo" />
          {safe && !empty && (
            <div className={`ep-pv-safe${isVertical ? ' vertical' : ''}`} aria-hidden="true">
              {isVertical ? (
                <>
                  <div className="z top"><span>Barra do app</span></div>
                  <div className="z bottom"><span>Legenda/@perfil do app</span></div>
                  <div className="z right"><span>Botões</span></div>
                  <div className="area" />
                </>
              ) : (
                <><div className="title-safe" /><div className="action-safe" /></>
              )}
            </div>
          )}
          {liveRunning && (
            <div className="ep-pv-live" role="status">
              <span className="dot" />
              <IcSpark size={13} />
              <b>IA editando…</b>
              {liveTotal > 0 && <span className="n mono">{Math.min(liveDone + 1, liveTotal)}/{liveTotal}</span>}
              {liveText && <span className="txt">{liveText}</span>}
            </div>
          )}
          {empty && (
            <div className="ep-pv-empty">
              <div className="ic"><IcFilm size={26} /></div>
              <h4>Envie um vídeo para começar</h4>
              <p>Arraste seus clipes para a biblioteca ou escolha arquivos. A IA monta a primeira edição e você ajusta pelo chat.</p>
              <label className="ep-btn primary ep-pv-upload">
                <IcUpload size={15} /> Escolher arquivos
                <input
                  type="file" accept="video/*,image/*,audio/*" multiple hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) emit('ep:attach-files', { files, role: 'source' });
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}
        </div>
        <div ref={hostRef} className="ep-pv-host" aria-hidden="true" />
      </div>

      <div className="ep-pv-controls">
        <div className="ep-pv-scrub" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromBar(e); }}
          onPointerMove={(e) => { if (e.buttons) seekFromBar(e); }} role="slider" aria-label="Posição"
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={0}>
          <div className="fill" ref={barRef} />
        </div>
        <div className="ep-pv-row">
          <button className="ep-pv-btn" onClick={toStart} title="Voltar ao início" aria-label="Voltar ao início" disabled={empty}><IcRewind size={16} /></button>
          <button className="ep-pv-play" onClick={togglePlay} title={playing ? 'Pausar' : 'Reproduzir'} aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={empty}>
            {playing ? <IcPause size={18} /> : <IcPlay size={18} />}
          </button>
          <div className="ep-pv-time mono"><span ref={timeRef}>{fmt(0)}</span><i>/</i><span className="tot">{fmt(duration)}</span></div>
          <span style={{ flex: 1 }} />
          <button className={`ep-pv-chip${safe ? ' on' : ''}`} onClick={() => setSafe(!safe)} title="Guias de área segura (TikTok/Reels)" disabled={empty}>
            <IcSafe size={14} /> Área segura
          </button>
          <button className="ep-pv-btn" onClick={() => emit('ep:open-export', {})} title="Exportar" aria-label="Exportar" disabled={empty}><IcExport size={16} /></button>
          <button className="ep-pv-btn" onClick={toggleFull} title="Tela cheia" aria-label="Tela cheia"><IcFull size={16} /></button>
        </div>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
