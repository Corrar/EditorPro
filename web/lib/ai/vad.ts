/* =====================================================================
   VAD barato (energia) + correção de tempo das palavras do Whisper.
   Puro, sem modelo. Medido (plano 2026-11-19 §1.3): o Whisper base marca o
   início das palavras ~0,15–0,22 s ATRASADO e deixa a última palavra antes
   de uma pausa "pendurada" no silêncio. Aqui:
   - energyRuns: trechos com voz (RMS dB em saltos de 10 ms, limiar adaptativo)
   - refineWordTimes: estima o atraso pelos inícios de fala, desloca tudo,
     encaixa inícios/fins nas bordas de voz e limita palavras "esticadas".
   ===================================================================== */
import type { WhisperChunk } from './words';

export interface Range { start: number; end: number }

const HOP_S = 0.01;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** RMS em dB por janela de 10 ms */
export function frameDb(samples: Float32Array, rate = 16000): number[] {
  const hop = Math.max(1, Math.round(rate * HOP_S));
  const out: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += samples[k] * samples[k];
    out.push(20 * Math.log10(Math.sqrt(s / hop) + 1e-7));
  }
  return out;
}

/**
 * trechos com voz/som: limiar clamp(p10 + 0,3·(p90−p10), −60, −18) dB,
 * buracos < 80 ms fechados (oclusivas), ilhas < 50 ms removidas.
 */
export function energyRuns(samples: Float32Array, rate = 16000, opts: { bridge?: number; minIsland?: number } = {}): Range[] {
  const db = frameDb(samples, rate);
  if (!db.length) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const p10 = percentile(sorted, 0.1), p90 = percentile(sorted, 0.9), p99 = percentile(sorted, 0.99);
  // áudio todo muito baixo: nada de voz
  if (p99 < -60) return [];
  // fala ocupando < 10% do arquivo (2 s em 60 s): o p90 cai no silêncio → usa o p99 como nível da voz
  const top = p99 - p90 > 20 ? p99 : p90;
  const thr = Math.min(-18, Math.max(-60, p10 + 0.3 * (top - p10)));
  const bridge = Math.round((opts.bridge ?? 0.08) / HOP_S);
  const minIsland = Math.round((opts.minIsland ?? 0.05) / HOP_S);
  const runs: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= db.length; i++) {
    const v = i < db.length && db[i] > thr;
    if (v && s < 0) s = i;
    if (!v && s >= 0) { runs.push([s, i]); s = -1; }
  }
  const merged: [number, number][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < bridge) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minIsland).map(([a, b]) => ({ start: a * HOP_S, end: b * HOP_S }));
}

/** segundos totais com voz */
export function speechSeconds(runs: Range[]): number {
  return runs.reduce((n, r) => n + Math.max(0, r.end - r.start), 0);
}

/** fração de [a,b] coberta pelos trechos */
export function overlapFraction(runs: Range[], a: number, b: number): number {
  if (b <= a) return 0;
  let cov = 0;
  for (const r of runs) {
    if (r.end <= a) continue;
    if (r.start >= b) break;
    cov += Math.min(b, r.end) - Math.max(a, r.start);
  }
  return cov / (b - a);
}

/** desloca trechos (tempo do pedaço -> tempo da mídia) */
export function offsetRuns(runs: Range[], dt: number): Range[] {
  return runs.map((r) => ({ start: r.start + dt, end: r.end + dt }));
}

function nearest(values: number[], t: number, lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (v < t + lo || v > t + hi) continue;
    if (best === null || Math.abs(v - t) < Math.abs(best - t)) best = v;
  }
  return best;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const letters = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, '').length;

export interface RefineReport { lag: number; samples: number; snappedStart: number; snappedEnd: number }

/**
 * Corrige os tempos das palavras pela energia do áudio.
 * Entradas e saídas no MESMO relógio (segundos da mídia), `runs` também.
 */
export function refineWordTimes(chunks: WhisperChunk[], runs: Range[], report?: (r: RefineReport) => void): WhisperChunk[] {
  const words = chunks
    .map((c) => {
      const text = c.text ?? '';
      const s = c.timestamp[0];
      let e = c.timestamp[1];
      if (typeof e !== 'number' || !Number.isFinite(e) || e < s) e = s;
      return { text, s, e };
    })
    .filter((w) => Number.isFinite(w.s))
    .sort((a, b) => a.s - b.s);
  if (!words.length) { report?.({ lag: 0, samples: 0, snappedStart: 0, snappedEnd: 0 }); return []; }
  const onsets = runs.map((r) => r.start);
  const offsets = runs.map((r) => r.end);

  // 1) atraso típico: palavras que começam logo depois de um início de fala
  let lag = 0;
  const offs: number[] = [];
  if (runs.length) {
    for (const w of words) {
      const o = nearest(onsets, w.s, -0.45, 0.05);
      if (o !== null) offs.push(w.s - o);
    }
    if (offs.length >= 3) lag = Math.min(0.4, Math.max(0, median(offs)));
  }

  let snappedStart = 0, snappedEnd = 0;
  const out = words.map((w) => {
    const chars = letters(w.text);
    let s = w.s - lag;
    let e = w.e - lag;
    if (runs.length && overlapFraction(runs, s, Math.max(e, s + 0.05)) === 0) {
      // palavra caída no silêncio logo depois de uma fala: encosta no fim dessa fala
      let prevEnd = -Infinity;
      for (const r of runs) if (r.end <= s && r.end > prevEnd) prevEnd = r.end;
      if (s - prevEnd <= 1.5) {
        const d = Math.min(Math.max(0.12, e - s), Math.max(0.3, 0.075 * chars + 0.25));
        return { text: w.text, s: Math.max(0, prevEnd - d), e: prevEnd };
      }
    }
    if (runs.length) {
      const o = nearest(onsets, s, -0.15, 0.15);
      if (o !== null) { s = o; snappedStart++; }
      const f = nearest(offsets, e, -0.25, 0.25);
      if (f !== null && f > s) { e = f; snappedEnd++; }
      else e = Math.min(e, s + Math.max(0.3, 0.075 * chars + 0.25)); // sem borda: palavra não fica pendurada
    }
    if (e - s <= 1e-3) e = s + Math.max(0.12, 0.06 * chars);
    return { text: w.text, s: Math.max(0, s), e: Math.max(0, e) };
  });
  // 1b) última palavra antes de uma pausa vai até o fim do trecho de voz dela (Whisper encurta "quarenta" → "40")
  if (runs.length) {
    for (let i = 0; i < out.length; i++) {
      const w = out[i], nx = out[i + 1];
      if (nx && nx.s - w.e <= 0.15) continue;
      const r = runs.find((x) => x.start <= w.s + 0.05 && x.end >= w.s);
      if (r && r.end > w.e && r.end - w.s <= 1.5 && (!nx || r.end <= nx.s - 0.02)) w.e = r.end;
    }
  }
  // 2) ordem monotônica, mínimo de 0,06 s por palavra, sem sobreposição
  for (let i = 1; i < out.length; i++) {
    out[i].s = Math.max(out[i].s, out[i - 1].s + 0.06);
    out[i].e = Math.max(out[i].e, out[i].s + 0.06);
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].e > out[i + 1].s) out[i].e = Math.max(out[i].s + 0.05, out[i + 1].s);
  }
  report?.({ lag, samples: offs.length, snappedStart, snappedEnd });
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return out.map((w) => ({ text: w.text, timestamp: [r3(w.s), r3(w.e)] as [number, number] }));
}
