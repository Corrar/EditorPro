/* =====================================================================
   Whisper -> legendas (puro, testado):
   - agrupa palavras (chunks com timestamp por palavra) em frases curtas
   - escolhe pontos de corte silenciosos para processar o áudio em pedaços
   Tempos continuam NA MÍDIA (timemap.ts converte para a timeline).
   ===================================================================== */
import type { CaptionSegment, CaptionWord } from '../types';
import { sanitizeTranscript } from './sanitize';

export interface WhisperChunk { text: string; timestamp: [number, number | null] }

/** palavras do Whisper -> CaptionSegment[] (frases de até ~maxWords / ~maxDur s, quebrando em pausas e pontuação) */
export function wordsToSegments(chunks: WhisperChunk[], opts: { duration: number; maxWords?: number; maxDur?: number; pauseGap?: number } = { duration: 0 }): CaptionSegment[] {
  const maxWords = opts.maxWords ?? 7;
  const maxDur = opts.maxDur ?? 3.6;
  const gap = opts.pauseGap ?? 0.6;
  const words: CaptionWord[] = [];
  for (const c of chunks) {
    const text = (c.text ?? '').trim();
    const s = c.timestamp?.[0];
    if (!text || typeof s !== 'number' || !Number.isFinite(s)) continue;
    let e = c.timestamp[1];
    if (typeof e !== 'number' || !Number.isFinite(e) || e <= s) e = s + Math.max(0.2, text.length * 0.06);
    // Whisper às vezes devolve "palavras" que são só pontuação: cola na anterior
    if (/^[.,!?;:…]+$/.test(text) && words.length) {
      words[words.length - 1] = { ...words[words.length - 1], text: words[words.length - 1].text + text };
      continue;
    }
    words.push({ start: s, end: e, text });
  }
  words.sort((a, b) => a.start - b.start);

  const segs: { start: number; end: number; text: string; words: CaptionWord[] }[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    segs.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  /** frase longa demais: quebra no MELHOR ponto da segunda metade (vírgula > maior pausa), não onde o limite bateu */
  const splitLong = () => {
    const n = cur.length;
    let best = -1;
    let bestScore = -Infinity;
    // cabeça e rabo com ≥2 palavras; vírgula e pausa valem, desequilíbrio pesa; nunca quebra depois de artigo/preposição/número
    for (let i = 1; i < n - 2; i++) {
      const pause = cur[i + 1].start - cur[i].end;
      const glue = /^(o|a|os|as|um|uma|de|da|do|das|dos|em|no|na|nos|nas|e|ou|que|com|por|para|pra|ao|à|\d+)$/i.test(cur[i].text.replace(/[^\p{L}\d]/gu, ''));
      const score = (/[,;:—–]$/.test(cur[i].text) ? 1.2 : 0) + Math.min(1, pause / 0.3) - 1.2 * Math.abs((i + 1) / n - 0.5) - (glue ? 1.5 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return flush();
    const rest = cur.slice(best + 1);
    cur = cur.slice(0, best + 1);
    flush();
    cur = rest;
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && w.start - last.end > gap) flush();
    else if (last && (cur.length >= maxWords || w.end - cur[0].start > maxDur)) splitLong();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  // sobra de 1–2 palavras colada na frase anterior (sem pausa entre elas) → junta: nada de "receitas." sozinha
  for (let i = segs.length - 1; i > 0; i--) {
    const a = segs[i - 1], b = segs[i];
    if (b.words.length > 2 || /[.!?…]$/.test(a.text) || b.start - a.end > gap) continue;
    if (a.words.length + b.words.length > maxWords + 3 || b.end - a.start > maxDur + 2) continue;
    segs.splice(i - 1, 2, { start: a.start, end: b.end, text: `${a.text} ${b.text}`, words: [...a.words, ...b.words] });
  }
  return sanitizeTranscript({ segments: segs }, { duration: opts.duration, maxSegment: maxDur + 2, maxWordsPerSegment: maxWords + 3 });
}

/** pedaços de ~`target` s, cortando no ponto mais silencioso dos últimos `search` s de cada janela */
export function splitPoints(samples: Float32Array, sampleRate: number, target = 60, search = 6): number[] {
  const total = samples.length / sampleRate;
  const points: number[] = [0];
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  let t = 0;
  while (total - t > target + search) {
    const from = Math.floor((t + target - search) * sampleRate);
    const to = Math.floor((t + target) * sampleRate);
    let best = to;
    let bestE = Infinity;
    for (let i = from; i + win <= to; i += win) {
      let e = 0;
      for (let k = i; k < i + win; k++) e += samples[k] * samples[k];
      if (e < bestE) { bestE = e; best = i + Math.floor(win / 2); }
    }
    t = best / sampleRate;
    points.push(t);
  }
  points.push(total);
  return points;
}

/**
 * "parece fala?" — fala tem energia que oscila sílaba a sílaba; tom contínuo, zumbido ou
 * silêncio não. Evita mandar ao Whisper trechos que o fazem alucinar/entrar em loop.
 */
export function speechLikely(samples: Float32Array, sampleRate: number): boolean {
  const hop = Math.max(1, Math.round(sampleRate * 0.03));
  const rms: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += samples[k] * samples[k];
    rms.push(Math.sqrt(s / hop));
  }
  if (rms.length < 10) return false;
  const peak = Math.max(...rms);
  if (peak < 0.005) return false; // silêncio
  const loud = rms.filter((r) => r > peak * 0.1);
  if (loud.length < rms.length * 0.08) return false;
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length;
  const sd = Math.sqrt(loud.reduce((a, b) => a + (b - mean) ** 2, 0) / loud.length);
  // variação rápida entre janelas vizinhas (modulação silábica)
  let jitter = 0;
  for (let i = 1; i < loud.length; i++) jitter += Math.abs(loud[i] - loud[i - 1]);
  jitter /= (loud.length - 1) * mean;
  return sd / mean > 0.25 && jitter > 0.08;
}

const normTok = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/** distância de edição normalizada entre duas palavras (0 = iguais, 1 = nada em comum) */
function wordDist(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n] / Math.max(m, n);
}

/**
 * Correção do TEXTO de uma legenda mantendo os tempos reais da fala (plano §1.6): alinha as palavras
 * novas às antigas (Levenshtein por palavra); palavra mantida/corrigida herda tempo e id da antiga,
 * palavra inserida divide o tempo com a vizinha, palavra removida some sem mexer nas outras.
 */
export function alignWordTimes(old: CaptionWord[], tokens: string[], newId: () => string): CaptionWord[] {
  const A = old.map((w) => normTok(w.text)), B = tokens.map(normTok);
  const m = A.length, n = B.length;
  if (!m) return [];
  // DP: custo de substituição = distância entre as palavras (corrigir grafia é barato)
  const D: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + wordDist(A[i - 1], B[j - 1]) * 1.2);
  }
  const link: (number | null)[] = new Array(n).fill(null);
  for (let i = m, j = n; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + wordDist(A[i - 1], B[j - 1]) * 1.2)) < 1e-9) { link[j - 1] = i - 1; i--; j--; }
    else if (j > 0 && (i === 0 || Math.abs(D[i][j] - (D[i][j - 1] + 1)) < 1e-9)) j--;
    else i--;
  }
  const out: CaptionWord[] = tokens.map((t, j) => {
    const k = link[j];
    return k !== null ? { ...old[k], text: t } : { id: newId(), text: t, start: NaN, end: NaN };
  });
  // inseridas: dividem o tempo da palavra âncora anterior (ou da seguinte, no começo)
  for (let j = 0; j < n;) {
    if (!Number.isNaN(out[j].start)) { j++; continue; }
    let k = j;
    while (k < n && Number.isNaN(out[k].start)) k++;
    const anchor = j > 0 ? j - 1 : k < n ? k : -1;
    const group = anchor < j ? [anchor, ...range(j, k)] : [...range(j, k), anchor];
    const a = anchor >= 0 ? out[anchor] : { start: old[0].start, end: old[m - 1].end };
    const weights = group.map((g) => Math.max(2, tokens[g].length));
    const total = weights.reduce((x, y) => x + y, 0);
    let t = a.start;
    group.forEach((g, gi) => {
      const d = ((a.end - a.start) * weights[gi]) / total;
      out[g] = { ...out[g], start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 };
      t += d;
    });
    j = k;
  }
  return out;
}
function range(a: number, b: number): number[] { const r: number[] = []; for (let i = a; i < b; i++) r.push(i); return r; }
