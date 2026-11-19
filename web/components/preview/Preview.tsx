'use client';
/* =====================================================================
   Preview em tempo real (dono: sessão "engine").
   Canvas com o aspecto do projeto, relógio próprio em requestAnimationFrame,
   <video>/<audio> sincronizados (LiveMediaPool) e o mesmo renderFrame do export.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@/lib/store';
import { projectDuration } from '@/lib/ops';
import { assetEvents, renderFrame, segEvents } from '@/lib/engine';
import { emit, on } from '@/lib/events';
import { formatTime } from '@/lib/util';
import { LiveMediaPool } from './livePool';
import { PlaybackClock, QualityGovernor, frameInterval, stillTime } from './syncPolicy';
import { nativePlan } from './hybrid';
import { shaderKindsIn, warmShader, isWarm } from './warm';
import { prewarmIdle, prewarmCustom, customShadersIn } from '@/lib/engine/prewarm';
import { onLutsChanged, onCompareChanged } from '@/lib/color';
import { hitTest, dragPatch, type Box } from './manipulate';
import type { Clip, Project, TextClip } from '@/lib/types';
import { stripLooks, PLAY_RATES, rateLabel, loopRange, wrapLoop, stepFrame, zoomScale, VIEW_ZOOMS, zoomLabel, SAFE_ZONES, SAFE_LABELS, type ViewZoom, type SafePlatform } from './viewing';
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
  /* fundo do quadro = cor de fundo do projeto (no modo nativo as faixas do 'contain' mostram o fundo do quadro) */
  const frameBg = useEditor((s) => (s.project.canvas?.type === 'color' && s.project.canvas.color) || s.project.background || '#000');
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
  /* ferramentas de visualização */
  const [playRate, setPlayRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [zoom, setZoom] = useState<ViewZoom>('fit');
  const [grid, setGrid] = useState(false);
  const [platform, setPlatform] = useState<SafePlatform>('tiktok');
  const [viewOpen, setViewOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const viewRef = useRef({ playRate: 1, loop: false, compare: false, split: 0.5 });
  viewRef.current = { playRate, loop, compare, split };
  /** projeto "antes" (sem looks) por versão do projeto */
  const beforeRef = useRef<{ src: unknown; out: ReturnType<typeof stripLooks> | null }>({ src: null, out: null });
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
  /** raiz .ep-root (tokens de cor/tema) onde o bottom-sheet do menu ⋯ é montado */
  const [sheetHost, setSheetHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    setSheetHost((boxRef.current?.closest('.ep-root') as HTMLElement | null) ?? document.body);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [moreOpen]);
  // com o menu ⋯ aberto, a pílula flutuante da IA (position:fixed, z alto) não pode ficar por cima dele
  useEffect(() => {
    const root = document.documentElement;
    if (moreOpen) root.dataset.pvMenu = '1';
    else delete root.dataset.pvMenu;
    return () => { delete root.dataset.pvMenu; };
  }, [moreOpen]);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const chatPoint = useEditor((s) => s.chatContext?.point);
  const [markerAt, setMarkerAt] = useState(0);
  const pressRef = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null);

  if (!poolRef.current && typeof window !== 'undefined') poolRef.current = new LiveMediaPool();
  /** tamanho-base do canvas interno e fator de qualidade dinâmico (cai se a reprodução não aguentar) */
  const baseRef = useRef({ w: 0, h: 0 });
  const govRef = useRef(new QualityGovernor());
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
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
    const cmp = viewRef.current.compare;
    let plan: ReturnType<typeof nativePlan> = cmp ? ({ native: false, reason: 'antes/depois' } as const)
      : nativeAllowed() ? nativePlan(st.project, t) : ({ native: false, reason: 'desligado' } as const);
    const { w: fw, h: fh } = fitRef.current;
    const pr = pool.present(plan, t, fw, fh);
    if (pr === 'canvas') {
      // nativo sem mídia utilizável (fonte quebrada / sem url): composição completa no canvas, sem o vídeo
      plan = { native: false, reason: 'mídia indisponível' };
      pool.present(plan, t, fw, fh);
    } else if (!pr) return false; // elemento válido ainda buscando: MANTÉM o quadro atual (nunca troca por canvas sem vídeo → preto)
    // troca de qualidade pendente: redimensiona e desenha no MESMO quadro
    if (wantQRef.current !== qualityRef.current) { qualityRef.current = wantQRef.current; applySize(); }
    const ctx = cv.getContext('2d');
    if (!ctx) return true;
    const t0 = performance.now();
    try {
      renderFrame(ctx, st.project, t, pool, plan.native ? { overlayOnly: { skipTrackId: plan.track.id } } : {});
      if (cmp) {
        // antes/depois: o lado esquerdo da divisória mostra o quadro sem looks/efeitos/cor
        const b = beforeRef.current;
        if (b.src !== st.project) { b.src = st.project; b.out = stripLooks(st.project); }
        const W = cv.width, H = cv.height;
        let sc = scratchRef.current;
        if (!sc) sc = scratchRef.current = document.createElement('canvas');
        if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
        const sx = sc.getContext('2d');
        if (sx && b.out) {
          renderFrame(sx, b.out, t, pool);
          const cut = Math.round(W * Math.min(1, Math.max(0, viewRef.current.split)));
          if (cut > 0) ctx.drawImage(sc, 0, 0, cut, H, 0, 0, cut, H);
        }
      }
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
      // no fim da timeline mostra o último quadro (não tela preta)
      const tv = stillTime(st.playhead, projectDuration(st.project), st.project.fps);
      const s = poolRef.current?.sync(st.project, st.assets, tv, false, st.project.fps);
      // vídeo ainda buscando o quadro: mantém o último quadro (o 'seeked' pede outro desenho);
      // se demorar demais (mídia quebrada; 2,5 s: seek de 4K/HEVC no celular passa de 1 s), desenha assim mesmo p/ não travar a edição
      const now = performance.now();
      if (s?.pending) {
        if (!waitSinceRef.current) waitSinceRef.current = now;
        if (now - waitSinceRef.current < 2500) { showTime(st.playhead); window.setTimeout(requestStill, 120); return; }
      }
      const late = !!waitSinceRef.current && now - waitSinceRef.current >= 2500;
      // passou do limite: desenha assim mesmo (força o canvas) — antes desistia sem desenhar (r2 #3)
      if (!draw(tv) && !late) {
        if (!waitSinceRef.current) waitSinceRef.current = now;
        window.setTimeout(requestStill, 120);
        return;
      }
      waitSinceRef.current = 0;
      if (tv !== st.playhead) showTime(st.playhead); // o relógio mostra o fim de verdade
    });
  }, [draw, showTime]);

  /* pool: host oculto p/ os elementos + callback de quadro novo */
  useEffect(() => {
    (window as unknown as { __epPreviewStats?: typeof STATS }).__epPreviewStats = STATS;
    // (StrictMode monta/desmonta 2x: recria o pool se a limpeza anterior o descartou)
    const pool = poolRef.current ?? (poolRef.current = new LiveMediaPool());
    if (hostRef.current) pool.attach(hostRef.current);
    pool.onFrame = () => { if (!useEditor.getState().playing) requestStill(); };
    // vídeo que o aparelho não decodifica (HEVC/HDR sem suporte): avisa em vez de ficar preto em silêncio
    const warned = new Set<string>();
    pool.onUnplayable = (assetId) => {
      if (warned.has(assetId)) return;
      warned.add(assetId);
      const a = useEditor.getState().assets[assetId];
      const st = (a as { proxyStatus?: string } | undefined)?.proxyStatus;
      emit('ep:toast', {
        kind: 'error',
        text: st === 'pending'
          ? `Este aparelho não reproduz "${a?.name ?? 'o vídeo'}" no formato original. Gerando uma versão compatível…`
          : `Este aparelho não consegue reproduzir "${a?.name ?? 'o vídeo'}" (formato como HEVC/HDR). Grave em H.264 ("Mais compatível" na câmera) ou converta antes de enviar.`,
      });
    };
    // máscara de "remover fundo" ficou pronta: redesenha o quadro parado
    segEvents.onReady = () => { if (!useEditor.getState().playing) requestStill(); };
    // fonte/emoji da biblioteca carregou: redesenha
    assetEvents.onReady = () => { if (!useEditor.getState().playing) requestStill(); };
    // LUT importada carregou / modo de comparação da Cor mudou: redesenha
    const offLut = onLutsChanged(() => { if (!useEditor.getState().playing) requestStill(); });
    const offCmp = onCompareChanged(() => { if (!useEditor.getState().playing) requestStill(); });
    return () => { offLut(); offCmp(); pool.dispose(); poolRef.current = null; };
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
      const fitK = Math.max(0, Math.min(w / projW, h / projH));
      // zoom do quadro: 'Ajustar' cabe no palco; 100%/200% = pixels reais (o palco rola)
      const k = zoomScale(zoom, fitK, window.devicePixelRatio || 1);
      setFit({ w: Math.max(0, Math.floor(projW * k)), h: Math.max(0, Math.floor(projH * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [projW, projH, fullscreen, cssFull, zoom]);

  /* resolução interna adaptativa */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !fit.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const short = Math.min(projW, projH);
    const cssShort = Math.min(fit.w, fit.h) * dpr;
    // com zoom, a resolução interna acompanha (até 1440 no lado menor) p/ não ficar borrado
    const maxShort = zoom !== 'fit' ? 1440 : isWeakDevice() ? PREVIEW_MAX_SHORT_WEAK : PREVIEW_MAX_SHORT;
    const targetShort = Math.max(Math.min(PREVIEW_MIN_SHORT, short), Math.min(maxShort, cssShort, short));
    const k = targetShort / short;
    baseRef.current = { w: Math.round((projW * k) / 2) * 2, h: Math.round((projH * k) / 2) * 2 };
    applySize();
    requestStill();
  }, [fit.w, fit.h, projW, projH, requestStill, applySize, zoom]);

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
    if (viewRef.current.loop) {
      const r = loopRange(st0.project, st0.selection);
      if (start < r.start || start >= r.end - 1 / 30) start = r.start;
    }
    const clock = clockRef.current;
    clock.rate = viewRef.current.playRate;
    clock.reset(start, performance.now());
    lastSetRef.current = start;
    if (start !== st0.playhead) setPlayhead(start);
    govRef.current.reset();
    let raf = 0;
    let lastDraw = -Infinity;
    let holdSince = 0;
    let lead: ReturnType<LiveMediaPool['sync']>['lead'] = null;
    const tick = () => {
      const st = useEditor.getState();
      if (!st.playing) return;
      const d = projectDuration(st.project);
      const now = performance.now();
      clock.rate = viewRef.current.playRate;
      let t = clock.tick(now, lead);
      // repetir: volta ao início do trecho (clipe selecionado ou vídeo inteiro)
      if (viewRef.current.loop) {
        const w = wrapLoop(t, loopRange(st.project, st.selection));
        if (w.wrapped) { t = w.t; clock.reset(t, now); lead = null; }
      }
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
      // a próxima transição em shader (até 1,5 s): compila agora, não no meio dela
      for (const k of shaderKindsIn(st.project, t, t + 1.5)) if (!isWarm(k)) { warmShader(k); break; }
      // shaders 'custom' (GLSL da IA) dos próximos 1,5 s também
      for (const x of customShadersIn(st.project, t, t + 1.5)) if (!prewarmCustom(x.code, x.stage)) break;
      const s = pool.sync(st.project, st.assets, t, true, st.project.fps, viewRef.current.playRate);
      lead = s.lead;
      // falta o quadro do vídeo (corte/seek ainda decodificando): mantém o último quadro bom
      // rede de segurança na reprodução: um vídeo que não entrega quadro não congela o canvas inteiro
      // (textos/legendas/PiP) por mais de 1,5 s (r2 #1/#2)
      const lateP = holdSince > 0 && now - holdSince > 1500;
      if ((s.pending && !lateP) || !draw(t)) { if (!holdSince) holdSince = now; STATS.held++; showTime(t); }
      else holdSince = 0;
      lastSetRef.current = t;
      st.setPlayhead(t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, setPlaying, setPlayhead, applySize, requestStill, showTime]);

  /* ---------- eventos / tela cheia ---------- */
  useEffect(() => on('ep:open-export', (d) => { setPlaying(false); setExportInit(d ?? {}); setExportOpen(true); }), [setPlaying]);
  useEffect(() => { requestStill(); }, [compare, split, requestStill]);
  /* compila no ócio os shaders (a 1ª compilação trava a página): os do projeto e, depois, o catálogo
     inteiro de transições/efeitos — aplicar um item novo já encontra o shader pronto */
  const projForWarm = useEditor((s) => s.project);
  useEffect(() => {
    if (playing) return;
    let cancelWarm = () => {};
    const id = window.setTimeout(() => {
      cancelWarm = prewarmIdle(projForWarm, { catalog: true, isBusy: () => useEditor.getState().playing });
    }, 600);
    return () => { clearTimeout(id); cancelWarm(); };
  }, [projForWarm, playing]);
  /* fecha o popover "Visualização" ao tocar fora */
  useEffect(() => {
    if (!viewOpen) return;
    const h = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.('.ep-pv-viewwrap')) setViewOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewOpen(false); };
    document.addEventListener('pointerdown', h, true);
    window.addEventListener('keydown', k);
    return () => { document.removeEventListener('pointerdown', h, true); window.removeEventListener('keydown', k); };
  }, [viewOpen]);
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
    // a cada gesto (não só o 1º): no iOS cada elemento novo precisa de um play dentro de um gesto (r2 #4)
    const h = () => unlock();
    // no toque, pointerdown NÃO libera mídia (Chrome/iOS só contam pointerup/touchend/click como gesto)
    const evs = ['pointerdown', 'pointerup', 'click', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, h, true));
    return () => evs.forEach((e) => window.removeEventListener(e, h, true));
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

  const togglePlay = () => { unlock(); poolRef.current?.resumeAudio(); setPlaying(!useEditor.getState().playing); };

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
  /* ---------- arrastar texto/sticker/forma/PiP no quadro (guias de encaixe, 1 desfazer) ---------- */
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const measure = (txt: string, px: number, clip: TextClip) => {
    const m = measureRef.current ?? (measureRef.current = document.createElement('canvas').getContext('2d'));
    if (!m) return txt.length * px * 0.55;
    m.font = `${clip.style.italic ? 'italic ' : ''}${clip.style.fontWeight || 700} ${px}px "${clip.style.fontFamily}", sans-serif`;
    return m.measureText(txt).width;
  };
  const dragRef = useRef<{ clip: Clip; before: Project; start: { x: number; y: number }; px: number; py: number; box: Box; started: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null; box: Box | null }>({ x: null, y: null, box: null });
  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointMode || e.altKey) { e.preventDefault(); pointAt(e.clientX, e.clientY); pressRef.current = { x: 0, y: 0, timer: 0, fired: true }; return; }
    // camada sob o dedo: seleciona (timeline/painéis acompanham) e prepara o arraste
    const r = e.currentTarget.getBoundingClientRect();
    const st = useEditor.getState();
    const hit = r.width > 0 ? hitTest(st.project, st.playhead, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, st.project.width, st.project.height, measure, 22 * (st.project.width / r.width)) : null;
    dragRef.current = null;
    if (hit) {
      if (st.selection.length !== 1 || st.selection[0] !== hit.clip.id) st.select([hit.clip.id]);
      dragRef.current = { clip: hit.clip, before: st.project, start: { x: hit.box.cx, y: hit.box.cy }, px: e.clientX, py: e.clientY, box: hit.box, started: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    }
    // toque longo (≥ 550 ms parado) também aponta
    const timer = window.setTimeout(() => {
      if (pressRef.current && !pressRef.current.fired) { pressRef.current.fired = true; pointAt(pressRef.current.x, pressRef.current.y); }
    }, 550);
    pressRef.current = { x: e.clientX, y: e.clientY, timer, fired: false };
  };
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pressRef.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); pressRef.current = null; }
    const d = dragRef.current;
    if (!d || !(e.buttons & 1) && e.pointerType === 'mouse') return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.px, e.clientY - d.py) < 4) return;
      d.started = true;
      suppressClickRef.current = true;
      if (p) { clearTimeout(p.timer); pressRef.current = null; }
      const st = useEditor.getState();
      if (st.playing) st.setPlaying(false);
    }
    const r = e.currentTarget.getBoundingClientRect();
    const res = dragPatch(d.clip, d.start, (e.clientX - d.px) / r.width, (e.clientY - d.py) / r.height,
      safe && isVertical ? SAFE_ZONES[platform] : undefined, !e.shiftKey);
    useEditor.getState().dispatch({ op: 'update_clip', clipId: d.clip.id, patch: res.patch } as never, { history: false });
    setGuides({ x: res.guideX, y: res.guideY, box: { ...d.box, cx: res.center.x, cy: res.center.y } });
  };
  const onCanvasUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.started) {
      // o arraste inteiro vira UM passo de desfazer
      useEditor.setState((s) => (s.project === d.before ? {} : { past: [...s.past, d.before].slice(-100), future: [] }));
      setGuides({ x: null, y: null, box: null });
    }
  };
  const onCanvasClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; } // foi um arraste
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
  /** quadro a quadro (pausa a reprodução) */
  const step = (dir: 1 | -1) => {
    const st = useEditor.getState();
    if (st.playing) st.setPlaying(false);
    st.setPlayhead(stepFrame(st.playhead, st.project.fps || 30, dir, projectDuration(st.project)));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ',') { e.preventDefault(); step(-1); }
      else if (e.key === '.') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
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
  const loopLabel = useEditor((s) => loopRange(s.project, s.selection).label);

  /** itens de "Visualização" (mesmos no popover do desktop e no menu ⋯ do celular) */
  const viewItems = (
    <div className="ep-pv-view" role="group" aria-label="Visualização">
      <div className="row"><span>Velocidade</span>
        <div className="chips" role="radiogroup" aria-label="Velocidade de reprodução">
          {PLAY_RATES.map((r) => <button key={r} role="radio" aria-checked={playRate === r} className={playRate === r ? 'on' : ''} onClick={() => setPlayRate(r)}>{rateLabel(r)}</button>)}
        </div>
      </div>
      <div className="row"><span>Zoom</span>
        <div className="chips" role="radiogroup" aria-label="Zoom do quadro">
          {VIEW_ZOOMS.map((z) => <button key={String(z)} role="radio" aria-checked={zoom === z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{zoomLabel(z)}</button>)}
        </div>
      </div>
      <button role="menuitemcheckbox" aria-checked={loop} className={`tog${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)}>
        <Icon name="loop" size={18} /> Repetir <small>{loopLabel}</small>
      </button>
      <button role="menuitemcheckbox" aria-checked={compare} className={`tog${compare ? ' on' : ''}`} onClick={() => setCompare(!compare)}>
        <Icon name="flip" size={18} /> Antes / depois <small>arraste a divisória</small>
      </button>
      <button role="menuitemcheckbox" aria-checked={grid} className={`tog${grid ? ' on' : ''}`} onClick={() => setGrid(!grid)}>
        <Icon name="grid" size={18} /> Grade de terços
      </button>
      <button role="menuitemcheckbox" aria-checked={safe} className={`tog${safe ? ' on' : ''}`} onClick={() => setSafe(!safe)}>
        <Icon name="safearea" size={18} /> Zonas seguras
      </button>
      {safe && isVertical && (
        <div className="row sub"><span>Plataforma</span>
          <div className="chips" role="radiogroup" aria-label="Plataforma">
            {(Object.keys(SAFE_LABELS) as SafePlatform[]).map((k) => <button key={k} role="radio" aria-checked={platform === k} className={platform === k ? 'on' : ''} onClick={() => setPlatform(k)}>{SAFE_LABELS[k]}</button>)}
          </div>
        </div>
      )}
      <button role="menuitemcheckbox" aria-checked={perf} className={`tog${perf ? ' on' : ''}`} onClick={() => setPerf(!perf)}>
        <Icon name="beats" size={18} /> Mostrar desempenho
      </button>
    </div>
  );
  const sz = SAFE_ZONES[platform];

  return (
    <div className={`ep-pv${fullscreen ? ' is-full' : ''}${cssFull ? ' is-cssfull' : ''}`}>
      <div className={`ep-pv-box${zoom !== 'fit' ? ' zoomed' : ''}`} ref={boxRef}>
        <div className="ep-pv-frame" ref={frameRef} style={{ width: fit.w, height: fit.h, background: frameBg }} data-aspect={aspect}>
          <div ref={hostRef} className="ep-pv-host" aria-hidden="true" />
          <canvas
            ref={canvasRef} data-ep-preview="" className={`ep-pv-canvas${pointMode ? ' pointing' : ''}`} aria-label="Pré-visualização do vídeo"
            onClick={empty ? undefined : onCanvasClick} onPointerDown={empty ? undefined : onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp}
            onPointerCancel={() => { if (pressRef.current) clearTimeout(pressRef.current.timer); pressRef.current = null; onCanvasUp(); }}
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
          {compare && !empty && (
            <div className="ep-pv-split" style={{ left: `${split * 100}%` }}
              onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const r = frameRef.current?.getBoundingClientRect();
                if (r) setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
              }}
              role="slider" aria-label="Divisória antes/depois" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'ArrowLeft') setSplit((v) => Math.max(0, v - 0.05)); if (e.key === 'ArrowRight') setSplit((v) => Math.min(1, v + 0.05)); }}>
              <i /><b><Icon name="prev" size={13} /><Icon name="next" size={13} /></b>
              <span className="l">Antes</span><span className="r">Depois</span>
            </div>
          )}
          {(guides.x !== null || guides.y !== null || guides.box) && (
            <div className="ep-pv-guides" aria-hidden="true">
              {guides.x !== null && <i className="gx" style={{ left: `${guides.x * 100}%` }} />}
              {guides.y !== null && <i className="gy" style={{ top: `${guides.y * 100}%` }} />}
              {guides.box && <b style={{ left: `${(guides.box.cx - guides.box.w / 2) * 100}%`, top: `${(guides.box.cy - guides.box.h / 2) * 100}%`, width: `${guides.box.w * 100}%`, height: `${guides.box.h * 100}%` }} />}
            </div>
          )}
          {grid && !empty && <div className="ep-pv-grid" aria-hidden="true"><i /><i /><i /><i /></div>}
          {safe && !empty && (
            <div className={`ep-pv-safe${isVertical ? ' vertical' : ''}`} aria-hidden="true">
              {isVertical ? (
                <>
                  <div className="z top" style={{ height: `${sz.top * 100}%` }}><span>{SAFE_LABELS[platform]} · barra</span></div>
                  <div className="z bottom" style={{ height: `${sz.bottom * 100}%` }}><span>Legenda/@perfil</span></div>
                  <div className="z right" style={{ top: `${sz.top * 100}%`, bottom: `${sz.bottom * 100}%`, width: `${sz.right * 100}%` }}><span>Botões</span></div>
                  <div className="area" style={{ left: `${sz.left * 100}%`, right: `${sz.right * 100}%`, top: `${sz.top * 100}%`, bottom: `${sz.bottom * 100}%` }} />
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
              <button className={`ep-pv-mbtn${moreOpen || pointMode || safe || grid || loop || compare || zoom !== 'fit' || playRate !== 1 ? ' on' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-label="Mais opções" aria-expanded={moreOpen}><Icon name="more" size={22} /></button>
              {moreOpen && sheetHost && createPortal(
                // bottom-sheet fixo (portal na raiz .ep-root): nunca sai da tela nem fica sob a pílula da IA
                <div className="ep-pv-sheetbg" onPointerDown={(e) => { if (e.target === e.currentTarget) setMoreOpen(false); }}>
                  <div className="ep-pv-menu ep-pv-sheet" role="menu" aria-label="Opções do preview">
                    <div className="ep-pv-sheethd"><b>Opções do preview</b>
                      <button className="ep-circle sm" onClick={() => setMoreOpen(false)} aria-label="Fechar"><Icon name="close" size={16} /></button>
                    </div>
                    <button role="menuitemcheckbox" aria-checked={pointMode} className={pointMode ? 'on' : ''} onClick={() => { setPointMode(!pointMode); setMoreOpen(false); }}>
                      <Icon name="point" size={18} /> Apontar no vídeo <small>ou toque longo</small>
                    </button>
                    {viewItems}
                  </div>
                </div>,
                sheetHost,
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
        <button className="ep-circle sm ep-pv-c" onClick={() => step(-1)} title="Quadro anterior ( , )" aria-label="Quadro anterior" disabled={empty}><Icon name="prev" size={16}/></button>
        <button className="ep-pv-play" onClick={togglePlay} title={playing ? 'Pausar' : 'Reproduzir'} aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={empty}>
          {playing ? <Icon name="pause" size={20}/> : <Icon name="play" size={20}/>}
        </button>
        <button className="ep-circle sm ep-pv-c" onClick={() => step(1)} title="Próximo quadro ( . )" aria-label="Próximo quadro" disabled={empty}><Icon name="next" size={16}/></button>
        {playRate !== 1 && <span className="ep-pv-rate mono" title="Velocidade de reprodução">{rateLabel(playRate)}</span>}
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
          <div className="ep-pv-viewwrap">
            <button className={`ep-circle sm ep-pv-c${viewOpen || safe || grid || loop || compare || zoom !== 'fit' || playRate !== 1 ? ' on' : ''}`} onClick={() => setViewOpen(!viewOpen)} disabled={empty}
              title="Visualização: velocidade, repetir, zoom, grade, zonas seguras" aria-label="Visualização" aria-expanded={viewOpen}>
              <Icon name="layers" size={17}/>
            </button>
            {viewOpen && <div className="ep-pv-pop" role="menu">{viewItems}</div>}
          </div>
          <button className="ep-circle sm ep-pv-c ep-pv-exp" onClick={() => emit('ep:open-export', {})} title="Exportar" aria-label="Exportar" disabled={empty}><Icon name="export" size={17}/></button>
          <button className="ep-circle sm ep-pv-c" onClick={toggleFull} title={fullscreen || cssFull ? 'Sair da tela cheia' : 'Tela cheia'} aria-label="Tela cheia"><Icon name="fullscreen" size={17}/></button>
        </div>
      </div>
      )}
      {exportOpen && <ExportDialog initial={exportInit} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
