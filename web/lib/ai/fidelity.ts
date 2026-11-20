/* =====================================================================
   Fidelidade ao vídeo modelo (puro + medição de cor no navegador):
   compara o RESULTADO com o molde medido (StyleProfile.template) aspecto por aspecto
   - ritmo: mediana/p90 das tomadas e cortes por 10 s
   - movimento: modo, zoom por tomada e suavidade (pico/média e px/quadro)
   - transições: só os tipos do modelo, na frequência dele
   - legenda: posição y, cor do texto (ΔE), caixa sim/não, maiúsculas
   - cor: ΔE entre a cor média do resultado renderizado e a do modelo
   Abaixo de 0,8 num aspecto → uma rodada de conserto (repairOps, determinístico).
   ===================================================================== */
import type { CaptionStyle, Keyframe, MediaAsset, Project, ReferenceTemplate, StyleProfile, VideoClip } from '../types';
import { interpolateTransform } from '../engine/easing';
import type { EditOp } from '../ops';
import { edgePxPerFrame } from './motion';
import { motionSpecOf, templateCaptionStyle, templateOps } from './template';

export type FidelityAspect = 'ritmo' | 'movimento' | 'transicoes' | 'legenda' | 'cor';
export interface Fidelity {
  scores: Partial<Record<FidelityAspect, number>>;
  /** o que está diferente (PT-BR), por aspecto */
  deltas: Partial<Record<FidelityAspect, string>>;
  min: number;
}

export const FIDELITY_MIN = 0.8;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

function mainClips(p: Project): VideoClip[] {
  const track = p.tracks.find((t) => t.kind === 'video');
  return (track?.clips.filter((c): c is VideoClip => c.type === 'video') ?? []).sort((a, b) => a.start - b.start);
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
/** 1 quando a razão é 1; cai para 0 quando dobra/metade */
const ratioScore = (a: number, b: number) => (a > 0 && b > 0 ? clamp01(1 - Math.abs(Math.log(a / b)) / Math.log(2)) : 0);

/* ---------- cor ---------- */

function hexRgb(h: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** sRGB 0..1 → Lab (D65) */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const la = rgbToLab(...a), lb = rgbToLab(...b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
const deScore = (de: number, full = 4, zero = 30) => clamp01(1 - (de - full) / (zero - full));

/* ---------- movimento do resultado ---------- */

/** zoom total e pico/média da velocidade de escala de um clipe (amostrado a 10/s) */
export function clipMotion(c: VideoClip): { zoomTotal: number; peakOverMean: number; px: number } {
  const kf = c.keyframes?.filter((k) => typeof k.transform.scale === 'number') ?? [];
  if (kf.length < 2 || c.duration <= 0.1) return { zoomTotal: 1, peakOverMean: 1, px: 0 };
  const n = Math.max(3, Math.round(c.duration * 10));
  const v: number[] = [];
  let prev = interpolateTransform(c.transform, kf, 0).scale;
  const first = prev;
  for (let i = 1; i <= n; i++) {
    const s = interpolateTransform(c.transform, kf, (c.duration * i) / n).scale;
    v.push(Math.abs(Math.log(s / prev)));
    prev = s;
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { zoomTotal: prev / first, peakOverMean: mean > 1e-6 ? Math.max(...v) / mean : 1, px: edgePxPerFrame(c.keyframes as Keyframe[], c.duration) };
}

/** quantas rampas de escala bruscas (>8 px/quadro) o clipe tem */
export function punchCount(c: VideoClip): number {
  const kf = (c.keyframes ?? []).filter((k) => typeof k.transform.scale === 'number').sort((a, b) => a.t - b.t);
  let n = 0;
  for (let i = 1; i < kf.length; i++) {
    const ds = Math.abs((kf[i].transform.scale ?? 1) - (kf[i - 1].transform.scale ?? 1));
    const dt = kf[i].t - kf[i - 1].t;
    if (ds > 0.05 && dt > 0 && (540 * ds * 3) / (30 * dt) > 8) n++;
  }
  return n;
}

/* ---------- fidelidade ---------- */

/**
 * Compara o projeto editado com o molde. `resultColor` = cor média medida no render (0..1); sem ela,
 * a cor vale pelo que foi aplicado (colorGrade casado sem preset por cima).
 */
export function fidelityOf(p: Project, style: StyleProfile, resultColor?: { r: number; g: number; b: number }): Fidelity | undefined {
  const t = style.template;
  if (!t) return undefined;
  const clips = mainClips(p);
  if (!clips.length) return undefined;
  const scores: Fidelity['scores'] = {};
  const deltas: Fidelity['deltas'] = {};

  // ritmo (a 1ª/última tomada podem ser sobra: entram só se houver poucas)
  const durs = clips.map((c) => c.duration);
  const inner = durs.length > 4 ? durs.slice(1, -1) : durs;
  const refInner = t.shots.length > 4 ? t.shots.slice(1, -1) : t.shots;
  const refDur = refInner.map((s) => s.end - s.start);
  const total = durs.reduce((a, b) => a + b, 0);
  const refTotal = t.shots.reduce((a, s) => a + s.end - s.start, 0);
  const cps = (clips.length - 1) / Math.max(1, total) * 10, refCps = (t.shots.length - 1) / Math.max(1, refTotal) * 10;
  const mMed = ratioScore(median(inner), t.shotStats.median || median(refDur));
  const mP90 = ratioScore(quantile(inner, 0.9), t.shotStats.p90 || quantile(refDur, 0.9));
  const mCps = refCps > 0 ? ratioScore(Math.max(0.01, cps), refCps) : clips.length === 1 ? 1 : 0.5;
  scores.ritmo = r2(0.5 * mMed + 0.2 * mP90 + 0.3 * mCps);
  if (scores.ritmo < FIDELITY_MIN) deltas.ritmo = `tomadas com mediana de ${fmt(median(inner))} s (modelo: ${fmt(t.shotStats.median)} s), ${fmt(cps)} cortes por 10 s (modelo: ${fmt(refCps)})`;

  // movimento
  const spec = motionSpecOf(style);
  const ms = clips.map(clipMotion);
  const moving = ms.filter((m) => Math.abs(Math.log(m.zoomTotal)) > 0.01);
  const refMag = Math.abs(Math.log(t.motion.avgZoomPerShot)) || 0.06;
  if (spec.mode === 'static' || spec.mode === 'handheld') {
    scores.movimento = r2(1 - moving.length / clips.length);
    if (scores.movimento < FIDELITY_MIN) deltas.movimento = `o modelo tem câmera parada e ${moving.length} tomada(s) ganharam zoom`;
  } else if (spec.mode === 'punch') {
    // pancadas por segundo no resultado × no modelo (pancada = rampa de escala >8 px/quadro)
    const refRate = t.motion.perShot.reduce((a, x) => a + x.punches, 0) / Math.max(1, refTotal);
    const hits = clips.reduce((a, c) => a + punchCount(c), 0);
    const rate = hits / Math.max(1, total);
    const rateScore = refRate > 0 ? ratioScore(Math.max(1e-3, rate), refRate) : hits ? 1 : 0;
    const peak = Math.max(1, ...clips.flatMap((c) => (c.keyframes ?? []).map((k) => k.transform.scale ?? 1)));
    const magS = clamp01(1 - Math.abs(Math.log(Math.log(Math.max(1.001, peak)) / Math.max(0.05, refMag))) / Math.log(3));
    scores.movimento = r2(0.7 * rateScore + 0.3 * magS);
    if (scores.movimento < FIDELITY_MIN) deltas.movimento = `${fmt(rate * 10)} pancadas por 10 s (modelo: ${fmt(refRate * 10)}), zoom máx. ${pct(peak - 1)}`;
  } else if (spec.mode === 'pan') {
    // movimento lateral: a escala fica parada (zoom fixo p/ não mostrar borda) — conta a deriva em x
    const pans = clips.filter((c) => {
      const kf = c.keyframes?.filter((k) => typeof k.transform.x === 'number') ?? [];
      if (kf.length < 2) return false;
      const a = interpolateTransform(c.transform, kf, 0).x, b = interpolateTransform(c.transform, kf, c.duration).x;
      return Math.abs(b - a) > 0.01;
    });
    const share = pans.length / clips.length;
    const smooth = pans.length ? pans.filter((c) => edgePxPerFrame(c.keyframes as Keyframe[], c.duration) <= 8.5).length / pans.length : 0;
    scores.movimento = r2(0.6 * share + 0.4 * smooth);
    if (scores.movimento < FIDELITY_MIN) deltas.movimento = `${pans.length}/${clips.length} tomadas com movimento lateral (modelo: em todas)`;
  } else {
    const share = moving.length / clips.length;
    const mag = median(moving.map((m) => Math.abs(Math.log(m.zoomTotal))));
    const magScore = moving.length ? clamp01(1 - Math.abs(Math.log(Math.max(1e-3, mag) / refMag)) / Math.log(3)) : 0;
    // suave: ≤8 px/quadro (folga de meio px)
    const smoothScore = moving.length ? moving.filter((m) => m.px <= 8.5).length / moving.length : 0;
    scores.movimento = r2(0.35 * share + 0.35 * magScore + 0.3 * smoothScore);
    if (scores.movimento < FIDELITY_MIN) {
      deltas.movimento = `${moving.length}/${clips.length} tomadas com movimento, zoom típico ${pct(Math.exp(mag) - 1)} (modelo: ${pct(t.motion.avgZoomPerShot - 1)}), ${ms.filter((m) => m.px > 8.5).length} tomada(s) bruscas (>8 px/quadro)`;
    }
  }

  // transições
  const refKinds = new Set(t.transitions.filter((x) => x.kind !== 'cut' && x.frequency > 0.05).map((x) => x.kind));
  const used = clips.slice(1).map((c) => c.transitionIn?.kind).filter((k): k is NonNullable<typeof k> => !!k);
  const extra = used.filter((k) => !refKinds.has(k as never)).length;
  if (!refKinds.size) {
    scores.transicoes = r2(clips.length > 1 ? 1 - extra / (clips.length - 1) : 1);
    if (scores.transicoes < FIDELITY_MIN) deltas.transicoes = `o modelo só tem cortes secos e ${extra} corte(s) ganharam transição`;
  } else {
    const refFreq = t.transitions.filter((x) => refKinds.has(x.kind)).reduce((a, x) => a + x.frequency, 0);
    const freq = clips.length > 1 ? used.filter((k) => refKinds.has(k as never)).length / (clips.length - 1) : 0;
    scores.transicoes = r2(clamp01(1 - Math.abs(freq - refFreq)) * (clips.length > 1 ? 1 - extra / (clips.length - 1) : 1));
    if (scores.transicoes < FIDELITY_MIN) deltas.transicoes = `transições em ${pct(freq)} dos cortes (modelo: ${pct(refFreq)})${extra ? `, ${extra} de tipo que o modelo não usa` : ''}`;
  }

  // legenda
  if (t.captions) {
    const cs: CaptionStyle = p.captions.style;
    const want = templateCaptionStyle(t)!;
    const dy = Math.abs((cs.position?.y ?? 0.8) - (want.position?.y ?? 0.75));
    const ct = hexRgb(cs.color ?? '#FFFFFF'), wt = hexRgb(t.captions.textColor);
    const de = ct && wt ? deltaE([ct[0] / 255, ct[1] / 255, ct[2] / 255], [wt[0] / 255, wt[1] / 255, wt[2] / 255]) : 50;
    const hasBox = !!(cs.background && cs.background !== 'transparent' && cs.background !== '') || !!cs.wordBox;
    const boxOk = hasBox === !!t.captions.boxColor;
    scores.legenda = r2(0.35 * clamp01(1 - dy / 0.15) + 0.35 * deScore(de) + 0.2 * (boxOk ? 1 : 0) + 0.1 * (t.captions.uppercase === undefined || !!cs.uppercase === t.captions.uppercase ? 1 : 0));
    if (scores.legenda < FIDELITY_MIN) deltas.legenda = `legenda em y=${fmt(cs.position?.y ?? 0)} (modelo ${fmt(want.position?.y ?? 0)}), cor ${cs.color} (modelo ${t.captions.textColor}), caixa ${hasBox ? 'sim' : 'não'} (modelo ${t.captions.boxColor ? 'sim' : 'não'})`;
  }

  // cor
  const graded = clips.every((c) => c.colorGrade && Object.keys(c.colorGrade).length);
  const stacked = clips.some((c) => c.colorPreset && c.colorPreset !== 'none');
  if (resultColor) {
    const de = deltaE([resultColor.r, resultColor.g, resultColor.b], [t.color.r, t.color.g, t.color.b]);
    scores.cor = r2(deScore(de, 3, 25) * (stacked ? 0.85 : 1));
    if (scores.cor < FIDELITY_MIN) deltas.cor = `cor média com ΔE ${de.toFixed(0)} da do modelo${stacked ? ' (há um look de cor por cima do casamento)' : ''}`;
  } else {
    scores.cor = graded ? (stacked ? 0.7 : 0.9) : stacked ? 0.6 : 0.5;
    if (scores.cor < FIDELITY_MIN) deltas.cor = graded ? 'look de cor empilhado sobre a cor casada' : 'a cor não foi casada com o modelo';
  }

  const vals = Object.values(scores) as number[];
  return { scores, deltas, min: vals.length ? Math.min(...vals) : 1 };
}

/** "Fidelidade ao modelo: ritmo 92%, movimento 88%, legenda 95%, cor 90%" */
export function fidelityLine(f: Fidelity): string {
  const names: Record<FidelityAspect, string> = { ritmo: 'ritmo', movimento: 'movimento', transicoes: 'transições', legenda: 'legenda', cor: 'cor' };
  const parts = (Object.keys(names) as FidelityAspect[]).filter((k) => f.scores[k] !== undefined).map((k) => `${names[k]} ${pct(f.scores[k]!)}`);
  return `Fidelidade ao modelo: ${parts.join(', ')}`;
}

/** aspectos abaixo do mínimo */
export function failing(f: Fidelity): FidelityAspect[] {
  return (Object.keys(f.scores) as FidelityAspect[]).filter((k) => (f.scores[k] ?? 1) < FIDELITY_MIN);
}

/**
 * Uma rodada de conserto determinística para os aspectos que falharam (vale para demo e Claude):
 * refaz só aquele aspecto com templateOps. A cor fica com o casamento (o pipeline refaz se precisar).
 */
export function repairOps(p: Project, style: StyleProfile, aspects: FidelityAspect[]): EditOp[] {
  const want = new Set(aspects);
  if (!want.size) return [];
  const ops: EditOp[] = [];
  if (want.has('cor')) {
    // tira looks empilhados sobre a cor casada
    for (const c of mainClips(p)) if (!c.locked && c.colorPreset && c.colorPreset !== 'none') ops.push({ op: 'update_clip', clipId: c.id, patch: { colorPreset: 'none' }, explain: 'Tirando o look a mais (a cor vem do modelo)' });
  }
  const t = templateOps(p, style, { cut: want.has('ritmo'), motion: want.has('movimento') || want.has('ritmo'), transitions: want.has('transicoes') || want.has('ritmo'), captions: want.has('legenda') });
  return [...ops, ...t.ops];
}

/* ---------- navegador: cor média do resultado renderizado ---------- */

/** renderiza ~4 quadros pequenos (108 px) do resultado e devolve a cor média 0..1 */
export async function renderedColor(p: Project, assets: Record<string, MediaAsset>, times: number[]): Promise<{ r: number; g: number; b: number } | undefined> {
  if (typeof document === 'undefined' || !times.length) return undefined;
  const [{ OfflineMediaPool }, { renderFrame }, { visualLayers, sourceTime }] = await Promise.all([
    import('../export/mediaPool'), import('../engine'), import('../engine/timing'),
  ]);
  const scale = 192 / Math.max(p.width, p.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(p.width * scale));
  canvas.height = Math.max(2, Math.round(p.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  const pool = new OfflineMediaPool(assets);
  const acc = { r: 0, g: 0, b: 0, n: 0 };
  // sem legendas/textos: a cor é da imagem
  const plain: Project = { ...p, captions: { ...p.captions, enabled: false }, tracks: p.tracks.filter((tr) => tr.kind === 'video' || tr.kind === 'effect') };
  try {
    await pool.preloadImages();
    for (const t of times) {
      const plan = visualLayers(plain, t).filter((l) => l.clip.type === 'video').map((l) => ({ clip: l.clip, time: sourceTime(l.clip, t) }));
      await pool.prepare(plan);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderFrame(ctx, plain, t, pool);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < d.length; i += 16) { acc.r += d[i]; acc.g += d[i + 1]; acc.b += d[i + 2]; acc.n++; }
    }
  } catch (e) {
    console.warn('[ai/fidelity] não consegui renderizar o resultado:', e);
    return undefined;
  } finally {
    pool.dispose();
  }
  return acc.n ? { r: acc.r / acc.n / 255, g: acc.g / acc.n / 255, b: acc.b / acc.n / 255 } : undefined;
}

export type { ReferenceTemplate };
