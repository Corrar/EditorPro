/* =====================================================================
   Amostragem de quadros no NAVEGADOR (Chrome, Firefox, Safari iOS/macOS):
   - <video muted playsInline> + seek + 'seeked' + canvas
   - JPEG via canvas.toBlob (fallback toDataURL), limitado por orçamento de bytes
   - diferenças entre quadros minúsculos (48x27) para detectar cortes de cena
   Partes puras (planejamento, orçamento) exportadas e testadas.
   ===================================================================== */

export interface Frame { t: number; data: string; mediaType: 'image/jpeg'; /** (modelo) o que o quadro mostra: "antes do corte", "faixa da legenda"… */ label?: string }
/** cor média do vídeo (0..1) */
export interface ColorStats { r: number; g: number; b: number; sat: number; lum: number; /** desvio-padrão da luminância (contraste) */ lumSd?: number }

export interface DeviceProfile { mobile: boolean; weak: boolean; memoryGB?: number; cores?: number }

/** perfil do aparelho (sem APIs só-Chrome obrigatórias: deviceMemory é opcional) */
export function deviceProfile(): DeviceProfile {
  if (typeof navigator === 'undefined') return { mobile: false, weak: false };
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const ua = nav.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1; // iPadOS se apresenta como Mac
  const mobile = !!nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touchMac;
  const memoryGB = nav.deviceMemory;
  const cores = nav.hardwareConcurrency;
  const weak = (memoryGB !== undefined && memoryGB <= 3) || (cores !== undefined && cores <= 4 && mobile);
  return { mobile, weak, memoryGB, cores };
}

export interface SamplePlan {
  /** instantes p/ diferença entre quadros (detecção de corte) */
  diffTimes: number[];
  /** subconjunto (índices em diffTimes) que também vira JPEG */
  jpegIdx: Set<number>;
}

/** planeja os instantes amostrados: diffs a cada `diffStep`, ~1 JPEG por `frameEvery` s, no máx. `maxFrames` */
export function planSamples(duration: number, opts: { diffStep: number; frameEvery: number; maxFrames: number; maxDiffs?: number }): SamplePlan {
  const D = Math.max(0, duration);
  if (!D) return { diffTimes: [], jpegIdx: new Set() };
  const maxDiffs = opts.maxDiffs ?? 400;
  const step = Math.max(opts.diffStep, D / maxDiffs);
  const diffTimes: number[] = [];
  for (let t = Math.min(0.05, D / 2); t < D - 0.02; t += step) diffTimes.push(Math.round(t * 1000) / 1000);
  const nJpeg = Math.max(1, Math.min(opts.maxFrames, Math.round(D / opts.frameEvery)));
  const jpegIdx = new Set<number>();
  for (let k = 0; k < nJpeg; k++) {
    const target = ((k + 0.5) * D) / nJpeg;
    let best = 0;
    for (let i = 1; i < diffTimes.length; i++) if (Math.abs(diffTimes[i] - target) < Math.abs(diffTimes[best] - target)) best = i;
    jpegIdx.add(best);
  }
  return { diffTimes, jpegIdx };
}

/** reduz a lista para caber no orçamento de bytes (mantém distribuição uniforme) */
export function fitBudget<T extends { data: string }>(frames: T[], budgetBytes: number): T[] {
  let list = frames;
  const size = (l: T[]) => l.reduce((n, f) => n + f.data.length, 0);
  while (list.length > 1 && size(list) > budgetBytes) list = list.filter((_, i) => i % 2 === 0);
  return list;
}

function waitEvent(el: HTMLMediaElement, ev: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(ev, onOk);
      el.removeEventListener('error', onErr);
      if (ok) resolve();
      else reject(new Error(`vídeo: ${ev} falhou`));
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(ev, onOk);
    el.addEventListener('error', onErr);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function canvasJpeg(c: HTMLCanvasElement, quality: number): Promise<string> {
  if (c.toBlob) {
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality));
    if (blob) return blobToBase64(blob);
  }
  return c.toDataURL('image/jpeg', quality).replace(/^data:[^;]+;base64,/, '');
}

export interface SampleOptions {
  maxFrames?: number;
  frameEvery?: number;
  diffStep?: number;
  maxSide?: number;
  quality?: number;
  /** orçamento total dos JPEGs (base64) — o corpo da rota precisa ficar < 4 MB */
  budgetBytes?: number;
  /** só os primeiros N segundos */
  maxDuration?: number;
  /** só JPEGs, sem diffs (miniaturas do material) */
  noDiffs?: boolean;
  onProgress?: (f: number) => void;
}

export interface SampleResult {
  frames: Frame[];
  diffs: number[];
  diffTimes: number[];
  color?: ColorStats;
  duration: number;
  width: number;
  height: number;
}

/** amostra quadros de um vídeo (URL blob/objeto) */
export async function sampleVideo(url: string, opts: SampleOptions = {}): Promise<SampleResult> {
  const dev = deviceProfile();
  const maxFrames = opts.maxFrames ?? (dev.weak ? 16 : dev.mobile ? 24 : 40);
  const maxSide = opts.maxSide ?? (dev.weak ? 384 : 512);
  const quality = opts.quality ?? 0.7;
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.src = url;
  try {
    await waitEvent(video, 'loadedmetadata', 15000);
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', 15000).catch(() => {});
    // Safari iOS às vezes só decodifica quadros depois de um play()
    try { await video.play(); video.pause(); } catch { /* autoplay bloqueado: seek ainda funciona */ }
    const duration = Math.min(Number.isFinite(video.duration) ? video.duration : 0, opts.maxDuration ?? 120);
    const W = video.videoWidth || 16, H = video.videoHeight || 9;
    const scale = Math.min(1, maxSide / Math.max(W, H));
    const big = document.createElement('canvas');
    big.width = Math.max(2, Math.round(W * scale));
    big.height = Math.max(2, Math.round(H * scale));
    const bctx = big.getContext('2d');
    const tiny = document.createElement('canvas');
    tiny.width = 48; tiny.height = 27;
    const tctx = tiny.getContext('2d', { willReadFrequently: true });
    if (!bctx || !tctx) throw new Error('canvas indisponível');

    const plan = opts.noDiffs
      ? (() => {
          const n = Math.max(1, Math.min(maxFrames, Math.round(duration / (opts.frameEvery ?? 1))));
          const diffTimes = Array.from({ length: n }, (_, k) => Math.round((((k + 0.5) * duration) / n) * 1000) / 1000);
          return { diffTimes, jpegIdx: new Set(diffTimes.map((_, i) => i)) };
        })()
      : planSamples(duration, { diffStep: opts.diffStep ?? (dev.weak && duration > 40 ? 0.5 : 0.25), frameEvery: opts.frameEvery ?? 1, maxFrames, maxDiffs: dev.weak ? 160 : 360 });

    const frames: Frame[] = [];
    const diffs: number[] = [];
    const diffTimes: number[] = [];
    let prev: Uint8ClampedArray | null = null;
    // médias de cor (p/ detectar o "look" do vídeo-exemplo sem IA)
    const acc = { r: 0, g: 0, b: 0, sat: 0, n: 0, l2: 0 };
    for (let i = 0; i < plan.diffTimes.length; i++) {
      const t = plan.diffTimes[i];
      video.currentTime = t;
      try { await waitEvent(video, 'seeked', 5000); } catch { continue; }
      if (!opts.noDiffs) {
        tctx.drawImage(video, 0, 0, 48, 27);
        const d = tctx.getImageData(0, 0, 48, 27).data;
        // diferença em RGB (cortes entre cenas de brilho parecido também contam)
        const px = new Uint8ClampedArray(48 * 27 * 3);
        for (let k = 0; k < 48 * 27; k++) {
          const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
          px[k * 3] = r; px[k * 3 + 1] = g; px[k * 3 + 2] = b;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          acc.r += r; acc.g += g; acc.b += b; acc.sat += mx ? (mx - mn) / mx : 0; acc.n++;
          const lm = (0.299 * r + 0.587 * g + 0.114 * b) / 255; acc.l2 += lm * lm;
        }
        if (prev) {
          let s = 0;
          for (let k = 0; k < px.length; k++) s += Math.abs(px[k] - prev[k]);
          diffs.push(s / (px.length * 255));
          diffTimes.push(t);
        }
        prev = px;
      }
      if (plan.jpegIdx.has(i)) {
        bctx.drawImage(video, 0, 0, big.width, big.height);
        frames.push({ t, data: await canvasJpeg(big, quality), mediaType: 'image/jpeg' });
      }
      opts.onProgress?.((i + 1) / plan.diffTimes.length);
    }
    const color: ColorStats | undefined = acc.n
      ? (() => {
          const lum = (0.299 * acc.r + 0.587 * acc.g + 0.114 * acc.b) / acc.n / 255;
          return { r: acc.r / acc.n / 255, g: acc.g / acc.n / 255, b: acc.b / acc.n / 255, sat: acc.sat / acc.n, lum, lumSd: Math.sqrt(Math.max(0, acc.l2 / acc.n - lum * lum)) };
        })()
      : undefined;
    return { frames: fitBudget(frames, opts.budgetBytes ?? 2_800_000), diffs, diffTimes, duration, width: W, height: H, color };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** miniaturas existentes (data URLs do shell) -> Frames, uniformemente espaçadas */
export function framesFromThumbnails(thumbs: string[] | undefined, duration: number, max: number): Frame[] {
  const list = (thumbs ?? []).filter((d) => /^data:image\/jpe?g;base64,/.test(d));
  if (!list.length) return [];
  const n = Math.min(max, list.length);
  return Array.from({ length: n }, (_, k) => {
    const i = Math.floor(((k + 0.5) * list.length) / n);
    return { t: Math.round(((i + 0.5) / list.length) * duration * 10) / 10, data: list[i].replace(/^data:[^;]+;base64,/, ''), mediaType: 'image/jpeg' as const };
  });
}

/* ---------- quadros p/ medir MOVIMENTO do vídeo modelo (motion.ts) ---------- */

export interface MotionFrames {
  /** quadros em cinza (≈10 fps; 6 fps em aparelho fraco), lado maior 192 (128 no fraco) */
  gray: { w: number; h: number; data: Uint8ClampedArray }[];
  times: number[];
  /** janelas de quadros RGBA seguidos (faixa de legenda) */
  windows: { w: number; h: number; data: Uint8ClampedArray }[][];
  duration: number;
  /** 'play' = tocando mudo acelerado (requestVideoFrameCallback); 'seek' = quadro a quadro */
  method: 'play' | 'seek';
}

/**
 * Amostra o vídeo modelo para medir o movimento: toca MUDO e acelerado lendo cada quadro apresentado
 * (requestVideoFrameCallback — mais rápido que seek no Android); sem rVFC ou se travar, cai para seek.
 * Guarda cinza de todos os quadros e RGBA só em ~14 janelas de 9 quadros (memória baixa).
 */
export async function sampleMotionFrames(url: string, opts: { maxDuration?: number; fps?: number; maxSide?: number; rate?: number; onProgress?: (f: number) => void } = {}): Promise<MotionFrames> {
  const dev = deviceProfile();
  const fps = opts.fps ?? (dev.weak ? 6 : 10);
  const maxSide = opts.maxSide ?? (dev.weak ? 128 : 192);
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.src = url;
  try {
    await waitEvent(video, 'loadedmetadata', 15000);
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', 15000).catch(() => {});
    const duration = Math.min(Number.isFinite(video.duration) ? video.duration : 0, opts.maxDuration ?? (dev.weak ? 30 : 60));
    const W0 = video.videoWidth || 16, H0 = video.videoHeight || 9;
    const sc = maxSide / Math.max(W0, H0);
    const w = Math.max(8, Math.round(W0 * sc)), h = Math.max(8, Math.round(H0 * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx || !duration) throw new Error('canvas/vídeo indisponível');
    const total = Math.max(2, Math.floor(duration * fps));
    const winEvery = Math.max(9, Math.floor(total / 14));
    const gray: MotionFrames['gray'] = [];
    const times: number[] = [];
    const windows: MotionFrames['windows'] = [];
    let curWin: { w: number; h: number; data: Uint8ClampedArray }[] | null = null;
    const grab = (t: number) => {
      ctx.drawImage(video, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const g = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
      const k = gray.length;
      gray.push({ w, h, data: g });
      times.push(Math.round(t * 1000) / 1000);
      if (k % winEvery === 0) { curWin = []; windows.push(curWin); }
      if (curWin && curWin.length < 9) curWin.push({ w, h, data: new Uint8ClampedArray(d) });
      opts.onProgress?.(Math.min(1, t / duration));
    };
    type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
    let method: MotionFrames['method'] = 'seek';
    if (rvfc) {
      try {
        video.currentTime = 0;
        await waitEvent(video, 'seeked', 5000).catch(() => {});
        video.playbackRate = opts.rate ?? (dev.mobile ? 2 : 3);
        const step = 1 / fps;
        let next = 0;
        let lastProgress = Date.now();
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const finish = (err?: Error) => {
            if (finished) return;
            finished = true;
            clearInterval(watchdog);
            video.pause();
            if (err) reject(err); else resolve();
          };
          const onFrame = (_now: number, meta: { mediaTime: number }) => {
            if (finished) return;
            const t = meta.mediaTime;
            if (t >= next - step * 0.25) { grab(t); next = t + step; lastProgress = Date.now(); }
            if (t >= duration - step * 0.5 || video.ended) finish();
            else rvfc(onFrame);
          };
          // travou (aba em segundo plano, decodificador lento): desiste e cai para seek
          const watchdog = setInterval(() => {
            if (video.ended || video.currentTime >= duration - step) finish();
            else if (Date.now() - lastProgress > 4000) finish(new Error('reprodução travou'));
          }, 500);
          video.addEventListener('ended', () => finish(), { once: true });
          rvfc(onFrame);
          video.play().catch((e) => finish(e instanceof Error ? e : new Error('play bloqueado')));
        });
        // quadros demais faltando (decodificador pulou muito): refaz por seek
        if (gray.length >= Math.max(4, total * 0.6)) method = 'play';
      } catch { /* cai para seek */ }
    }
    if (method === 'seek') {
      gray.length = 0; times.length = 0; windows.length = 0; curWin = null;
      video.playbackRate = 1;
      for (let i = 0; i < total; i++) {
        const t = Math.min(duration - 0.01, i / fps + 0.5 / fps);
        video.currentTime = t;
        try { await waitEvent(video, 'seeked', 5000); } catch { continue; }
        grab(t);
      }
    }
    return { gray, times, windows, duration, method };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * JPEGs em instantes escolhidos (pares em volta dos cortes, começo/fim de tomadas) e recortes
 * da faixa de legenda em resolução cheia — para o Claude ver o que a medição achou.
 */
export async function sampleVideoAt(url: string, shots: { t: number; label: string; crop?: { y0: number; y1: number } }[], opts: { maxSide?: number; quality?: number } = {}): Promise<Frame[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.src = url;
  const out: Frame[] = [];
  try {
    await waitEvent(video, 'loadedmetadata', 15000);
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', 15000).catch(() => {});
    const W = video.videoWidth || 16, H = video.videoHeight || 9;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return out;
    for (const s of shots) {
      video.currentTime = Math.max(0, Math.min((video.duration || s.t) - 0.02, s.t));
      try { await waitEvent(video, 'seeked', 5000); } catch { continue; }
      if (s.crop) {
        // faixa da legenda: largura cheia até 720 px (texto legível)
        const sy = Math.max(0, Math.floor(s.crop.y0 * H)), sh = Math.max(2, Math.ceil((s.crop.y1 - s.crop.y0) * H));
        const sc = Math.min(1, 720 / W);
        c.width = Math.round(W * sc); c.height = Math.max(2, Math.round(sh * sc));
        ctx.drawImage(video, 0, sy, W, sh, 0, 0, c.width, c.height);
      } else {
        const sc = Math.min(1, (opts.maxSide ?? 320) / Math.max(W, H));
        c.width = Math.round(W * sc); c.height = Math.round(H * sc);
        ctx.drawImage(video, 0, 0, c.width, c.height);
      }
      out.push({ t: Math.round(s.t * 100) / 100, data: await canvasJpeg(c, opts.quality ?? 0.6), mediaType: 'image/jpeg', label: s.label });
    }
    return out;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
