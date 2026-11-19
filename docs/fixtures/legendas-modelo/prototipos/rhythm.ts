// PROTÓTIPO (scratch): blocos de legenda no ritmo da fala, estilo TikTok/Reels
export interface RW { text: string; start: number; end: number; emphasis?: boolean }
export interface RChunk { start: number; end: number; words: RW[] }
export interface RhythmOpts { maxWords: number; maxChars: number; maxDur: number; pauseBreak: number; hardGap: number; minOn: number; leadIn: number; tailHold: number; closeGap: number }
export const RHYTHM_PRESETS: Record<'word' | 'punch' | 'line' | 'phrase', RhythmOpts> = {
  word:   { maxWords: 1, maxChars: 14, maxDur: 1.2, pauseBreak: 0.20, hardGap: 0.5, minOn: 0.22, leadIn: 0.05, tailHold: 0.20, closeGap: 0.20 },
  punch:  { maxWords: 3, maxChars: 18, maxDur: 1.8, pauseBreak: 0.20, hardGap: 0.5, minOn: 0.40, leadIn: 0.06, tailHold: 0.25, closeGap: 0.25 },
  line:   { maxWords: 4, maxChars: 26, maxDur: 2.4, pauseBreak: 0.25, hardGap: 0.6, minOn: 0.50, leadIn: 0.06, tailHold: 0.30, closeGap: 0.30 },
  phrase: { maxWords: 7, maxChars: 42, maxDur: 3.5, pauseBreak: 0.30, hardGap: 0.7, minOn: 0.80, leadIn: 0.08, tailHold: 0.40, closeGap: 0.35 },
};
const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
// não termina bloco nestas (artigo, preposição, clítico, auxiliar curto)
const GLUE_NEXT = new Set('o a os as um uma uns umas de do da dos das no na nos nas num numa em ao aos pelo pela pelos pelas por pra pro para com sem sob me te se lhe nos vos meu minha seu sua teu tua esse essa este esta isso isto aquele que e ou mas nem tao muito mais menos bem vou vai vamos ta to tava'.split(' '));
// começa oração: bom lugar p/ quebrar ANTES
const CLAUSE_START = new Set('e mas porque pois entao quando se ou que onde como tipo depois agora primeiro segundo'.split(' '));
const isNum = (w: string) => /\d/.test(w);
const UNIT = new Set(['%', 'por', 'cento', 'reais', 'mil', 'milhoes', 'milhao', 'k', 'x', 'vezes', 'anos', 'dias', 'horas', 'minutos', 'segundos']);

/** custo de quebrar ENTRE a e b (negativo = bom lugar) ; Infinity nunca, -Infinity obrigatório */
function breakScore(a: RW, b: RW, o: RhythmOpts, cutBetween: boolean): number {
  const gap = b.start - a.end;
  if (gap >= o.hardGap || /[.!?…]["')\]]*$/.test(a.text)) return -Infinity;
  let s = 0;
  if (cutBetween) s -= 3;                                   // corte de edição entre as palavras (pausa removida)
  if (gap >= o.pauseBreak) s -= 4 + 6 * Math.min(1, (gap - o.pauseBreak) / 0.3);
  else if (gap >= 0.12) s -= 2 * (gap - 0.12) / Math.max(0.01, o.pauseBreak - 0.12);
  if (/[,;:—–]["')\]]*$/.test(a.text)) s -= 3;
  const na = norm(a.text), nb = norm(b.text);
  if (CLAUSE_START.has(nb)) s -= 1;
  if (GLUE_NEXT.has(na)) s += 4;                            // "mostrar agora o | truque" é ruim
  if (isNum(a.text) && UNIT.has(nb)) s += 5;                // "90 | por cento" é ruim
  return s;
}

export function rhythmChunks(words: RW[], o: RhythmOpts, cuts: number[] = []): RChunk[] {
  const N = words.length;
  if (!N) return [];
  const bs: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = words[i], b = words[i + 1];
    bs.push(breakScore(a, b, o, cuts.some((c) => c >= a.end - 0.02 && c <= b.start + 0.02)));
  }
  const target = Math.min(o.maxWords, o.maxWords <= 3 ? o.maxWords : 3);
  // DP: best[j] = menor custo cobrindo palavras [0, j)
  const best = new Array(N + 1).fill(Infinity); const prev = new Array(N + 1).fill(-1); best[0] = 0;
  for (let j = 1; j <= N; j++) {
    for (let i = j - 1; i >= 0 && j - i <= o.maxWords; i--) {
      const n = j - i;
      // não pode haver quebra obrigatória dentro do bloco
      if (n > 1 && bs[j - 2] === -Infinity) break;
      const chars = words.slice(i, j).reduce((c, w) => c + w.text.length + 1, -1);
      const dur = words[j - 1].end - words[i].start;
      if (n > 1 && (chars > o.maxChars || dur > o.maxDur)) continue;
      let c = best[i] + 0.6 * (target - n) ** 2;
      if (j < N) { const b = bs[j - 1]; c += b === -Infinity ? -12 : b; }
      // palavra órfã curta quando o estilo permite mais palavras
      if (n === 1 && o.maxWords >= 2 && dur < 0.35 && !words[i].emphasis && !(i > 0 && bs[i - 1] === -Infinity && (j === N || bs[j - 1] === -Infinity))) c += 3;
      if (c < best[j]) { best[j] = c; prev[j] = i; }
    }
  }
  const groups: RW[][] = [];
  for (let j = N; j > 0; j = prev[j]) groups.unshift(words.slice(prev[j], j));
  // tempos de tela
  const out: RChunk[] = groups.map((g) => ({ start: g[0].start, end: g[g.length - 1].end, words: g }));
  for (let k = 0; k < out.length; k++) {
    const c = out[k], nx = out[k + 1], pv = out[k - 1];
    c.start = Math.max(pv ? pv.end : 0, c.start - o.leadIn);
    const nextStart = nx ? nx.words[0].start - o.leadIn : Infinity;
    c.end = Math.min(nextStart, c.end + o.tailHold);
    if (nx && nextStart - c.end < o.closeGap) c.end = nextStart;       // sem "piscar" entre blocos
    if (c.end - c.start < o.minOn) c.end = Math.min(nextStart, c.start + o.minOn); // tempo mínimo de leitura
  }
  return out;
}
export function chunkAtR(chunks: RChunk[], t: number) { let f: RChunk | null = null; for (const c of chunks) { if (t >= c.start && t < c.end) f = c; else if (c.start > t) break; } return f; }
