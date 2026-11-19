/* legendas: agrupamento de palavras em blocos e aparência dos presets (puro) */
import type { CaptionPreset, CaptionRhythm, CaptionSegment, Seconds } from '../types';

export interface ChunkWord {
  text: string;
  start: Seconds;
  end: Seconds;
  emphasis: boolean;
}

export interface CaptionChunk {
  segmentId: string;
  start: Seconds;
  end: Seconds;
  words: ChunkWord[];
}

/** normaliza p/ comparar ênfase: minúsculas, sem pontuação nas pontas, sem acento */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** palavras com tempo: usa seg.words; sem elas, distribui o tempo do segmento proporcional ao tamanho */
export function segmentWords(seg: CaptionSegment): { text: string; start: Seconds; end: Seconds }[] {
  if (seg.words && seg.words.length) {
    return seg.words
      .filter((w) => w.text.trim())
      .map((w) => ({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start) }));
  }
  const tokens = seg.text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const span = Math.max(0, seg.end - seg.start);
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = seg.start;
  return tokens.map((text, i) => {
    const d = (span * weights[i]) / total;
    const w = { text, start: acc, end: acc + d };
    acc += d;
    return w;
  });
}

const SENTENCE_END = /[.!?…]["')\]]*$/;

/**
 * Palavras com tempo (Whisper) que escapam de [seg.start, seg.end] — o usuário encurtou/moveu a legenda
 * pelos puxadores ou pelos campos Início/Fim, que só mudam start/end — são reescaladas linearmente
 * para dentro do intervalo. Só no desenho: os tempos gravados (usados p/ cortar a mídia) não mudam.
 */
export function fitWordsToSegment<T extends { start: Seconds; end: Seconds }>(words: T[], seg: { start: Seconds; end: Seconds }): T[] {
  if (!words.length) return words;
  const a = words[0].start, b = words[words.length - 1].end;
  const eps = 1e-3;
  if (a >= seg.start - eps && b <= seg.end + eps) return words;
  const span = Math.max(1e-6, b - a), target = Math.max(0, seg.end - seg.start);
  const map = (t: Seconds) => seg.start + ((t - a) / span) * target;
  return words.map((w) => ({ ...w, start: map(w.start), end: Math.max(map(w.start), map(w.end)) }));
}

/**
 * Agrupa as palavras de cada segmento em blocos. Com um NÚMERO: blocos de até maxWords (quebra também
 * em fim de frase) — comportamento antigo. Com {maxWords, rhythm?, cuts?}: blocos no ritmo da fala
 * (ver rhythmChunks); rhythm 'count' volta ao antigo. Cada bloco vai do início da 1ª palavra até o início do
 * próximo bloco do mesmo segmento (o último vai até o fim do segmento), para
 * a legenda não piscar entre palavras.
 */
export function chunkCaptions(segments: CaptionSegment[], opts: ChunkOptions): CaptionChunk[] {
  if (typeof opts === 'object') {
    const r = rhythmFor(opts);
    if (r) return rhythmChunks(segments, r, opts.cuts ?? []);
  }
  const maxWords = typeof opts === 'number' ? opts : opts.maxWords;
  const max = Math.max(1, Math.floor(maxWords || 1));
  const out: CaptionChunk[] = [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    const emph = new Set((seg.emphasis ?? []).map(normWord).filter(Boolean));
    const words = fitWordsToSegment(segmentWords(seg), seg).map((w) => ({ ...w, emphasis: emph.has(normWord(w.text)) }));
    const groups: ChunkWord[][] = [];
    let cur: ChunkWord[] = [];
    for (const w of words) {
      cur.push(w);
      if (cur.length >= max || SENTENCE_END.test(w.text)) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
    // o fim é o do segmento (antes: max com a última palavra → encurtar o fim não mudava nada)
    const segEnd = seg.end;
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      out.push({
        segmentId: seg.id,
        start: i === 0 ? Math.max(seg.start, Math.min(g[0].start, segEnd)) : g[0].start,
        end: next ? next[0].start : segEnd,
        words: g,
      });
    });
  }
  return out;
}

/* ---------- blocos no RITMO da fala (sessão legendas, plano 2026-11-19 §2.6) ---------- */

/** parâmetros do agrupamento por ritmo (segundos) */
export interface RhythmOpts {
  maxWords: number;
  maxChars: number;
  maxDur: number;
  /** pausa a partir da qual quebrar é bom */
  pauseBreak: number;
  /** pausa (ou fim de frase) que SEMPRE quebra */
  hardGap: number;
  /** tempo mínimo de um bloco na tela (leitura) */
  minOn: number;
  /** o bloco aparece um pouco antes da 1ª palavra */
  leadIn: number;
  /** e fica um pouco depois da última */
  tailHold: number;
  /** buraco entre blocos menor que isso é fechado (sem piscar) */
  closeGap: number;
}

export const RHYTHM_PRESETS: Record<Exclude<CaptionRhythm, 'count'>, RhythmOpts> = {
  word: { maxWords: 1, maxChars: 14, maxDur: 1.2, pauseBreak: 0.2, hardGap: 0.5, minOn: 0.22, leadIn: 0.05, tailHold: 0.2, closeGap: 0.2 },
  punch: { maxWords: 3, maxChars: 18, maxDur: 1.8, pauseBreak: 0.2, hardGap: 0.5, minOn: 0.4, leadIn: 0.06, tailHold: 0.25, closeGap: 0.25 },
  line: { maxWords: 4, maxChars: 26, maxDur: 2.4, pauseBreak: 0.25, hardGap: 0.6, minOn: 0.5, leadIn: 0.06, tailHold: 0.3, closeGap: 0.3 },
  phrase: { maxWords: 7, maxChars: 42, maxDur: 3.5, pauseBreak: 0.3, hardGap: 0.7, minOn: 0.8, leadIn: 0.08, tailHold: 0.4, closeGap: 0.35 },
};

/** opções de agrupamento a partir do estilo: rhythm explícito ou derivado do maxWords; 'count' = só contar palavras */
export function rhythmFor(style: { maxWords?: number; rhythm?: CaptionRhythm }): RhythmOpts | null {
  const max = Math.max(1, Math.floor(style.maxWords || 3));
  if (style.rhythm === 'count') return null;
  const preset = style.rhythm ? RHYTHM_PRESETS[style.rhythm] : max <= 1 ? RHYTHM_PRESETS.word : max <= 3 ? RHYTHM_PRESETS.punch : max <= 4 ? RHYTHM_PRESETS.line : RHYTHM_PRESETS.phrase;
  if (!preset) return null;
  // o "máximo de palavras" do usuário manda; o resto do ritmo vem do preset
  return { ...preset, maxWords: max, maxChars: Math.max(preset.maxChars, max * 7), maxDur: Math.max(preset.maxDur, max * 0.55) };
}

/** pontos de corte de edição (início de cada clipe de vídeo depois do 1º): bons lugares para trocar de bloco */
export function captionCutPoints(tracks: { kind: string; hidden?: boolean; clips: { type: string; start: Seconds }[] }[]): Seconds[] {
  const cuts = new Set<number>();
  for (const t of tracks) {
    if (t.kind !== 'video' || t.hidden) continue;
    for (const c of t.clips) if ((c.type === 'video' || c.type === 'image') && c.start > 0.01) cuts.add(Math.round(c.start * 1000) / 1000);
  }
  return [...cuts].sort((a, b) => a - b);
}

// não termina bloco nestas (artigo, preposição, clítico, auxiliar curto)
const GLUE_NEXT = new Set('o a os as um uma uns umas de do da dos das no na nos nas num numa em ao aos pelo pela pelos pelas por pra pro para com sem sob me te se lhe nos vos meu minha seu sua teu tua esse essa este esta isso isto aquele que e ou mas nem tao muito mais menos bem vou vai vamos ta to tava'.split(' '));
// começa oração: bom lugar p/ quebrar ANTES
const CLAUSE_START = new Set('e mas porque pois entao quando se ou que onde como tipo depois agora primeiro segundo'.split(' '));
const UNIT = new Set(['%', 'por', 'cento', 'reais', 'mil', 'milhoes', 'milhao', 'k', 'x', 'vezes', 'anos', 'dias', 'horas', 'minutos', 'segundos']);

/** custo de quebrar ENTRE a e b (negativo = bom lugar; -Infinity = obrigatório) */
function breakScore(a: ChunkWord, b: ChunkWord, o: RhythmOpts, cutBetween: boolean): number {
  const gap = b.start - a.end;
  if (gap >= o.hardGap || SENTENCE_END.test(a.text)) return -Infinity;
  let s = 0;
  if (cutBetween) s -= 3; // corte de edição entre as palavras
  if (gap >= o.pauseBreak) s -= 4 + 6 * Math.min(1, (gap - o.pauseBreak) / 0.3);
  else if (gap >= 0.12) s -= (2 * (gap - 0.12)) / Math.max(0.01, o.pauseBreak - 0.12);
  if (/[,;:—–]["')\]]*$/.test(a.text)) s -= 3;
  const na = normWord(a.text), nb = normWord(b.text);
  if (CLAUSE_START.has(nb)) s -= 1;
  if (GLUE_NEXT.has(na)) s += 4; // "mostrar agora o | truque" é ruim
  if (/\d/.test(a.text) && (UNIT.has(nb) || /^%/.test(b.text))) s += 12; // "90 | por cento": quase proibido
  return s;
}

/** divide as palavras de UM segmento em grupos (programação dinâmica sobre os custos de quebra) */
function rhythmGroups(words: ChunkWord[], o: RhythmOpts, cuts: Seconds[]): ChunkWord[][] {
  const N = words.length;
  if (!N) return [];
  const bs: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = words[i], b = words[i + 1];
    bs.push(breakScore(a, b, o, cuts.some((c) => c >= a.end - 0.02 && c <= b.start + 0.02)));
  }
  const target = Math.min(o.maxWords, 3);
  const best = new Array<number>(N + 1).fill(Infinity);
  const prev = new Array<number>(N + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= N; j++) {
    for (let i = j - 1; i >= 0 && j - i <= o.maxWords; i--) {
      const n = j - i;
      if (n > 1 && bs[j - 2] === -Infinity) break; // quebra obrigatória não fica dentro do bloco
      let chars = -1;
      for (let k = i; k < j; k++) chars += words[k].text.length + 1;
      const dur = words[j - 1].end - words[i].start;
      if (n > 1 && (chars > o.maxChars || dur > o.maxDur)) continue;
      let c = best[i] + 0.6 * (target - n) ** 2;
      if (j < N) { const b = bs[j - 1]; c += b === -Infinity ? -12 : b; }
      // quanto o bloco pode ficar na tela: da entrada (leadIn) até segurar na pausa seguinte (tailHold)
      const after = j < N ? Math.max(0, words[j].start - words[j - 1].end - o.leadIn) : o.tailHold;
      const shown = dur + o.leadIn + Math.min(o.tailHold, after);
      // bloco curto demais para ler (fala corrida, sem pausa para segurar): prefere juntar com o vizinho
      if (shown < o.minOn && n < o.maxWords) c += 2 + 8 * (1 - shown / o.minOn);
      // palavra órfã curta quando o estilo permite mais palavras (exceto entre duas quebras obrigatórias)
      if (n === 1 && o.maxWords >= 2 && shown < 0.35 && !words[i].emphasis && !(i > 0 && bs[i - 1] === -Infinity && (j === N || bs[j - 1] === -Infinity))) c += 3;
      if (c < best[j]) { best[j] = c; prev[j] = i; }
    }
  }
  const groups: ChunkWord[][] = [];
  for (let j = N; j > 0; j = prev[j]) {
    if (prev[j] < 0) { groups.unshift(words.slice(0, j)); break; } // segurança (não deve acontecer)
    groups.unshift(words.slice(prev[j], j));
  }
  return groups;
}

/**
 * Blocos de legenda no RITMO da fala: quebra nas pausas, pontuação e cortes de edição; nunca deixa
 * artigo/preposição pendurado no fim; o bloco entra um pouco antes da 1ª palavra (leadIn), fica um
 * pouco depois da última (tailHold), não pisca entre blocos (closeGap) e fica o mínimo para ler (minOn).
 */
function rhythmChunks(segments: CaptionSegment[], o: RhythmOpts, cuts: Seconds[]): CaptionChunk[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  // lista ÚNICA de palavras (o limite entre frases do Whisper às vezes cai no meio da fala: "até a | massa")
  const words: (ChunkWord & { seg: number })[] = [];
  sorted.forEach((seg, si) => {
    const emph = new Set((seg.emphasis ?? []).map(normWord).filter(Boolean));
    for (const w of fitWordsToSegment(segmentWords(seg), seg)) words.push({ ...w, emphasis: emph.has(normWord(w.text)), seg: si });
  });
  const out: CaptionChunk[] = [];
  const segOf: { first: CaptionSegment; last: CaptionSegment; lastIdx: number }[] = [];
  for (const g of rhythmGroups(words, o, cuts) as (ChunkWord & { seg: number })[][]) {
    const first = sorted[g[0].seg], lastW = g[g.length - 1];
    out.push({ segmentId: first.id, start: g[0].start, end: lastW.end, words: g.map(({ seg: _s, ...w }) => w) });
    segOf.push({ first, last: sorted[lastW.seg], lastIdx: lastW.seg });
  }
  for (let k = 0; k < out.length; k++) {
    const c = out[k], nx = out[k + 1], pv = out[k - 1], sg = segOf[k];
    const first = c.words[0].start, last = c.words[c.words.length - 1].end;
    c.start = Math.max(pv ? pv.end : 0, sg.first.start - o.leadIn, first - o.leadIn);
    const nextStart = nx ? Math.max(c.start, nx.words[0].start - o.leadIn) : Infinity;
    const lastOfSeg = !nx || segOf[k + 1].first !== sg.last || words.length === 0;
    c.end = Math.min(nextStart, (lastOfSeg ? Math.max(last, Math.min(sg.last.end, last + o.tailHold)) : last) + o.tailHold);
    if (nx && nextStart - c.end < o.closeGap) c.end = nextStart; // sem piscar entre blocos
    if (c.end - c.start < o.minOn) c.end = Math.min(nextStart, c.start + o.minOn); // tempo mínimo de leitura
    // ainda curto (fala corrida logo depois): aparece antes, tomando a "sobra" do bloco anterior (o tailHold dele)
    if (c.end - c.start < o.minOn) {
      const floor = pv ? Math.max(pv.words[pv.words.length - 1].end, pv.start + o.minOn) : 0;
      const ns = Math.max(floor, c.end - o.minOn);
      if (ns < c.start) { c.start = ns; if (pv) pv.end = Math.min(pv.end, ns); }
    }
    if (c.end <= c.start) c.end = c.start + 0.04;
  }
  return out;
}

/** opções de chunkCaptions: número = só conta palavras (antigo); objeto = ritmo da fala */
export type ChunkOptions = number | { maxWords: number; rhythm?: CaptionRhythm; cuts?: Seconds[] };

/** chunkCaptions no ritmo da fala, a partir do estilo da legenda (o que o preview/export usam) */
export function chunkCaptionsFor(segments: CaptionSegment[], style: { maxWords: number; rhythm?: CaptionRhythm }, cuts: Seconds[] = []): CaptionChunk[] {
  return chunkCaptions(segments, { maxWords: style.maxWords, rhythm: style.rhythm, cuts });
}

/** bloco visível em t (o mais recente que começou, se houver sobreposição) */
export function chunkAt(chunks: CaptionChunk[], t: Seconds): CaptionChunk | null {
  let found: CaptionChunk | null = null;
  for (const c of chunks) {
    if (t >= c.start && t < c.end) found = c;
    else if (c.start > t) break;
  }
  return found;
}

export interface CaptionLook {
  /** 'word' = só a palavra ativa em destaque; 'progress' = já faladas + ativa (karaokê); 'none' */
  highlight: 'none' | 'word' | 'progress';
  /** escala extra da palavra ativa */
  activeScale: number;
  /** caixa de fundo por linha */
  box: boolean;
  /** brilho neon (shadowBlur colorido) */
  glow: boolean;
  /** contorno usa o strokeWidth do estilo? */
  stroke: boolean;
  /** peso máximo da fonte (minimal fica mais leve) */
  maxWeight?: number;
  shadow: 'none' | 'soft' | 'hard';
}

export const CAPTION_LOOKS: Record<CaptionPreset, CaptionLook> = {
  classic: { highlight: 'none', activeScale: 1, box: false, glow: false, stroke: true, shadow: 'soft' },
  'bold-pop': { highlight: 'word', activeScale: 1.14, box: false, glow: false, stroke: true, shadow: 'hard' },
  karaoke: { highlight: 'progress', activeScale: 1.05, box: false, glow: false, stroke: true, shadow: 'hard' },
  minimal: { highlight: 'none', activeScale: 1, box: false, glow: false, stroke: false, maxWeight: 600, shadow: 'soft' },
  boxed: { highlight: 'word', activeScale: 1, box: true, glow: false, stroke: false, shadow: 'none' },
  neon: { highlight: 'word', activeScale: 1.06, box: false, glow: true, stroke: false, shadow: 'none' },
};

export const CAPTION_PRESET_LABELS: Record<CaptionPreset, string> = {
  classic: 'Clássica', 'bold-pop': 'Bold pop', karaoke: 'Karaokê', minimal: 'Minimalista', boxed: 'Caixa', neon: 'Neon',
};

export function captionLook(preset: CaptionPreset | undefined): CaptionLook {
  return CAPTION_LOOKS[preset ?? 'classic'] ?? CAPTION_LOOKS.classic;
}

/** estado de destaque de cada palavra do bloco em t */
export function wordStates(chunk: CaptionChunk, t: Seconds, look: CaptionLook): { active: boolean; highlighted: boolean }[] {
  // palavra ativa: a última cujo início já passou (preenche buracos entre palavras)
  let activeIdx = -1;
  chunk.words.forEach((w, i) => { if (t >= w.start) activeIdx = i; });
  return chunk.words.map((w, i) => {
    const active = i === activeIdx;
    let highlighted = w.emphasis;
    if (look.highlight === 'word' && active) highlighted = true;
    if (look.highlight === 'progress' && i <= activeIdx) highlighted = true;
    return { active, highlighted };
  });
}

/* ---------- zonas seguras por plataforma (biblioteca) ---------- */

export type SafeZoneId = 'none' | 'tiktok' | 'reels' | 'shorts' | 'youtube';

/**
 * Área livre da interface do app, em frações do quadro vertical (9:16):
 * topo (abas/busca), base (legenda do post, botões) e direita (coluna de ações).
 * Valores conservadores medidos a partir dos layouts públicos dos apps.
 */
export const SAFE_ZONES: Record<Exclude<SafeZoneId, 'none'>, { top: number; bottom: number; left: number; right: number; label: string }> = {
  tiktok: { top: 0.09, bottom: 0.20, left: 0.05, right: 0.16, label: 'TikTok' },
  reels: { top: 0.10, bottom: 0.22, left: 0.05, right: 0.14, label: 'Reels' },
  shorts: { top: 0.08, bottom: 0.21, left: 0.05, right: 0.15, label: 'Shorts' },
  youtube: { top: 0.05, bottom: 0.12, left: 0.05, right: 0.05, label: 'YouTube' },
};

/**
 * Ajusta o centro (x,y) de um bloco de altura `blockH` e largura `blockW`
 * (frações do quadro) para caber na zona segura. Em quadros não verticais só
 * as plataformas horizontais (youtube) se aplicam com margens próprias.
 */
export function clampToSafeZone(zone: SafeZoneId | undefined, x: number, y: number, blockW: number, blockH: number, portrait: boolean): { x: number; y: number; maxW: number } {
  if (!zone || zone === 'none' || (!portrait && zone !== 'youtube')) return { x, y, maxW: 1 };
  const z = SAFE_ZONES[zone];
  const maxW = Math.max(0.3, 1 - z.left - z.right);
  const minY = z.top + blockH / 2, maxY = 1 - z.bottom - blockH / 2;
  const minX = z.left + Math.min(blockW, maxW) / 2, maxX = 1 - z.right - Math.min(blockW, maxW) / 2;
  return {
    x: minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : (z.left + 1 - z.right) / 2,
    y: minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : (z.top + 1 - z.bottom) / 2,
    maxW,
  };
}

/* ---------- ênfase automática de palavras-chave ---------- */

const EMPHASIS_WORDS = new Set([
  'nunca', 'sempre', 'jamais', 'agora', 'hoje', 'grátis', 'gratis', 'segredo', 'segredos', 'verdade', 'incrível', 'incrivel',
  'importante', 'atenção', 'atencao', 'cuidado', 'erro', 'erros', 'melhor', 'pior', 'maior', 'menor', 'único', 'unico', 'única', 'unica',
  'rápido', 'rapido', 'fácil', 'facil', 'dinheiro', 'milhões', 'milhoes', 'mil', 'dobro', 'triplo', 'todo', 'tudo', 'ninguém', 'ninguem',
  'chocante', 'urgente', 'novo', 'nova', 'sucesso', 'resultado', 'resultados', 'truque', 'dica', 'dicas', 'pare', 'proibido', 'garantido',
  'absurdo', 'insano', 'louco', 'surreal', 'top', 'demais', 'muito', 'zero', 'primeiro', 'primeira', 'último', 'ultimo', 'última', 'ultima',
]);

/** palavra merece ênfase automática? (números/valores/porcentagens ou palavra forte) */
export function isEmphasisWord(word: string): boolean {
  const raw = word.trim();
  if (/\d/.test(raw) || /^(R\$|US\$|\$|€)/i.test(raw) || /%$/.test(raw)) return true;
  const n = normWord(raw);
  return n.length >= 3 && EMPHASIS_WORDS.has(n);
}

/* ---------- cor de destaque efetiva ---------- */

const sameColor = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Cor da palavra em destaque (ativa/falada/ênfase). A cor escolhida pelo usuário ganha do preset:
 * se o preset NÃO tem destaque próprio (destaque = cor, ex.: "Karaokê acendendo" branco/branco)
 * e o usuário não mexeu no destaque, o destaque acompanha a cor escolhida — senão trocar a cor
 * "não fazia nada" (as palavras faladas ficavam na cor de destaque antiga).
 */
export function captionHighlight(style: { color?: string; highlightColor?: string }, presetDefaults?: { color?: string; highlightColor?: string } | null): string {
  const hl = style.highlightColor || '#FFD23F';
  const d = presetDefaults;
  if (d && sameColor(d.highlightColor, d.color) && sameColor(style.highlightColor, d.highlightColor) && style.color && !sameColor(style.color, d.color)) {
    return style.color;
  }
  return hl;
}
