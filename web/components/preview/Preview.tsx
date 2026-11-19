'use client';
/* =====================================================================
   Preview em tempo real (dono: sessão "engine").
   Canvas com o aspecto do projeto, relógio próprio em requestAnimationFrame,
   <video>/<audio> sincronizados (LiveMediaPool) e o mesmo renderFrame do export.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';
import { renderFrame, segEvents } from '@/lib/engine';
import { emit, on } from '@/lib/events';
import { formatTime } from '@/lib/util';
import { LiveMediaPool } from './livePool';
import ExportDialog from './ExportDialog';
import { IcExport, IcFilm, IcFull, IcPause, IcPlay, IcRewind, IcSafe, IcSpark, IcTarget, IcUpload } from './icons';

/** lado menor máximo do canvas interno do preview (o export usa a resolução cheia) */
const PREVIEW_MAX_SHORT = 720;
const PREVIEW_MAX_SHORT_WEAK = 540;
const PREVIEW_MIN_SHORT = 360;

/** aparelho modesto (celular / poucos núcleos / pouca memória): resolução interna menor */
function isWeakDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

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
  /** "tela cheia" por CSS (iPhone não tem Fullscreen API para elementos que não são <video>) */
  const [cssFull, setCssFull] = useState(false);
  /* "apontar para qualquer coisa": marca um ponto do quadro como contexto do chat */
  const [pointMode, setPointMode] = useState(false);
  const chatPoint = useEditor((s) => s.chatContext?.point);
  const [markerAt, setMarkerAt] = useState(0);
  const pressRef = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null);

  if (!poolRef.current && typeof window !== 'undefined') poolRef.current = new LiveMediaPool();
  /** tamanho-base do canvas interno e fator de qualidade dinâmico (cai se a reprodução não aguentar) */
  const baseRef = useRef({ w: 0, h: 0 });
  const qualityRef = useRef(1);
  const emaRef = useRef(0);
  const framesRef = useRef(0);

  const applySize = useCallback(() => {
    const cv = canvasRef.current;
    const { w: bw, h: bh } = baseRef.current;
    if (!cv || !bw) return false;
    const q = qualityRef.current;
    const w = Math.max(2, Math.round((bw * q) / 2) * 2);
    const h = Math.max(2, Math.round((bh * q) / 2) * 2);
    if (cv.width === w && cv.height === h) return false;
    cv.width = w;
    cv.height = h;
    return true;
  }, []);

  /* ---------- desenho ---------- */
  const draw = useCallback((t: number) => {
    const cv = canvasRef.current;
    const pool = poolRef.current;
    if (!cv || !pool) return;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) return;
    const st = useEditor.getState();
    const t0 = performance.now();
    try {
      renderFrame(ctx, st.project, t, pool);
    } catch (e) {
      console.error('[preview] falha ao desenhar', e);
    }
    // qualidade adaptativa só durante a reprodução: quadro caro → reduz a resolução interna
    // (ignora os primeiros quadros: o decodificador ainda está aquecendo)
    if (st.playing && ++framesRef.current > 10) {
      const dt = performance.now() - t0;
      emaRef.current = emaRef.current ? emaRef.current * 0.85 + dt * 0.15 : dt;
      if (emaRef.current > 32 && qualityRef.current > 0.4) {
        qualityRef.current = Math.max(0.4, qualityRef.current * 0.82);
        emaRef.current = 22;
        applySize();
      } else if (emaRef.current < 16 && qualityRef.current < 1) {
        qualityRef.current = Math.min(1, qualityRef.current * 1.08);
        emaRef.current = 20;
        applySize();
      }
    }
    const d = projectDuration(st.project);
    if (timeRef.current) timeRef.current.textContent = fmt(t);
    if (barRef.current) barRef.current.style.transform = `scaleX(${d > 0 ? Math.min(1, t / d) : 0})`;
  }, [applySize]);

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
    // máscara de "remover fundo" ficou pronta: redesenha o quadro parado
    segEvents.onReady = () => { if (!useEditor.getState().playing) requestStill(); };
    return () => { pool.dispose(); poolRef.current = null; };
  }, [requestStill]);

  /* ---------- tamanho: encaixa o quadro no palco mantendo o aspecto ---------- */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // área útil = caixa menos o padding do palco
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const k = Math.max(0, Math.min(w / projW, h / projH));
      setFit({ w: Math.max(0, Math.floor(projW * k)), h: Math.max(0, Math.floor(projH * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [projW, projH, fullscreen, cssFull]);

  /* resolução interna adaptativa */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !fit.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const short = Math.min(projW, projH);
    const cssShort = Math.min(fit.w, fit.h) * dpr;
    const maxShort = isWeakDevice() ? PREVIEW_MAX_SHORT_WEAK : PREVIEW_MAX_SHORT;
    const targetShort = Math.max(Math.min(PREVIEW_MIN_SHORT, short), Math.min(maxShort, cssShort, short));
    const k = targetShort / short;
    baseRef.current = { w: Math.round((projW * k) / 2) * 2, h: Math.round((projH * k) / 2) * 2 };
    if (applySize()) requestStill();
  }, [fit.w, fit.h, projW, projH, requestStill, applySize]);

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
      // parado: volta à qualidade cheia para o quadro estático
      framesRef.current = 0;
      emaRef.current = 0;
      if (qualityRef.current < 1) { qualityRef.current = 1; if (applySize()) requestStill(); }
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
  }, [playing, draw, setPlaying, setPlayhead, applySize, requestStill]);

  /* ---------- eventos / tela cheia ---------- */
  useEffect(() => on('ep:open-export', () => { setPlaying(false); setExportOpen(true); }), [setPlaying]);
  useEffect(() => {
    const h = () => {
      const d = document as FsDoc;
      setFullscreen((d.fullscreenElement ?? d.webkitFullscreenElement ?? null) === frameRef.current?.parentElement);
    };
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h); };
  }, []);

  /* destrava o áudio no 1º gesto do usuário em qualquer lugar da página (política de autoplay iOS/Android) */
  const unlock = useCallback(() => {
    const st = useEditor.getState();
    poolRef.current?.unlock(st.project, st.assets);
  }, []);
  useEffect(() => {
    const h = () => {
      unlock();
      window.removeEventListener('pointerdown', h, true);
      window.removeEventListener('keydown', h, true);
    };
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', h, true);
    return () => { window.removeEventListener('pointerdown', h, true); window.removeEventListener('keydown', h, true); };
  }, [unlock]);

  /* sai da tela cheia CSS com Esc (só enquanto ativa) e trava a rolagem da página */
  useEffect(() => {
    if (!cssFull) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCssFull(false); };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [cssFull]);

  const togglePlay = () => { unlock(); setPlaying(!useEditor.getState().playing); };

  const pointAt = (clientX: number, clientY: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const st = useEditor.getState();
    if (st.playing) st.setPlaying(false);
    const t = st.playhead;
    st.setChatContext({ point: { x, y, t }, label: `Ponto no vídeo · ${formatTime(t)}` });
    setMarkerAt(Date.now());
    setPointMode(false);
  };
  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointMode || e.altKey) { e.preventDefault(); pointAt(e.clientX, e.clientY); pressRef.current = { x: 0, y: 0, timer: 0, fired: true }; return; }
    // toque longo (≥ 550 ms parado) também aponta
    const timer = window.setTimeout(() => {
      if (pressRef.current && !pressRef.current.fired) { pressRef.current.fired = true; pointAt(pressRef.current.x, pressRef.current.y); }
    }, 550);
    pressRef.current = { x: e.clientX, y: e.clientY, timer, fired: false };
  };
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pressRef.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); pressRef.current = null; }
  };
  const onCanvasClick = () => {
    const p = pressRef.current;
    pressRef.current = null;
    if (p) clearTimeout(p.timer);
    if (p?.fired) return; // foi um "apontar", não alterna play
    togglePlay();
  };
  useEffect(() => {
    if (!markerAt) return;
    const id = window.setTimeout(() => setMarkerAt(0), 3200);
    return () => clearTimeout(id);
  }, [markerAt]);
  useEffect(() => {
    if (!pointMode) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setPointMode(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pointMode]);
  const toStart = () => { setPlayhead(0); if (playing) clockRef.current = { t0: 0, wall0: performance.now() }; };
  const toggleFull = async () => {
    const el = frameRef.current?.parentElement as FsEl | null | undefined;
    if (!el) return;
    if (cssFull) { setCssFull(false); return; }
    const d = document as FsDoc;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
        return;
      }
      if (el.requestFullscreen) { await el.requestFullscreen(); return; }
      if (el.webkitRequestFullscreen) { await el.webkitRequestFullscreen(); return; }
    } catch { /* recusado: cai no modo CSS */ }
    setCssFull(true);
  };
  const seekFromBar = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setPlayhead(f * duration);
  };

  const empty = duration <= 0;
  const isVertical = projAspect === '9:16';

  return (
    <div className={`ep-pv${fullscreen ? ' is-full' : ''}${cssFull ? ' is-cssfull' : ''}`}>
      <div className="ep-pv-box" ref={boxRef}>
        <div className="ep-pv-frame" ref={frameRef} style={{ width: fit.w, height: fit.h }} data-aspect={aspect}>
          <canvas
            ref={canvasRef} className={`ep-pv-canvas${pointMode ? ' pointing' : ''}`} aria-label="Pré-visualização do vídeo"
            onClick={empty ? undefined : onCanvasClick} onPointerDown={empty ? undefined : onCanvasDown} onPointerMove={onCanvasMove}
            onPointerCancel={() => { if (pressRef.current) clearTimeout(pressRef.current.timer); pressRef.current = null; }}
            onContextMenu={(e) => { if (pressRef.current?.fired) e.preventDefault(); }}
          />
          {chatPoint && markerAt > 0 && (
            <div className="ep-pv-pin" style={{ left: `${chatPoint.x * 100}%`, top: `${chatPoint.y * 100}%` }} aria-hidden="true">
              <i /><span>{formatTime(chatPoint.t)}</span>
            </div>
          )}
          {pointMode && <div className="ep-pv-pointhint" role="status">Toque no ponto do vídeo para perguntar à IA · Esc cancela</div>}
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
              <h4>Envie um vídeo</h4>
              <p>A IA monta a 1ª edição e você ajusta pelo chat.</p>
              <label className="ep-pv-upload">
                <IcUpload size={16} /> <span>Escolher arquivos</span>
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

      {/* controles: pílula flutuante (play em círculo laranja, demais em círculos) */}
      <div className="ep-pv-controls" role="toolbar" aria-label="Reprodução">
        <button className="ep-circle sm ep-pv-c ep-pv-rew" onClick={toStart} title="Voltar ao início" aria-label="Voltar ao início" disabled={empty}><IcRewind size={16} /></button>
        <button className="ep-pv-play" onClick={togglePlay} title={playing ? 'Pausar' : 'Reproduzir'} aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={empty}>
          {playing ? <IcPause size={20} /> : <IcPlay size={20} />}
        </button>
        <div className="ep-pv-time mono"><span ref={timeRef}>{fmt(0)}</span><i>/</i><span className="tot">{fmt(duration)}</span></div>
        <div className="ep-pv-scrub" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromBar(e); }}
          onPointerMove={(e) => { if (e.buttons) seekFromBar(e); }} role="slider" aria-label="Posição"
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={0}>
          <div className="fill" ref={barRef} />
        </div>
        <div className="ep-pv-tools">
          <button className={`ep-circle sm ep-pv-c${pointMode ? ' on' : ''}`} onClick={() => setPointMode(!pointMode)} disabled={empty}
            title="Apontar um ponto do vídeo para o chat (ou Alt+clique / toque longo)" aria-label="Apontar" aria-pressed={pointMode}>
            <IcTarget size={17} />
          </button>
          <button className={`ep-circle sm ep-pv-c${safe ? ' on' : ''}`} onClick={() => setSafe(!safe)} disabled={empty}
            title="Guias de área segura (TikTok/Reels)" aria-label="Área segura" aria-pressed={safe}>
            <IcSafe size={17} />
          </button>
          <button className="ep-circle sm ep-pv-c ep-pv-exp" onClick={() => emit('ep:open-export', {})} title="Exportar" aria-label="Exportar" disabled={empty}><IcExport size={17} /></button>
          <button className="ep-circle sm ep-pv-c" onClick={toggleFull} title={fullscreen || cssFull ? 'Sair da tela cheia' : 'Tela cheia'} aria-label="Tela cheia"><IcFull size={17} /></button>
        </div>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
