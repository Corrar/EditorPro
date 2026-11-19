/* =====================================================================
   Medição do MOVIMENTO (puro, testado + amostrador no navegador):
   - edgePxPerFrame: quanto a borda do quadro anda por quadro com um conjunto de keyframes
     (régua da suavidade: ≤8 px/quadro a 30 fps em 1080 de largura)
   - estimadores do vídeo modelo (alinhamento por escala+translação entre quadros
     vizinhos em tons de cinza 108×192): cortes exatos, zoom por tomada, pico/média
     da velocidade (suave × pancada), easing, faixa de legenda, transições
   ===================================================================== */
import type { Easing, Keyframe, MotionMode, ReferenceTemplate, ShotMotion, Transform, TransitionKind } from '../types';
import { interpolateTransform } from '../engine/easing';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ---------- régua da suavidade ---------- */

/**
 * Maior deslocamento de borda (px/quadro) produzido pelos keyframes de um clipe de `duration` s,
 * amostrado a `fps`, para um quadro de `width` px. Considera escala (borda anda W/2·Δs) e x (W·Δx).
 */
export function edgePxPerFrame(keyframes: Keyframe[] | undefined, duration: number, opts: { fps?: number; width?: number; base?: Partial<Transform> } = {}): number {
  const fps = opts.fps ?? 30, W = opts.width ?? 1080;
  if (!keyframes?.length || duration <= 0) return 0;
  const base = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ...(opts.base ?? {}) };
  let prev = interpolateTransform(base, keyframes, 0);
  let max = 0;
  const n = Math.max(1, Math.round(duration * fps));
  for (let i = 1; i <= n; i++) {
    const cur = interpolateTransform(base, keyframes, Math.min(duration, i / fps));
    const d = (W / 2) * Math.abs(cur.scale - prev.scale) + W * Math.abs(cur.x - prev.x);
    if (d > max) max = d;
    prev = cur;
  }
  return max;
}

/* ---------- estimadores (quadros em cinza) ---------- */

/** quadro em cinza (0..255), largura w × altura h */
export interface Gray { w: number; h: number; data: Float32Array | Uint8ClampedArray | number[] }

/** valor bilinear em (x, y) */
function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
  const xa = Math.max(0, Math.min(g.w - 1, x0)), ya = Math.max(0, Math.min(g.h - 1, y0));
  const d = g.data;
  const a = d[ya * g.w + xa], b = d[ya * g.w + x1], c = d[y1 * g.w + xa], e = d[y1 * g.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

export interface AlignOpts {
  /** faixa de escala testada (cur/prev) */
  sMin?: number; sMax?: number; sSteps?: number;
  /** translação testada (px), passo 1 */
  shift?: number;
  /** margem ignorada (fração de cada lado) */
  border?: number;
  /** faixa ignorada (legenda), y em 0..1 */
  mask?: { y0: number; y1: number };
  /** pular pixels (velocidade) */
  stride?: number;
}

/**
 * Diferença média absoluta entre `cur` e `prev` transformado: cur(p) ≈ prev(c + (p−c)/s − t).
 * s > 1 = o quadro atual está mais aproximado (zoom in).
 */
export function alignedResidual(prev: Gray, cur: Gray, s: number, tx: number, ty: number, o: AlignOpts = {}): number {
  const bw = Math.round(cur.w * (o.border ?? 0.12)), bh = Math.round(cur.h * (o.border ?? 0.12));
  const cx = (cur.w - 1) / 2, cy = (cur.h - 1) / 2;
  const st = o.stride ?? 1;
  const my0 = o.mask ? o.mask.y0 * cur.h : Infinity, my1 = o.mask ? o.mask.y1 * cur.h : -Infinity;
  let sum = 0, n = 0;
  for (let y = bh; y < cur.h - bh; y += st) {
    if (y >= my0 && y <= my1) continue;
    for (let x = bw; x < cur.w - bw; x += st) {
      const px = cx + (x - cx) / s - tx, py = cy + (y - cy) / s - ty;
      if (px < 0 || py < 0 || px > prev.w - 1 || py > prev.h - 1) continue;
      sum += Math.abs(cur.data[y * cur.w + x] - sample(prev, px, py));
      n++;
    }
  }
  return n ? sum / n : 255;
}

export interface PairMotion { s: number; tx: number; ty: number; residual: number; raw: number }

/** melhor (escala, translação) entre dois quadros vizinhos: busca grossa em escala, depois translação, depois refino */
export function alignPair(prev: Gray, cur: Gray, o: AlignOpts = {}): PairMotion {
  const sMin = o.sMin ?? 0.97, sMax = o.sMax ?? 1.06, steps = o.sSteps ?? 37, shift = o.shift ?? 3;
  const fast = { ...o, stride: o.stride ?? 2 };
  const raw = alignedResidual(prev, cur, 1, 0, 0, o);
  let best = { s: 1, tx: 0, ty: 0, residual: raw };
  for (let i = 0; i < steps; i++) {
    const s = sMin + ((sMax - sMin) * i) / (steps - 1);
    const r = alignedResidual(prev, cur, s, 0, 0, fast);
    if (r < best.residual) best = { s, tx: 0, ty: 0, residual: r };
  }
  for (let ty = -shift; ty <= shift; ty++) {
    for (let tx = -shift; tx <= shift; tx++) {
      if (!tx && !ty) continue;
      const r = alignedResidual(prev, cur, best.s, tx, ty, fast);
      if (r < best.residual) best = { s: best.s, tx, ty, residual: r };
    }
  }
  // refino fino da escala em torno do melhor (±meio passo, 9 passos), resolução cheia
  const half = (sMax - sMin) / (steps - 1) / 2;
  let fine = { ...best, residual: alignedResidual(prev, cur, best.s, best.tx, best.ty, o) };
  for (let k = -4; k <= 4; k++) {
    const s = best.s + (half * k) / 4;
    const r = alignedResidual(prev, cur, s, best.tx, best.ty, o);
    if (r < fine.residual) fine = { ...fine, s, residual: r };
  }
  return { ...fine, raw };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** classe do easing pela posição do pico de velocidade dentro da tomada */
export function easingFromVelocity(v: number[]): Easing {
  const tot = v.reduce((a, b) => a + Math.abs(b), 0);
  if (v.length < 3 || tot < 1e-6) return 'easeInOut';
  const mean = tot / v.length;
  const peak = Math.max(...v.map(Math.abs));
  if (peak / mean < 1.25) return 'linear';
  // centro de massa da velocidade (0..1)
  let acc = 0;
  v.forEach((x, i) => { acc += Math.abs(x) * (i + 0.5); });
  const c = acc / tot / v.length;
  if (c < 0.38) return 'easeOut';
  if (c > 0.62) return 'easeIn';
  return 'easeInOut';
}

export interface MotionTrack {
  /** tempos dos quadros (s) */
  times: number[];
  /** movimento de i-1 → i (pairs[0] é o par 0→1) */
  pairs: PairMotion[];
}

/** cortes: residual alinhado > max(25, mediana + 8·MAD) (e > 2× o vizinho, para não pegar movimento) */
export function detectCuts(track: MotionTrack, minResidual = 25): number[] {
  const res = track.pairs.map((p) => p.residual);
  const med = median(res);
  const mad = median(res.map((r) => Math.abs(r - med)));
  const th = Math.max(minResidual, med + 8 * mad);
  const cuts: number[] = [];
  res.forEach((r, i) => {
    if (r <= th) return;
    const t = (track.times[i] + track.times[i + 1]) / 2;
    if (cuts.length && t - cuts[cuts.length - 1] < 0.25) return;
    cuts.push(r3(t));
  });
  return cuts;
}

/** movimento por tomada a partir dos pares (só os pares dentro da tomada) */
export function shotMotions(track: MotionTrack, cuts: number[], frame: { w: number; h: number }): ShotMotion[] {
  const end = track.times[track.times.length - 1] ?? 0;
  const bounds = [track.times[0] ?? 0, ...cuts, end];
  const out: ShotMotion[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b - a < 0.05) continue;
    const idx = track.pairs.map((_, i) => i).filter((i) => track.times[i] >= a - 1e-6 && track.times[i + 1] <= b + 1e-6);
    const ls = idx.map((i) => Math.log(track.pairs[i].s));
    const zoomTotal = Math.exp(ls.reduce((x, y) => x + y, 0));
    const panX = idx.reduce((n, i) => n + track.pairs[i].tx, 0) / frame.w;
    const panY = idx.reduce((n, i) => n + track.pairs[i].ty, 0) / frame.h;
    const mag = ls.map(Math.abs);
    const mean = mag.length ? mag.reduce((x, y) => x + y, 0) / mag.length : 0;
    const peak = mag.length ? Math.max(...mag) : 0;
    const pom = mean > 1e-5 ? peak / mean : 1;
    const punches = mag.filter((m) => m > 0.025 && mean > 0 && m / mean > 4).length;
    out.push({ start: r3(a), end: r3(b), zoomTotal: r3(zoomTotal), panX: r3(panX), panY: r3(panY), peakOverMean: r3(pom), easing: easingFromVelocity(ls), punches });
  }
  return out;
}

/** modo dominante + resumo do movimento */
export function summarizeMotion(shots: ShotMotion[]): ReferenceTemplate['motion'] {
  // tomadas muito curtas (<0,4 s) medem pouco: entram só se forem tudo
  const useful = shots.filter((s) => s.end - s.start >= 0.4);
  const S = useful.length ? useful : shots;
  if (!S.length) return { mode: 'static', avgZoomPerShot: 1, easing: 'easeInOut', perShot: shots };
  const zooms = S.map((s) => s.zoomTotal);
  const ins = S.filter((s) => s.zoomTotal > 1.015).length;
  const outs = S.filter((s) => s.zoomTotal < 1 / 1.015).length;
  const punchy = S.filter((s) => s.punches > 0).length;
  const pans = S.filter((s) => Math.abs(s.panX) > 0.03 || Math.abs(s.panY) > 0.03).length;
  const moving = ins + outs;
  const n = S.length;
  let mode: MotionMode;
  if (punchy / n >= 0.3) mode = 'punch';
  else if (moving / n >= 0.5) mode = ins && outs && Math.min(ins, outs) / moving >= 0.3 ? 'push-pull' : 'smooth-push';
  else if (pans / n >= 0.5) mode = 'pan';
  else if (moving / n >= 0.2) mode = 'mixed';
  else mode = 'static';
  // zoom típico (magnitude) no sentido dominante
  const dir: 'in' | 'out' | 'alternate' = mode === 'push-pull' ? 'alternate' : outs > ins ? 'out' : 'in';
  const mags = S.filter((s) => (dir === 'out' ? s.zoomTotal < 1 : s.zoomTotal > 1)).map((s) => Math.abs(Math.log(s.zoomTotal)));
  const mag = mags.length ? Math.exp(median(mags)) : 1;
  const avgZoomPerShot = mode === 'static' || mode === 'pan' ? 1 : r3(dir === 'out' ? 1 / mag : mag);
  const easings = S.filter((s) => Math.abs(Math.log(s.zoomTotal)) > 0.015).map((s) => s.easing);
  const count = (e: Easing) => easings.filter((x) => x === e).length;
  const easing = (['easeInOut', 'easeOut', 'easeIn', 'linear'] as Easing[]).reduce((b, e) => (count(e) > count(b) ? e : b), 'easeInOut' as Easing);
  void zooms;
  return { mode, avgZoomPerShot, easing: easing === 'linear' ? 'easeInOut' : easing, direction: dir, punchFrequency: r3(punchy / n), perShot: shots };
}

/** estatísticas das durações das tomadas */
export function shotStatsOf(shots: { start: number; end: number }[]): ReferenceTemplate['shotStats'] {
  const d = shots.map((s) => s.end - s.start);
  return { median: r3(median(d)), p10: r3(quantile(d, 0.1)), p90: r3(quantile(d, 0.9)) };
}

/**
 * Transições pelos resíduos brutos (sem alinhamento):
 * dissolver = rampa de diferenças em ≥3 amostras seguidas sem pico isolado; flash = pico de luminância.
 * `lum` = luminância média por quadro (0..255). Sem evidência: só 'cut'.
 */
export function detectTransitions(track: MotionTrack, cuts: number[], lum?: number[]): ReferenceTemplate['transitions'] {
  const res = track.pairs.map((p) => p.residual);
  const med = median(res);
  const out: { kind: TransitionKind; t: number; duration: number }[] = [];
  // dissolver: ≥3 pares seguidos acima de 3× a mediana e abaixo do limiar de corte, com conteúdo trocando
  const th = Math.max(6, med * 3);
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const a = track.times[run[0]], b = track.times[run[run.length - 1] + 1];
      // não conta se um corte seco cai no meio (é movimento + corte)
      if (!cuts.some((c) => c > a + 0.02 && c < b - 0.02) || run.length >= 4) out.push({ kind: 'crossfade', t: (a + b) / 2, duration: r3(b - a) });
    }
    run = [];
  };
  res.forEach((r, i) => { if (r > th && r < Math.max(25, med + 8 * median(res.map((x) => Math.abs(x - med))))) run.push(i); else flush(); });
  flush();
  if (lum?.length) {
    const lm = median(lum);
    lum.forEach((l, i) => {
      if (l > Math.min(250, lm + 70) && (i === 0 || l - lum[i - 1] > 50)) out.push({ kind: 'flash', t: track.times[i], duration: 0.2 });
    });
  }
  const n = Math.max(1, cuts.length + out.length);
  const kinds = new Map<TransitionKind, { d: number[]; c: number }>();
  for (const o of out) {
    const e = kinds.get(o.kind) ?? { d: [], c: 0 };
    e.d.push(o.duration); e.c++;
    kinds.set(o.kind, e);
  }
  const list: ReferenceTemplate['transitions'] = [{ kind: 'cut', duration: 0, frequency: r3(cuts.length / n) }];
  for (const [kind, e] of kinds) list.push({ kind, duration: r3(median(e.d)), frequency: r3(e.c / n) });
  return list;
}

/* ---------- faixa de legenda ---------- */

/** cor hex de um RGB 0..255 */
export function hexOf(r: number, g: number, b: number): string {
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export interface RgbFrame { w: number; h: number; data: Uint8ClampedArray | number[] /* RGBA */ }

/**
 * Faixa de legenda (protótipo capdetect.py): linhas com bordas fortes que ficam paradas enquanto o
 * fundo se mexe. Só confia se o fundo REALMENTE se mexe (senão um cenário parado vira "legenda").
 * Devolve faixa y0/y1, cor do texto (clara/saturada) e da caixa (escura e uniforme) ou null.
 */
export function detectCaptionBand(frames: RgbFrame[]): ReferenceTemplate['captions'] | undefined {
  if (frames.length < 4) return undefined;
  const { w, h } = frames[0];
  const lumOf = (f: RgbFrame, x: number, y: number) => {
    const k = (y * w + x) * 4;
    return 0.299 * f.data[k] + 0.587 * f.data[k + 1] + 0.114 * f.data[k + 2];
  };
  // energia de borda horizontal por linha (média nos quadros) e variação temporal por linha
  const edge = new Float64Array(h), tvar = new Float64Array(h);
  for (const f of frames) {
    for (let y = 0; y < h; y++) {
      let e = 0;
      for (let x = 1; x < w; x++) e += Math.abs(lumOf(f, x, y) - lumOf(f, x - 1, y));
      edge[y] += e / (w * frames.length);
    }
  }
  for (let i = 1; i < frames.length; i++) {
    for (let y = 0; y < h; y++) {
      let d = 0;
      for (let x = 0; x < w; x += 2) d += Math.abs(lumOf(frames[i], x, y) - lumOf(frames[i - 1], x, y));
      tvar[y] += d / ((w / 2) * (frames.length - 1));
    }
  }
  const bgMotion = median(Array.from(tvar));
  if (bgMotion < 4) return undefined; // fundo parado: não dá para separar legenda de cenário
  const edgeMed = median(Array.from(edge));
  // linha candidata: borda forte E muito mais estável que o fundo; procura a maior faixa contígua na metade de baixo/centro
  const cand = Array.from({ length: h }, (_, y) => edge[y] > Math.max(6, edgeMed * 1.8) && tvar[y] < bgMotion * 0.55);
  let best: [number, number] | undefined;
  for (let y = Math.floor(h * 0.12); y < Math.floor(h * 0.95); y++) {
    if (!cand[y]) continue;
    let e = y;
    // tolera falhas de 1 linha
    while (e + 1 < h && (cand[e + 1] || (e + 2 < h && cand[e + 2]))) e++;
    if (!best || e - y > best[1] - best[0]) best = [y, e];
    y = e;
  }
  if (!best || best[1] - best[0] + 1 < Math.max(2, h * 0.02) || best[1] - best[0] + 1 > h * 0.25) return undefined;
  const [y0, y1] = best;
  // cores: na faixa, separa pixels claros/saturados (texto) dos escuros (caixa)
  const px: [number, number, number, number][] = [];
  for (const f of frames) for (let y = y0; y <= y1; y++) for (let x = Math.floor(w * 0.1); x < Math.ceil(w * 0.9); x++) {
    const k = (y * w + x) * 4;
    const r = f.data[k], g = f.data[k + 1], b = f.data[k + 2];
    px.push([r, g, b, 0.299 * r + 0.587 * g + 0.114 * b]);
  }
  const sorted = [...px].sort((a, b) => a[3] - b[3]);
  const top = sorted.slice(Math.floor(sorted.length * 0.85));
  const bottom = sorted.slice(0, Math.floor(sorted.length * 0.4));
  const avg = (l: typeof px) => l.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((x) => x / Math.max(1, l.length));
  const t = avg(top), bx = avg(bottom);
  // caixa: o escuro é uniforme (baixo desvio) e escuro de verdade em quase toda a faixa
  const bl = bottom.map((p) => p[3]);
  const bMean = bl.reduce((a, b) => a + b, 0) / Math.max(1, bl.length);
  const bSd = Math.sqrt(bl.reduce((a, b) => a + (b - bMean) ** 2, 0) / Math.max(1, bl.length));
  const darkShare = px.filter((p) => p[3] < 70).length / px.length;
  const hasBox = bMean < 60 && bSd < 18 && darkShare > 0.35;
  return {
    region: { y0: r3(y0 / h), y1: r3((y1 + 1) / h) },
    textColor: hexOf(t[0], t[1], t[2]),
    boxColor: hasBox ? hexOf(bx[0], bx[1], bx[2]) : null,
    // altura do texto ≈ 60% da faixa (caixa tem respiro); sem caixa, a faixa é o texto
    heightPx1920: Math.round(((y1 - y0 + 1) / h) * 1920 * (hasBox ? 0.62 : 0.9)),
    uppercase: true,
  };
}
