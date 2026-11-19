/* =====================================================================
   Filtro da saída do Whisper (puro, testado com saídas MEDIDAS):
   tira loops ("1, 2, 3, 4, 5, 5, 6…", "sejam gostos de sejam gostas…"),
   rajadas impossíveis (dezenas de palavras no mesmo instante), trechos só
   de números/pontuação, frases-fantasma de fim de vídeo e palavras onde
   não há som nenhum. Fala limpa passa intacta.
   Roda nos dois caminhos (aparelho e servidor), ANTES de virar legenda.
   ===================================================================== */
import type { WhisperChunk } from './words';
import { overlapFraction, type Range } from './vad';

export function normToken(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const STOP = new Set(
  ('o a os as um uma uns umas de do da dos das no na nos nas num numa em ao aos e ou que se me te lhe eu tu ele ela nos vos eles elas ' +
    'é e ser foi com sem por pra pro para mas nem nao sim ja la aqui isso isto esse essa este esta muito mais bem so tambem entao ne tipo a gente')
    .split(' '),
);

/** frases que o Whisper inventa em silêncio/música (normalizadas, sem acento/pontuação) */
export const PHANTOM_PHRASES = [
  'espero que tenham gostado', 'ate o proximo video', 'tchau tchau', 'se inscreva', 'inscrevase no canal', 'legenda adriana zanotto',
  'legendas pela comunidade', 'obrigado por assistir', 'obrigada por assistir', 'ative o sininho', 'amaraorg', 'subtitles by', 'thanks for watching',
];
/** sempre lixo, com ou sem áudio */
const ALWAYS_JUNK = /amara\.?org|legendas? pela comunidade|legenda(s|do)? por [a-z]|subtitles by|transcri[cç][aã]o (feita )?por/i;

const LONE_JUNK = new Set(['o', 'a', 'e', 'do', 'da', 'de', 'que', 'um', 'uma', 'os', 'as', 'no', 'na', 'em']);

interface W { text: string; s: number; e: number; n: string; drop: boolean }

const isNumeric = (n: string) => /^\d+$/.test(n);

/** (a) loops: n-grama repetido na janela, contagens em sequência */
function markLoops(ws: W[]) {
  const N = ws.length;
  const WIN = 10;
  for (let i = 0; i < N; i++) {
    const win = ws.slice(i, i + WIN);
    if (win.length < 6) break;
    const toks = win.map((w) => w.n);
    let loop = false;
    for (let n = 1; n <= 3 && !loop; n++) {
      const count = new Map<string, number>();
      for (let k = 0; k + n <= toks.length; k++) {
        const g = toks.slice(k, k + n);
        if (g.some((x) => !x)) continue;
        // 1-grama: só palavra de conteúdo (artigo/preposição repete na fala normal)
        if (n === 1 && (STOP.has(g[0]) || g[0].length < 3)) continue;
        // 2/3-grama só de palavras funcionais ("de um", "que a") também é comum
        if (n > 1 && g.every((x) => STOP.has(x))) continue;
        const key = g.join(' ');
        const c = (count.get(key) ?? 0) + 1;
        count.set(key, c);
        if (c >= 3) { loop = true; break; }
      }
    }
    // poucas palavras distintas numa janela inteira = disco riscado
    if (!loop && new Set(toks).size <= 3 && toks.length >= WIN) loop = true;
    if (loop) for (const w of win) w.drop = true;
  }
  // contagem: ≥4 números seguidos
  let run: W[] = [];
  const flush = () => { if (run.length >= 4) for (const w of run) w.drop = true; run = []; };
  for (const w of ws) { if (isNumeric(w.n)) run.push(w); else flush(); }
  flush();
}

/**
 * (b) rajada impossível: >10 palavras/s sustentado por 2 s, ou ≥6 palavras com o MESMO instante de início.
 * (O plano sugeria 6,5/s, mas fala real muito rápida medida chega a 8,5/s — B_vfast.)
 */
function markBursts(ws: W[]) {
  const RATE = 10, SPAN = 2, SAME = 6;
  let j = 0;
  for (let i = 0; i < ws.length; i++) {
    if (j < i) j = i;
    while (j + 1 < ws.length && ws[j + 1].s < ws[i].s + SPAN) j++;
    if (j - i + 1 > RATE * SPAN) for (let k = i; k <= j; k++) ws[k].drop = true;
  }
  let a = 0;
  for (let i = 1; i <= ws.length; i++) {
    if (i < ws.length && Math.abs(ws[i].s - ws[a].s) < 0.03) continue;
    if (i - a >= SAME) for (let k = a; k < i; k++) ws[k].drop = true;
    a = i;
  }
}

/** grupos de palavras separados por pausa ≥ gap (≈ "frases") */
function groups(ws: W[], gap = 0.5): W[][] {
  const out: W[][] = [];
  let cur: W[] = [];
  for (const w of ws) {
    if (cur.length && w.s - cur[cur.length - 1].e >= gap) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** (c) frase só de números/pontuação; (d) frases-fantasma */
function markGroups(ws: W[], runs: Range[] | undefined) {
  for (const g of groups(ws)) {
    const live = g.filter((w) => !w.drop);
    if (!live.length) continue;
    const junk = live.filter((w) => !w.n || isNumeric(w.n)).length;
    if (live.length >= 3 && junk / live.length >= 0.8) { for (const w of live) w.drop = true; continue; }
    const text = live.map((w) => w.text).join(' ');
    if (ALWAYS_JUNK.test(text)) { for (const w of live) w.drop = true; continue; }
    // só palavras funcionais soltas ("do que o e do") = ruído de música, não fala
    const toks = live.map((w) => w.n).filter(Boolean);
    if (toks.length && toks.every((x) => STOP.has(x)) && (toks.length >= 5 || (toks.length === 1 && LONE_JUNK.has(toks[0])))) {
      for (const w of live) w.drop = true;
      continue;
    }
    const flat = live.map((w) => w.n).filter(Boolean).join(' ');
    const a = live[0].s, b = Math.max(live[live.length - 1].e, a + 0.01);
    const speech = runs ? overlapFraction(runs, a, b) : 1;
    const perWord = (b - a) / live.length;
    const phantom = PHANTOM_PHRASES.some((p) => flat.includes(p)) || flat === 'e ai';
    // frase-fantasma: só some se não há voz embaixo dela (ou se a duração é absurda p/ tão pouca fala)
    if (phantom && (speech < 0.5 || perWord > 1.2)) for (const w of live) w.drop = true;
  }
}

export interface FilterReport { input: number; kept: number; loops: number; bursts: number; noSpeech: number; groups: number; outOfRange: number }

/**
 * Filtra palavras do Whisper (tempos da mídia). `vadRuns` = trechos com som
 * (vad.energyRuns, mesmo relógio). `duration` prende as palavras à mídia.
 */
export function filterAsr(chunks: WhisperChunk[], vadRuns?: Range[], opts: { duration?: number; report?: (r: FilterReport) => void } = {}): WhisperChunk[] {
  const D = opts.duration && opts.duration > 0 ? opts.duration : Infinity;
  let outOfRange = 0;
  const ws: W[] = [];
  for (const c of chunks) {
    const text = c.text ?? '';
    const s = c.timestamp?.[0];
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    let e = c.timestamp[1];
    if (typeof e !== 'number' || !Number.isFinite(e) || e < s) e = s;
    if (s >= D - 0.02) { outOfRange++; continue; } // além do fim da mídia: alucinação
    ws.push({ text, s, e: Math.min(e, D), n: normToken(text), drop: false });
  }
  ws.sort((a, b) => a.s - b.s);
  const count = () => ws.filter((w) => w.drop).length;
  markLoops(ws);
  const loops = count();
  markBursts(ws);
  const bursts = count() - loops;
  // (e) palavra sem som nenhum embaixo (folga p/ o atraso típico do Whisper)
  let noSpeech = 0;
  if (vadRuns) {
    for (const w of ws) {
      if (w.drop) continue;
      // folga larga: o Whisper marca ~0,15–0,3 s atrasado e o fim de frase é baixinho
      // palavra "atrasada" logo depois de uma fala fica (o refineWordTimes a puxa de volta)
      const a = w.s - 1.5, b = Math.max(w.e, w.s + 0.1) + 0.2;
      if (overlapFraction(vadRuns, a, b) === 0) {
        w.drop = true;
        noSpeech++;
      }
    }
  }
  const before = count();
  markGroups(ws, vadRuns);
  const grp = count() - before;
  const out = ws.filter((w) => !w.drop).map((w) => ({ text: w.text, timestamp: [w.s, w.e] as [number, number] }));
  opts.report?.({ input: chunks.length, kept: out.length, loops, bursts, noSpeech, groups: grp, outOfRange });
  return out;
}
