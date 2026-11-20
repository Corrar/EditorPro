/* =====================================================================
   Duração pedida no brief ("Reels de 20s", "até 15 s", "1 minuto") e o
   ajuste da edição a ela (puro, testado):
   1) encurta primeiro o que NÃO tem fala (b-roll, respiros longos);
   2) depois tira frases inteiras, as menos importantes, cortando sempre nos
      respiros entre palavras (nunca no meio de uma palavra);
   3) o gancho (1ª frase / primeiros segundos) nunca sai.
   ===================================================================== */
import type { CaptionWord, Project, Seconds } from '../types';
import { allWords, projectDuration, type EditOp } from '../ops';
import { r3 } from './sanitize';

export interface TimeRange { start: Seconds; end: Seconds }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (s: string) => Number(s.replace(',', '.'));

/** números de tempo que NÃO são a duração do vídeo ("primeiros 3 s", "a cada 2 s", "pausas acima de 1 s"…) */
const NOT_TOTAL_BEFORE = /(primeir\w*|ultim\w*|cada|pausas?|silencios?|respiros?|maior(?:es)? que|acima de|menor(?:es)? que|abaixo de|mais de|menos de|tomadas? de|cortes? de|trechos? de|transic\w*(?: de)?|fade\w*(?: de)?|zoom(?: de)?|depois de|antes de|a partir d[eo]|aos|no segundo|do segundo|\d+(?:[.,]\d+)?\s*(?:a|ate|-|e))\s*$/;
const NOT_TOTAL_AFTER = /^\s*(?:de (?:pausa|silencio|respiro)|cada|por (?:corte|tomada|clipe|cena))/;

/**
 * Duração total pedida no texto, em segundos: "20s", "20 segundos", "30 s", "1 minuto", "1 min e 30 s",
 * "meio minuto", "até 15s". Ignora tempos que são de outra coisa ("corta os primeiros 3 s", "a cada 2 s").
 */
export function targetDurationFromText(text: string): Seconds | undefined {
  const t = strip(text);
  if (/\bmeio minuto\b/.test(t)) return 30;
  const re = /(\d+(?:[.,]\d+)?)\s*(?:(min|mins|minutos?)\b(?:\s*(?:e\s*)?(\d+)\s*(?:s|seg|segs|segundos?)\b)?|(s|seg|segs|segundos?|")(?![a-z]))/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t.slice(Math.max(0, m.index - 32), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (NOT_TOTAL_BEFORE.test(before) || NOT_TOTAL_AFTER.test(after)) continue;
    const sec = m[2] ? num(m[1]) * 60 + (m[3] ? Number(m[3]) : 0) : num(m[1]);
    if (sec >= 3 && sec <= 600) return r3(sec);
  }
  return undefined;
}

/* ---------- frases (pelas palavras da legenda) ---------- */

export interface Phrase { start: Seconds; end: Seconds; words: CaptionWord[] }

const FILLER = /^(ne|tipo|hum+|hm+|uh+|ah+|eh+|entao|assim|ai|bom|sabe)$/;
const normWord = (w: string) => strip(w).replace(/[^a-z0-9]/g, '');

/** quebra a fala em frases: pontuação final (. ! ? …) ou respiro ≥ 0,6 s; frase longa (>7 s) também na vírgula */
export function phrasesOf(words: CaptionWord[]): Phrase[] {
  const ws = words.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const out: Phrase[] = [];
  let cur: CaptionWord[] = [];
  const close = () => { if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (cur.length && w.start - cur[cur.length - 1].end >= 0.6) close();
    cur.push(w);
    const txt = w.text.trim();
    const long = cur.length > 1 && w.end - cur[0].start > 7;
    if (/[.!?…]["”']?$/.test(txt) || (long && /[,;:]$/.test(txt))) close();
  }
  close();
  return out;
}

/** quanto a frase importa (maior = fica): fala densa, pergunta/exclamação, números, palavras do pedido; vícios pesam contra */
function phraseScore(ph: Phrase, i: number, n: number, keywords: Set<string>): number {
  const dur = Math.max(0.3, ph.end - ph.start);
  const toks = ph.words.map((w) => normWord(w.text));
  let s = Math.min(4, toks.length / dur) * 0.5;
  const text = ph.words.map((w) => w.text).join(' ');
  if (/[!?]/.test(text)) s += 0.8;
  if (/\d/.test(text)) s += 0.4;
  s += toks.filter((x) => x.length > 3 && keywords.has(x)).length * 0.8;
  s -= toks.filter((x) => FILLER.test(x)).length * 0.5;
  if (i === n - 1) s += 0.8; // fechamento / chamada final
  return s;
}

/* ---------- ajuste ---------- */

export interface FitResult {
  ops: EditOp[];
  /** segundos tirados */
  removed: Seconds;
  /** duração prevista depois do ajuste */
  final: Seconds;
  /** o que foi feito, em PT-BR ("encurtei o trecho sem fala, tirei 1 frase") */
  said: string[];
}

export interface FitOptions {
  /** trechos de FALA na timeline quando não há palavras (silêncios medidos no áudio) */
  speech?: TimeRange[];
  /** texto do pedido (palavras dele valem mais na escolha das frases) */
  brief?: string;
  /** o gancho: nada que comece antes disso sai (padrão: a 1ª frase inteira ou 3 s) */
  hookUntil?: Seconds;
  /** aceita ficar até tanto acima do alvo (s) */
  tolerance?: Seconds;
}

const fmtS = (t: number) => `${t.toFixed(1).replace('.', ',')} s`;
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Cortes (ripple_delete) para a edição caber em `target` segundos. Nunca corta no meio de uma palavra:
 * o que não tem fala é aparado; frases saem inteiras (as menos importantes primeiro); o gancho fica.
 */
export function fitDurationOps(p: Project, target: Seconds, opts: FitOptions = {}): FitResult {
  const T = projectDuration(p);
  const tol = opts.tolerance ?? 0.3;
  if (!(target > 0) || T <= target + tol) return { ops: [], removed: 0, final: r3(T), said: [] };
  let need = T - target;
  const words = allWords(p).filter((w) => w.end > w.start && w.start < T).sort((a, b) => a.start - b.start);
  const units: Phrase[] = words.length
    ? phrasesOf(words)
    : (opts.speech ?? []).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start).map((r) => ({ start: r.start, end: r.end, words: [] }));
  const hookUntil = opts.hookUntil ?? Math.max(3, units[0] ? units[0].end : 0);
  const cuts: (TimeRange & { why: 'gap' | 'phrase' | 'tail' })[] = [];
  const PAD = 0.15;

  // 1) o que não tem fala: aparado até um mínimo (b-roll fica com 1,5 s; respiro entre frases com 0,3 s)
  const gaps: { a: Seconds; b: Seconds; keep: Seconds; at: 'start' | 'mid' | 'end' }[] = [];
  let t = 0;
  units.forEach((u, i) => {
    const a = i === 0 ? 0 : t + PAD, b = u.start - PAD;
    if (b - a > 0.05) gaps.push({ a, b, keep: i === 0 ? Math.min(0.2, b - a) : b - a >= 2 ? 1.5 : 0.3, at: i === 0 ? 'start' : 'mid' });
    t = u.end;
  });
  const lastA = units.length ? t + PAD : 0;
  if (T - lastA > 0.05) gaps.push({ a: lastA, b: T, keep: units.length ? Math.min(1.5, T - lastA) : Math.min(T, Math.max(0, target)), at: 'end' });
  for (const g of [...gaps].sort((x, y) => (y.b - y.a - y.keep) - (x.b - x.a - x.keep))) {
    if (need <= 0.05) break;
    const room = g.b - g.a - g.keep;
    if (room < 0.2) continue;
    const x = Math.min(room, need);
    // começo: tira do começo (o vídeo abre direto na fala); fim: tira o rabo; meio: fica o começo do trecho
    const r = g.at === 'start' ? { start: g.a, end: g.a + x } : g.at === 'end' ? { start: g.b - x, end: g.b } : { start: g.a + g.keep, end: g.a + g.keep + x };
    if (r.start < hookUntil && g.at !== 'start') continue;
    cuts.push({ ...r, why: 'gap' });
    need -= x;
  }

  // 2) frases inteiras, as menos importantes primeiro (o gancho nunca; o fechamento só se faltar)
  if (need > tol && units.length > 1) {
    const keywords = new Set(strip(opts.brief ?? '').split(/\s+/).map(normWord).filter((x) => x.length > 3));
    const span = (i: number): TimeRange => {
      const u = units[i];
      const prevEnd = i > 0 ? units[i - 1].end : undefined;
      const nextStart = i < units.length - 1 ? units[i + 1].start : undefined;
      // respiro em volta: some quase todo (fica ~0,24 s entre as frases vizinhas); longe de fala, só um respiro curto
      const start = prevEnd !== undefined && u.start - prevEnd < 1.5 ? prevEnd + Math.min(0.12, (u.start - prevEnd) / 2) : Math.max(0, u.start - PAD);
      const end = nextStart !== undefined && nextStart - u.end < 1.5 ? nextStart - Math.min(0.12, (nextStart - u.end) / 2) : Math.min(T, u.end + PAD);
      return { start, end };
    };
    const cand = units.map((u, i) => ({ i, ...span(i), score: phraseScore(u, i, units.length, keywords) }))
      .filter((c) => units[c.i].start >= hookUntil - 0.01 && c.i > 0)
      // tira o que já foi aparado (trechos sem fala) da conta de cada frase
      .map((c) => ({ ...c, len: c.end - c.start - cuts.filter((x) => x.start < c.end && x.end > c.start).reduce((n, x) => n + Math.min(c.end, x.end) - Math.max(c.start, x.start), 0) }));
    const take = (c: typeof cand[number]) => { cuts.push({ start: c.start, end: c.end, why: 'phrase' }); need -= c.len; };
    for (const pass of [0, 1]) {
      // 1ª passada sem a última frase; 2ª com ela (só se ainda faltar)
      const pool = cand.filter((c) => (pass === 0 ? c.i < units.length - 1 : c.i === units.length - 1) && !cuts.some((x) => x.why === 'phrase' && x.start === c.start));
      const order = [...pool].sort((a, b) => a.score - b.score || b.i - a.i);
      const big: typeof cand = [];
      for (const c of order) {
        if (need <= tol) break;
        if (c.len <= need + 1.5) take(c);
        else big.push(c);
      }
      // faltou: a menor frase que resolve (passar um pouco do alvo é melhor que cortar no meio da fala)
      if (need > tol && big.length) take([...big].sort((a, b) => a.len - b.len)[0]);
      if (need <= tol) break;
    }
  }

  // 3) ainda longo (uma frase só / sem fala nenhuma): corta o fim, num respiro entre palavras
  if (need > tol) {
    let at = Math.max(hookUntil, T - need);
    const w = words.find((x) => at > x.start && at < x.end);
    if (w) at = w.start - 0.05 > hookUntil ? w.start - 0.05 : w.end + 0.05;
    const done = cuts.reduce((n, c) => n + Math.max(0, Math.min(T, c.end) - Math.max(at, c.start)), 0);
    if (T - at - done > 0.05) { cuts.push({ start: at, end: T, why: 'tail' }); need -= T - at - done; }
  }

  // une e transforma em ripple_delete (da esquerda para a direita, descontando o que já saiu)
  const merged = cuts.map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(T, c.end) })).filter((c) => c.end - c.start > 0.04).sort((a, b) => a.start - b.start)
    .reduce<(TimeRange & { why: string[] })[]>((acc, c) => {
      const last = acc[acc.length - 1];
      if (last && c.start <= last.end + 0.02) { last.end = Math.max(last.end, c.end); last.why.push(c.why); }
      else acc.push({ start: c.start, end: c.end, why: [c.why] });
      return acc;
    }, []);
  const ops: EditOp[] = [];
  let shift = 0;
  for (const c of merged) {
    const len = c.end - c.start;
    const what = c.why.includes('phrase') ? 'Tirando uma frase menos importante' : c.why.includes('tail') ? 'Encurtando o final' : 'Encurtando o trecho sem fala';
    ops.push({ op: 'ripple_delete', start: r3(c.start - shift), end: r3(c.end - shift), explain: `${what} em ${clock(c.start - shift)} (−${fmtS(len)})` });
    shift += len;
  }
  const removed = r3(shift);
  const said: string[] = [];
  const nGap = merged.filter((c) => c.why.every((w) => w === 'gap')).length;
  const nPhrase = cuts.filter((c) => c.why === 'phrase').length;
  if (nGap) said.push('encurtei os trechos sem fala');
  if (nPhrase) said.push(`tirei ${nPhrase} frase${nPhrase > 1 ? 's' : ''} menos importante${nPhrase > 1 ? 's' : ''} (inteira${nPhrase > 1 ? 's' : ''}, sem cortar palavra)`);
  if (cuts.some((c) => c.why === 'tail')) said.push('encurtei o final');
  return { ops, removed, final: r3(T - removed), said };
}
