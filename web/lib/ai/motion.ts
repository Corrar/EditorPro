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

/**
 * Refino conjunto (Gauss–Newton / Lucas–Kanade) de escala + translação a partir de um palpite:
 * a escala e o deslocamento são acoplados (perto da borda, um zoom pequeno parece um deslocamento),
 * então refiná-los um de cada vez prende num mínimo falso — um pan lento virava "zoom".
 * Devolve o palpite se não melhorar o resíduo.
 */
function refineJoint(prev: Gray, cur: Gray, init: { s: number; tx: number; ty: number; residual: number }, o: AlignOpts, iters = 6, st = 2): { s: number; tx: number; ty: number; residual: number } {
  const w = prev.w, h = prev.h, d = prev.data;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gx[i] = (d[y * w + Math.min(w - 1, x + 1)] - d[y * w + Math.max(0, x - 1)]) / 2;
    gy[i] = (d[Math.min(h - 1, y + 1) * w + x] - d[Math.max(0, y - 1) * w + x]) / 2;
  }
  const G: Gray = { w, h, data: gx }, Gy: Gray = { w, h, data: gy };
  const bw = Math.round(cur.w * (o.border ?? 0.12)), bh = Math.round(cur.h * (o.border ?? 0.12));
  const cx = (cur.w - 1) / 2, cy = (cur.h - 1) / 2;
  const my0 = o.mask ? o.mask.y0 * cur.h : Infinity, my1 = o.mask ? o.mask.y1 * cur.h : -Infinity;
  const shift = (o.shift ?? 3) + 1, sMin = (o.sMin ?? 0.97) - 0.01, sMax = (o.sMax ?? 1.06) + 0.01;
  let { s, tx, ty } = init;
  for (let it = 0; it < iters; it++) {
    let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let y = bh; y < cur.h - bh; y += st) {
      if (y >= my0 && y <= my1) continue;
      for (let x = bw; x < cur.w - bw; x += st) {
        const px = cx + (x - cx) / s - tx, py = cy + (y - cy) / s - ty;
        if (px < 0 || py < 0 || px > w - 1 || py > h - 1) continue;
        const e = cur.data[y * cur.w + x] - sample(prev, px, py);
        const ix = sample(G, px, py), iy = sample(Gy, px, py);
        // ∂I/∂s, ∂I/∂tx, ∂I/∂ty do quadro anterior amostrado
        const js = -(ix * (x - cx) + iy * (y - cy)) / (s * s), jx = -ix, jy = -iy;
        a00 += js * js; a01 += js * jx; a02 += js * jy; a11 += jx * jx; a12 += jx * jy; a22 += jy * jy;
        b0 += js * e; b1 += jx * e; b2 += jy * e;
      }
    }
    // resolve o 3×3 (Cramer); sem textura suficiente, para
    const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) break;
    const ds = (b0 * (a11 * a22 - a12 * a12) - a01 * (b1 * a22 - a12 * b2) + a02 * (b1 * a12 - a11 * b2)) / det;
    const dtx = (a00 * (b1 * a22 - a12 * b2) - b0 * (a01 * a22 - a12 * a02) + a02 * (a01 * b2 - b1 * a02)) / det;
    const dty = (a00 * (a11 * b2 - b1 * a12) - a01 * (a01 * b2 - b1 * a02) + b0 * (a01 * a12 - a11 * a02)) / det;
    if (![ds, dtx, dty].every(Number.isFinite)) break;
    s = Math.max(sMin, Math.min(sMax, s + Math.max(-0.02, Math.min(0.02, ds))));
    tx = Math.max(-shift, Math.min(shift, tx + Math.max(-1, Math.min(1, dtx))));
    ty = Math.max(-shift, Math.min(shift, ty + Math.max(-1, Math.min(1, dty))));
    if (Math.abs(ds) < 1e-5 && Math.abs(dtx) < 0.005 && Math.abs(dty) < 0.005) break;
  }
  const residual = alignedResidual(prev, cur, s, tx, ty, { ...o, stride: 1 });
  return residual < init.residual ? { s, tx, ty, residual } : init;
}

/**
 * Melhor (escala, translação) entre dois quadros vizinhos, do grosso ao fino:
 * escala em passos de ~0,01 (amostrando 1 a cada 3 px) → translação inteira ±shift (nessa escala e
 * na escala 1) → refino da escala → refino CONJUNTO subpixel (Gauss–Newton, resolução cheia).
 */
export function alignPair(prev: Gray, cur: Gray, o: AlignOpts = {}): PairMotion {
  const sMin = o.sMin ?? 0.97, sMax = o.sMax ?? 1.06, shift = o.shift ?? 3;
  const coarseN = Math.max(5, Math.round((sMax - sMin) / 0.01) + 1);
  const at = (st: number) => ({ ...o, stride: st });
  const R = (s: number, tx: number, ty: number, st: number) => alignedResidual(prev, cur, s, tx, ty, at(st));
  const raw = R(1, 0, 0, 2);
  const step = (sMax - sMin) / (coarseN - 1);
  // 1) escala grossa sem translação
  let s0 = 1, r0 = R(1, 0, 0, 3);
  for (let i = 0; i < coarseN; i++) {
    const s = sMin + ((sMax - sMin) * i) / (coarseN - 1);
    const r = R(s, 0, 0, 3);
    if (r < r0) { s0 = s; r0 = r; }
  }
  // 2) translação inteira nessa escala E na escala 1 (num pan a escala grossa sai torta)
  let mid = { s: s0, tx: 0, ty: 0, residual: r0 };
  for (const s of s0 === 1 ? [s0] : [s0, 1]) {
    for (let ty = -shift; ty <= shift; ty++) {
      for (let tx = -shift; tx <= shift; tx++) {
        if (!tx && !ty && s === s0) continue;
        const r = R(s, tx, ty, 3);
        if (r < mid.residual) mid = { s, tx, ty, residual: r };
      }
    }
  }
  // 3) refino da escala com a translação achada
  const sm = mid.s;
  mid = { ...mid, residual: R(sm, mid.tx, mid.ty, 2) };
  for (let k = -4; k <= 4; k++) {
    if (!k) continue;
    const s = sm + (step * k) / 4;
    const r = R(s, mid.tx, mid.ty, 2);
    if (r < mid.residual) mid = { ...mid, s, residual: r };
  }
  // 4) refino conjunto subpixel em resolução cheia
  const fine = refineJoint(prev, cur, { ...mid, residual: R(mid.s, mid.tx, mid.ty, 1) }, o);
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
export function shotMotions(track: MotionTrack, cuts: number[], frame: { w: number; h: number }, exclude: { a: number; b: number }[] = []): ShotMotion[] {
  const end = track.times[track.times.length - 1] ?? 0;
  const bounds = [track.times[0] ?? 0, ...cuts, end];
  const out: ShotMotion[] = [];
  // pares dentro de um dissolver misturam duas cenas: não medem movimento de câmera
  const mixed = (i: number) => exclude.some((r) => track.times[i + 1] > r.a + 1e-6 && track.times[i] < r.b - 1e-6);
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    if (b - a < 0.05) continue;
    const idx = track.pairs.map((_, i) => i).filter((i) => track.times[i] >= a - 1e-6 && track.times[i + 1] <= b + 1e-6 && !mixed(i));
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
/** o quadro do meio é uma MISTURA dos quadros das pontas? (dissolver) — erro da mistura / erro até as pontas */
export function blendScore(a: Gray, mid: Gray, b: Gray): number {
  let best = Infinity, ea = 0, eb = 0;
  const n = mid.data.length;
  for (let i = 0; i < n; i += 3) { ea += Math.abs(mid.data[i] - a.data[i]); eb += Math.abs(mid.data[i] - b.data[i]); }
  for (let k = 1; k < 10; k++) {
    const al = k / 10;
    let e = 0;
    for (let i = 0; i < n; i += 3) e += Math.abs(mid.data[i] - (al * a.data[i] + (1 - al) * b.data[i]));
    if (e < best) best = e;
  }
  return best / Math.max(1e-6, Math.min(ea, eb));
}

export interface TransitionEvent { kind: TransitionKind; t: number; duration: number }

export function detectTransitions(track: MotionTrack, cuts: number[], lum?: number[], gray?: Gray[]): ReferenceTemplate['transitions'] {
  return summarizeTransitions(transitionEvents(track, cuts, lum, gray), cuts.length);
}

/** frequência e duração típica de cada tipo (corte seco + transições achadas) */
export function summarizeTransitions(out: TransitionEvent[], nCuts: number): ReferenceTemplate['transitions'] {
  const n = Math.max(1, nCuts + out.length);
  const kinds = new Map<TransitionKind, { d: number[]; c: number }>();
  for (const o of out) {
    const e = kinds.get(o.kind) ?? { d: [], c: 0 };
    e.d.push(o.duration); e.c++;
    kinds.set(o.kind, e);
  }
  const list: ReferenceTemplate['transitions'] = [{ kind: 'cut', duration: 0, frequency: r3(nCuts / n) }];
  for (const [kind, e] of kinds) list.push({ kind, duration: r3(median(e.d)), frequency: r3(e.c / n) });
  return list;
}

/** cada transição achada (instante do meio e duração) */
export function transitionEvents(track: MotionTrack, cuts: number[], lum?: number[], gray?: Gray[]): TransitionEvent[] {
  const res = track.pairs.map((p) => p.residual);
  const med = median(res);
  const out: { kind: TransitionKind; t: number; duration: number }[] = [];
  // dissolver: ≥3 pares seguidos acima de 3× a mediana e abaixo do limiar de corte, com conteúdo trocando
  const th = Math.max(6, med * 3);
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const a = track.times[run[0]], b = track.times[run[run.length - 1] + 1];
      // dissolver de verdade: o quadro do meio é a mistura das pontas (com os quadros; sem eles, pela rampa)
      const i0 = run[0], i1 = run[run.length - 1] + 1, im = Math.round((i0 + i1) / 2);
      const isBlend = gray ? !!gray[i0] && !!gray[i1] && blendScore(gray[i0], gray[im], gray[i1]) < 0.55 : !cuts.some((c) => c > a + 0.02 && c < b - 0.02);
      if (isBlend) out.push({ kind: 'crossfade', t: (a + b) / 2, duration: r3(b - a) });
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
  return out;
}

/* ---------- faixa de legenda ---------- */

/** cor hex de um RGB 0..255 */
export function hexOf(r: number, g: number, b: number): string {
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export interface RgbFrame { w: number; h: number; data: Uint8ClampedArray | number[] /* RGBA */ }

/**
 * Faixa de legenda (protótipo capdetect.py): em janelas curtas de quadros SEGUIDOS (~0,8 s, dentro de
 * uma tomada), pixels parados (desvio < 6) e com borda forte = texto queimado. Só confia se o fundo
 * REALMENTE se mexe (senão um cenário parado vira "legenda"). `frames` = quadros RGBA seguidos (~10 fps).
 * Devolve faixa y0/y1, cor do texto (clara e saturada) e da caixa (escura) ou undefined.
 */
export function detectCaptionBand(frames: RgbFrame[] | RgbFrame[][], win = 8, maxWindows = 14): ReferenceTemplate['captions'] | undefined {
  // janelas já separadas (amostrador do navegador guarda só elas): achata mantendo cada uma com `win` quadros
  if (Array.isArray(frames[0])) {
    const ws = (frames as RgbFrame[][]).filter((x) => x.length >= win);
    return ws.length ? detectCaptionBand(ws.flatMap((x) => x.slice(0, win)).concat(ws[ws.length - 1].slice(0, 1)), win, maxWindows) : undefined;
  }
  const list = frames as RgbFrame[];
  if (list.length < win + 1) return undefined;
  frames = list;
  const { w, h } = list[0];
  const N = w * h;
  const grayOf = (f: RgbFrame) => {
    const g = new Float32Array(N);
    for (let i = 0; i < N; i++) g[i] = (f.data[i * 4] + f.data[i * 4 + 1] + f.data[i * 4 + 2]) / 3;
    return g;
  };
  const starts: number[] = [];
  const nWin = Math.floor((list.length - 1) / win);
  const step = Math.max(1, Math.floor(nWin / maxWindows));
  for (let k = 0; k < nWin; k += step) starts.push(k * win);
  const score = new Float32Array(N);
  const motion: number[] = [];
  for (const s0 of starts) {
    const seg = list.slice(s0, s0 + win).map(grayOf);
    const mean = new Float32Array(N), sq = new Float32Array(N), edge = new Float32Array(N);
    for (const g of seg) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = g[i];
        mean[i] += v; sq[i] += v * v;
        edge[i] += Math.abs(v - g[x ? i - 1 : i]) + Math.abs(v - g[y ? i - w : i]);
      }
    }
    const sds: number[] = [];
    for (let i = 0; i < N; i++) {
      const m = mean[i] / seg.length;
      const sd = Math.sqrt(Math.max(0, sq[i] / seg.length - m * m));
      if (i % 7 === 0) sds.push(sd);
      if (sd < 6 && edge[i] / seg.length > 40) score[i] += 1;
    }
    motion.push(median(sds));
  }
  // fundo parado: cenário com bordas também fica "parado" — não dá para separar
  if (median(motion) < 3) return undefined;
  for (let i = 0; i < N; i++) score[i] /= starts.length;
  const rows = Array.from({ length: h }, (_, y) => { let a = 0; for (let x = 0; x < w; x++) a += score[y * w + x]; return a / w; });
  const top = Math.max(...rows);
  if (top < 0.02) return undefined;
  const on = rows.map((r) => r > top * 0.35);
  // maior faixa contígua (tolerando falhas de 2 linhas)
  let best: [number, number] | undefined;
  for (let y = 0; y < h; y++) {
    if (!on[y]) continue;
    let e = y;
    while (e + 1 < h && (on[e + 1] || on[e + 2] || on[e + 3])) e++;
    if (!best || e - y > best[1] - best[0]) best = [y, e];
    y = e;
  }
  if (!best) return undefined;
  const y0 = best[0], y1 = best[1] + 1;
  if (y1 - y0 < 2 || y1 - y0 > h * 0.3) return undefined;
  const colScore = Array.from({ length: w }, (_, x) => { let a = 0; for (let y = y0; y < y1; y++) a += score[y * w + x]; return a / (y1 - y0); });
  const cols = colScore.map((c, x) => (c > 0.1 ? x : -1)).filter((x) => x >= 0);
  const x0 = cols.length ? cols[0] : Math.floor(w * 0.1), x1 = cols.length ? cols[cols.length - 1] + 1 : Math.ceil(w * 0.9);
  const bright: number[][] = [], dark: number[][] = [];
  let total = 0;
  for (const s0 of starts) {
    const f = list[s0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * w + x) * 4;
      const r = f.data[k], g = f.data[k + 1], b = f.data[k + 2];
      const lum = (r + g + b) / 3, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      total++;
      if (lum > 120 && (mx - mn) / (mx + 1) > 0.4) bright.push([r, g, b]);
      else if (lum > 170) bright.push([r, g, b]); // texto branco também conta
      if (lum < 50) dark.push([r, g, b]);
    }
  }
  if (!bright.length) return undefined;
  const med3 = (l: number[][]) => [0, 1, 2].map((c) => median(l.map((p) => p[c])));
  // o miolo das letras (metade mais clara): a borda borrada da miniatura escurece a cor
  const t = med3([...bright].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2])).slice(Math.floor(bright.length / 2)));
  const hasBox = dark.length / Math.max(1, total) > 0.3;
  const bx = hasBox ? med3(dark) : null;
  return {
    region: { y0: r3(y0 / h), y1: r3(y1 / h) },
    textColor: hexOf(t[0], t[1], t[2]),
    boxColor: bx ? hexOf(bx[0], bx[1], bx[2]) : null,
    // altura útil do texto: com caixa, ~70% da faixa (respiro da caixa); sem caixa, a faixa é o texto
    heightPx1920: Math.round(((y1 - y0) / h) * 1920 * (hasBox ? 0.7 : 0.95)),
    uppercase: true,
  };
}

/* ---------- medição completa do modelo ---------- */

export interface ReferenceMeasure {
  cuts: number[];
  template: ReferenceTemplate;
  /** ms gastos no cálculo */
  ms: number;
}

/** luminância média de um quadro cinza */
function meanLum(g: Gray): number {
  let s = 0;
  for (let i = 0; i < g.data.length; i++) s += g.data[i];
  return s / Math.max(1, g.data.length);
}

/**
 * Mede o vídeo modelo a partir de quadros em cinza (≈10 fps, 108×192) e alguns quadros RGBA
 * (faixa de legenda). `duration` = duração analisada; `color` = cor média (frames.ts).
 * Cortes exatos, movimento por tomada (zoom/pan/pico-média/easing/pancadas), modo dominante,
 * transições e faixa de legenda → ReferenceTemplate.
 */
export function measureReference(gray: Gray[], times: number[], rgb: RgbFrame[] | RgbFrame[][] = [], opts: { duration?: number; color?: ReferenceTemplate['color']; weak?: boolean } = {}): ReferenceMeasure {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = Math.min(gray.length, times.length);
  // faixa de legenda primeiro: ela fica parada enquanto o fundo mexe e atrapalha o alinhamento
  const captions = detectCaptionBand(rgb);
  const mask = captions ? { y0: Math.max(0, captions.region.y0 - 0.03), y1: Math.min(1, captions.region.y1 + 0.03) } : undefined;
  const ao: AlignOpts = { sMin: 0.94, sMax: 1.1, shift: opts.weak ? 2 : 3, mask };
  const pairs: PairMotion[] = [];
  for (let i = 1; i < n; i++) pairs.push(alignPair(gray[i - 1], gray[i], ao));
  const track: MotionTrack = { times: times.slice(0, n), pairs };
  const hard = detectCuts(track);
  const events = transitionEvents(track, hard, gray.slice(0, n).map(meanLum), gray);
  // um dissolver também troca de tomada: o meio dele é um limite (antes a tomada atravessava o
  // dissolver, o ritmo sumia e o zoom da tomada media a mistura das duas cenas)
  const fades = events.filter((e) => e.kind === 'crossfade');
  const cuts: number[] = [];
  for (const c of [...hard, ...fades.map((f) => r3(f.t))].sort((a, b) => a - b)) if (!cuts.length || c - cuts[cuts.length - 1] >= 0.25) cuts.push(c);
  const duration = opts.duration ?? (n ? times[n - 1] + (n > 1 ? times[n - 1] - times[n - 2] : 0.1) / 2 : 0);
  const frame = { w: gray[0]?.w ?? 108, h: gray[0]?.h ?? 192 };
  const perShot = shotMotions(track, cuts, frame, fades.map((f) => ({ a: f.t - f.duration / 2, b: f.t + f.duration / 2 })));
  // tomadas começam em 0 e terminam na duração (a amostragem começa/termina meio passo para dentro)
  if (perShot.length) { perShot[0].start = 0; perShot[perShot.length - 1].end = r3(duration); }
  const motion = summarizeMotion(perShot);
  const shots = [0, ...cuts].map((s, i, a) => ({ start: r3(s), end: r3(i + 1 < a.length ? a[i + 1] : duration) })).filter((s) => s.end > s.start);
  const transitions = summarizeTransitions(events, hard.length);
  const template: ReferenceTemplate = {
    shots,
    shotStats: shotStatsOf(shots.length > 3 ? shots.slice(1, -1) : shots),
    motion,
    transitions,
    color: opts.color ?? { r: 0.5, g: 0.5, b: 0.5, sat: 0.3, lum: 0.5 },
    ...(captions ? { captions } : {}),
  };
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { cuts, template, ms: Math.round(t1 - t0) };
}

/** fração dos cortes a ±80 ms de uma batida */
export function cutsOnBeatsRatio(cuts: number[], beats: number[], tol = 0.08): number {
  if (!cuts.length || !beats.length) return 0;
  return r3(cuts.filter((c) => beats.some((b) => Math.abs(b - c) <= tol)).length / cuts.length);
}
