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
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end > gap || cur.length >= maxWords || w.end - cur[0].start > maxDur)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
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
