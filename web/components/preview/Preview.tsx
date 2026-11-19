'use client';
/* =====================================================================
   Preview em tempo real (dono: sessão "engine").
   Canvas com o aspecto do projeto, relógio próprio em requestAnimationFrame,
   <video>/<audio> sincronizados (LiveMediaPool) e o mesmo renderFrame do export.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';
import { assetEvents, renderFrame, segEvents } from '@/lib/engine';
import { emit, on } from '@/lib/events';
import { formatTime } from '@/lib/util';
import { LiveMediaPool } from './livePool';
import { PlaybackClock, QualityGovernor, frameInterval } from './syncPolicy';
import { nativePlan } from './hybrid';
import PerfHud, { type PreviewStats } from './PerfHud';
import ExportDialog from './ExportDialog';
import Icon from '@/components/ui/Icon';

/** lado menor máximo do canvas interno do preview (o export usa a resolução cheia) */
const PREVIEW_MAX_SHORT = 720;
const PREVIEW_MAX_SHORT_WEAK = 540;
const PREVIEW_MIN_SHORT = 360;

/** métricas do preview (lidas pelos testes de desempenho em window.__epPreviewStats) */
const STATS: PreviewStats = { draws: 0, held: 0, costEma: 0, quality: 1, width: 0, mode: 'canvas', reason: '' };

/** modo nativo ligado? (localStorage ep:pv-native = '0' força a composição total, p/ comparar) */
function nativeAllowed(): boolean {
  try { return localStorage.getItem('ep:pv-native') !== '0'; } catch { return true; }
}

/** aparelho modesto (poucos núcleos / pouca memória): resolução interna menor */
function isWeakDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  // (toque sozinho não é "fraco": celular bom como Pixel 7/iPhone recente aguenta 720p no GPU)
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
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
  const clockRef = useRef(new PlaybackClock());
  const pendingRef = useRef(0);

  const [fit, setFit] = useState({ w: 0, h: 0 });
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [safe, setSafe] = useState(false);
  /* "Mostrar desempenho" (lembrado no aparelho) */
  const [perf, setPerfState] = useState(false);
  useEffect(() => { try { setPerfState(localStorage.getItem('ep:pv-perf') === '1'); } catch { /* sem storage */ } }, []);
  const setPerf = (v: boolean) => { setPerfState(v); try { localStorage.setItem('ep:pv-perf', v ? '1' : '0'); } catch { /* sem storage */ } };
  const [exportOpen, setExportOpen] = useState(false);
  /** valores iniciais vindos do shell (pílula "1080p ▾" do celular) */
  const [exportInit, setExportInit] = useState<{ quality?: 'draft' | 'hd' | 'fhd' | '4k' | 'full'; fps?: number }>({});
  /* brilho sutil no quadro quando a IA aplica uma op ao vivo */
  const liveApplied = useEditor((s) => (s.live.running ? s.live.done : 0));
  const [glow, setGlow] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  /** "tela cheia" por CSS (iPhone não tem Fullscreen API para elementos que não são <video>) */
  const [cssFull, setCssFull] = useState(false);
  /* "apontar para qualquer coisa": marca um ponto do quadro como contexto do chat */
  const [pointMode, setPointMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const chatPoint = useEditor((s) => s.chatContext?.point);
  const [markerAt, setMarkerAt] = useState(0);
  const pressRef = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null);

  if (!poolRef.current && typeof window !== 'undefined') poolRef.current = new LiveMediaPool();
  /** tamanho-base do canvas interno e fator de qualidade dinâmico (cai se a reprodução não aguentar) */
  const baseRef = useRef({ w: 0, h: 0 });
  const govRef = useRef(new QualityGovernor());
  /** fator de qualidade a aplicar no próximo quadro desenhado (troca + desenho no mesmo quadro: sem piscar) */
  const wantQRef = useRef(1);
  const qualityRef = useRef(1);
  /** desde quando falta quadro de vídeo (ms) — o preview mantém o último quadro bom */
  const waitSinceRef = useRef(0);

  /**
   * Ajusta o tamanho interno do canvas. Redimensionar ZERA o conteúdo; por isso o
   * quadro atual é copiado e redesenhado escalado na hora (nunca fica preto).
   */
  const applySize = useCallback(() => {
    const cv = canvasRef.current;
    const { w: bw, h: bh } = baseRef.current;
    if (!cv || !bw) return false;
    const q = qualityRef.current;
    const w = Math.max(2, Math.round((bw * q) / 2) * 2);
    const h = Math.max(2, Math.round((bh * q) / 2) * 2);
    if (cv.width === w && cv.height === h) return false;
    let keep: HTMLCanvasElement | null = null;
    if (cv.width > 2 && cv.height > 2) {
      keep = document.createElement('canvas');
      keep.width = cv.width;
      keep.height = cv.height;
      keep.getContext('2d')?.drawImage(cv, 0, 0);
    }
    cv.width = w;
    cv.height = h;
    if (keep) cv.getContext('2d')?.drawImage(keep, 0, 0, w, h);
    return true;
  }, []);

  const showTime = useCallback((t: number) => {
    const d = projectDuration(useEditor.getState().project);
    if (timeRef.current) timeRef.current.textContent = fmt(t);
    if (barRef.current) barRef.current.style.transform = `scaleX(${d > 0 ? Math.min(1, t / d) : 0})`;
  }, []);

  /* ---------- desenho ---------- */
  /** desenha o quadro t; false = vídeo nativo ainda sem quadro (mantém o que está na tela) */
  const draw = useCallback((t: number): boolean => {
    const cv = canvasRef.current;
    const pool = poolRef.current;
    if (!cv || !pool) return true;
    const st = useEditor.getState();
    // modo híbrido: <video> nativo como base + canvas transparente por cima (ou composição total)
    const plan = nativeAllowed() ? nativePlan(st.project, t) : ({ native: false, reason: 'desligado' } as const);
    const { w: fw, h: fh } = fitRef.current;
    if (!pool.present(plan, t, fw, fh)) return false;
    // troca de qualidade pendente: redimensiona e desenha no MESMO quadro
    if (wantQRef.current !== qualityRef.current) { qualityRef.current = wantQRef.current; applySize(); }
    const ctx = cv.getContext('2d');
    if (!ctx) return true;
    const t0 = performance.now();
    try {
      renderFrame(ctx, st.project, t, pool, plan.native ? { overlayOnly: { skipTrackId: plan.track.id } } : {});
    } catch (e) {
      console.error('[preview] falha ao desenhar', e);
    }
    STATS.mode = plan.native ? 'nativo' : 'canvas';
    STATS.reason = plan.native ? '' : plan.reason;
    // qualidade adaptativa (só na reprodução), em degraus com histerese — não fica alternando
    const cost = performance.now() - t0;
    STATS.draws++;
    STATS.costEma = STATS.costEma ? STATS.costEma * 0.9 + cost * 0.1 : cost;
    STATS.quality = qualityRef.current;
    STATS.width = cv.width;
    if (st.playing) {
      const q = govRef.current.push(cost, performance.now());
      if (q !== null) wantQRef.current = q;
    }
    showTime(t);
    return true;
  }, [applySize, showTime]);

  /** re-render quando pausado (agrupa pedidos num único rAF) */
  const requestStill = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = requestAnimationFrame(() => {
      pendingRef.current = 0;
      const st = useEditor.getState();
      if (st.playing) return;
      const s = poolRef.current?.sync(st.project, st.assets, st.playhead, false, st.project.fps);
      // vídeo ainda buscando o quadro: mantém o último quadro (o 'seeked' pede outro desenho);
      // se demorar demais (mídia quebrada), desenha assim mesmo p/ não travar a edição
      const now = performance.now();
      if (s?.pending) {
        if (!waitSinceRef.current) waitSinceRef.current = now;
        if (now - waitSinceRef.current < 900) { showTime(st.playhead); window.setTimeout(requestStill, 120); return; }
      }
      if (!draw(st.playhead) && now - (waitSinceRef.current || now) < 900) {
        if (!waitSinceRef.current) waitSinceRef.current = now;
        window.setTimeout(requestStill, 120);
        return;
      }
      waitSinceRef.current = 0;
    });
  }, [draw, showTime]);

  /* pool: host oculto p/ os elementos + callback de quadro novo */
  useEffect(() => {
    (window as unknown as { __epPreviewStats?: typeof STATS }).__epPreviewStats = STATS;
    // (StrictMode monta/desmonta 2x: recria o pool se a limpeza anterior o descartou)
    const pool = poolRef.current ?? (poolRef.current = new LiveMediaPool());
    if (hostRef.current) pool.attach(hostRef.current);
    pool.onFrame = () => { if (!useEditor.getState().playing) requestStill(); };
    // máscara de "remover fundo" ficou pronta: redesenha o quadro parado
    segEvents.onReady = () => { if (!useEditor.getState().playing) requestStill(); };
    // fonte/emoji da biblioteca carregou: redesenha
    assetEvents.onReady = () => { if (!useEditor.getState().playing) requestStill(); };
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
    applySize();
    requestStill();
  }, [fit.w, fit.h, projW, projH, requestStill, applySize]);

  /* ---------- pausado: re-renderiza ao mudar playhead/projeto/mídia ---------- */
  useEffect(() => {
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.playing) {
        // seek externo durante a reprodução (ex.: clique na régua): reposiciona o relógio
        if (s.playhead !== prev.playhead && Math.abs(s.playhead - lastSetRef.current) > 0.05) {
          clockRef.current.reset(s.playhead, performance.now());
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

  /* ---------- reprodução: relógio que segue o vídeo principal ---------- */
  useEffect(() => {
    const pool = poolRef.current;
    if (!playing || !pool) {
      pool?.pauseAll();
      // parado: volta à qualidade cheia para o quadro estático
      govRef.current.reset();
      if (wantQRef.current < 1 || qualityRef.current < 1) { wantQRef.current = 1; qualityRef.current = 1; if (applySize()) requestStill(); }
      return;
    }
    const st0 = useEditor.getState();
    const d0 = projectDuration(st0.project);
    if (d0 <= 0) { setPlaying(false); return; }
    let start = st0.playhead;
    if (start >= d0 - 1 / 30) start = 0;
    const clock = clockRef.current;
    clock.reset(start, performance.now());
    lastSetRef.current = start;
    if (start !== st0.playhead) setPlayhead(start);
    govRef.current.reset();
    let raf = 0;
    let lastDraw = -Infinity;
    let lead: ReturnType<LiveMediaPool['sync']>['lead'] = null;
    const tick = () => {
      const st = useEditor.getState();
      if (!st.playing) return;
      const d = projectDuration(st.project);
      const now = performance.now();
      const t = clock.tick(now, lead);
      if (t >= d) {
        pool.pauseAll();
        lastSetRef.current = d;
        st.setPlayhead(d);
        st.setPlaying(false);
        draw(Math.max(0, d - 1 / (st.project.fps || 30)));
        return;
      }
      raf = requestAnimationFrame(tick);
      // ritmo: desenha no fps do projeto (tela de 90/120 Hz não precisa redesenhar o mesmo quadro 3–4x)
      if (now - lastDraw < frameInterval(st.project.fps)) return;
      lastDraw = now;
      const s = pool.sync(st.project, st.assets, t, true, st.project.fps);
      lead = s.lead;
      // falta o quadro do vídeo (corte/seek ainda decodificando): mantém o último quadro bom
      if (s.pending || !draw(t)) { STATS.held++; showTime(t); }
      lastSetRef.current = t;
      st.setPlayhead(t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, setPlaying, setPlayhead, applySize, requestStill, showTime]);

  /* ---------- eventos / tela cheia ---------- */
  useEffect(() => on('ep:open-export', (d) => { setPlaying(false); setExportInit(d ?? {}); setExportOpen(true); }), [setPlaying]);
  const glowTimer = useRef(0);
  useEffect(() => {
    if (!liveApplied) return;
    // op aplicada: brilho de 700 ms (reinicia a animação a cada op)
    setGlow((g) => g + 1);
    clearTimeout(glowTimer.current);
    glowTimer.current = window.setTimeout(() => setGlow(0), 700);
  }, [liveApplied]);
  useEffect(() => () => clearTimeout(glowTimer.current), []);
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
  const toStart = () => { setPlayhead(0); if (playing) clockRef.current.reset(0, performance.now()); };
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
          <div ref={hostRef} className="ep-pv-host" aria-hidden="true" />
          <canvas
            ref={canvasRef} data-ep-preview="" className={`ep-pv-canvas${pointMode ? ' pointing' : ''}`} aria-label="Pré-visualização do vídeo"
            onClick={empty ? undefined : onCanvasClick} onPointerDown={empty ? undefined : onCanvasDown} onPointerMove={onCanvasMove}
            onPointerCancel={() => { if (pressRef.current) clearTimeout(pressRef.current.timer); pressRef.current = null; }}
            onContextMenu={(e) => { if (pressRef.current?.fired) e.preventDefault(); }}
          />
          {glow > 0 && <i className="ep-pv-glow" key={glow} aria-hidden="true" />}
          {perf && !empty && <PerfHud stats={STATS} pool={poolRef.current} canvas={canvasRef.current} />}
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
              <Icon name="ai" size={13}/>
              <b>IA editando…</b>
              {liveTotal > 0 && <span className="n mono">{Math.min(liveDone + 1, liveTotal)}/{liveTotal}</span>}
              {liveText && <span className="txt">{liveText}</span>}
            </div>
          )}
          {empty && (
            <div className="ep-pv-empty">
              <div className="ic"><Icon name="upload" size={24} /></div>
              <h4>Envie um vídeo</h4>
              <p>ou descreva no chat</p>
              <label className="ep-pv-upload">
                <span>Escolher arquivo</span>
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
      </div>

      {/* controles: pílula flutuante (play em círculo laranja, demais em círculos) */}
      {/* celular (≤899px): faixa simples sob o vídeo — tela cheia/⋯ · play · desfazer/refazer */}
      {!empty && (
        <div className="ep-pv-mbar" role="toolbar" aria-label="Reprodução">
          <div className="side">
            <button className="ep-pv-mbtn" onClick={toggleFull} aria-label="Tela cheia" title="Tela cheia"><Icon name="fullscreen" size={22} /></button>
            <div className="ep-pv-more">
              <button className={`ep-pv-mbtn${moreOpen || pointMode || safe ? ' on' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-label="Mais opções" aria-expanded={moreOpen}><Icon name="more" size={22} /></button>
              {moreOpen && (
                <div className="ep-pv-menu" role="menu">
                  <button role="menuitemcheckbox" aria-checked={pointMode} className={pointMode ? 'on' : ''} onClick={() => { setPointMode(!pointMode); setMoreOpen(false); }}>
                    <Icon name="point" size={18} /> Apontar no vídeo <small>ou toque longo</small>
                  </button>
                  <button role="menuitemcheckbox" aria-checked={safe} className={safe ? 'on' : ''} onClick={() => { setSafe(!safe); setMoreOpen(false); }}>
                    <Icon name="safearea" size={18} /> Área segura
                  </button>
                  <button role="menuitemcheckbox" aria-checked={perf} className={perf ? 'on' : ''} onClick={() => { setPerf(!perf); setMoreOpen(false); }}>
                    <Icon name="beats" size={18} /> Mostrar desempenho
                  </button>
                </div>
              )}
            </div>
          </div>
          <button className="ep-pv-mplay" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <div className="side right">
            <button className="ep-pv-mbtn" onClick={() => useEditor.getState().undo()} disabled={!canUndo} aria-label="Desfazer" title="Desfazer"><Icon name="undo" size={22} /></button>
            <button className="ep-pv-mbtn" onClick={() => useEditor.getState().redo()} disabled={!canRedo} aria-label="Refazer" title="Refazer"><Icon name="redo" size={22} /></button>
          </div>
        </div>
      )}
      {!empty && (
      <div className="ep-pv-controls" role="toolbar" aria-label="Reprodução">
        <button className="ep-circle sm ep-pv-c ep-pv-rew" onClick={toStart} title="Voltar ao início" aria-label="Voltar ao início" disabled={empty}><Icon name="back" size={16}/></button>
        <button className="ep-pv-play" onClick={togglePlay} title={playing ? 'Pausar' : 'Reproduzir'} aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={empty}>
          {playing ? <Icon name="pause" size={20}/> : <Icon name="play" size={20}/>}
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
            <Icon name="point" size={17}/>
          </button>
          <button className={`ep-circle sm ep-pv-c${safe ? ' on' : ''}`} onClick={() => setSafe(!safe)} disabled={empty}
            title="Guias de área segura (TikTok/Reels)" aria-label="Área segura" aria-pressed={safe}>
            <Icon name="safearea" size={17}/>
          </button>
          <button className={`ep-circle sm ep-pv-c${perf ? ' on' : ''}`} onClick={() => setPerf(!perf)}
            title="Mostrar desempenho (fps, modo, fonte)" aria-label="Mostrar desempenho" aria-pressed={perf}>
            <Icon name="beats" size={17}/>
          </button>
          <button className="ep-circle sm ep-pv-c ep-pv-exp" onClick={() => emit('ep:open-export', {})} title="Exportar" aria-label="Exportar" disabled={empty}><Icon name="export" size={17}/></button>
          <button className="ep-circle sm ep-pv-c" onClick={toggleFull} title={fullscreen || cssFull ? 'Sair da tela cheia' : 'Tela cheia'} aria-label="Tela cheia"><Icon name="fullscreen" size={17}/></button>
        </div>
      </div>
      )}
      {exportOpen && <ExportDialog initial={exportInit} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
