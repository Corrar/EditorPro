/* legendas: agrupamento de palavras em blocos e aparência dos presets (puro) */
import type { CaptionPreset, CaptionSegment, Seconds } from '../types';

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
 * Agrupa as palavras de cada segmento em blocos de até maxWords (quebra também
 * em fim de frase). Cada bloco vai do início da 1ª palavra até o início do
 * próximo bloco do mesmo segmento (o último vai até o fim do segmento), para
 * a legenda não piscar entre palavras.
 */
export function chunkCaptions(segments: CaptionSegment[], maxWords: number): CaptionChunk[] {
  const max = Math.max(1, Math.floor(maxWords || 1));
  const out: CaptionChunk[] = [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    const emph = new Set((seg.emphasis ?? []).map(normWord).filter(Boolean));
    const words = segmentWords(seg).map((w) => ({ ...w, emphasis: emph.has(normWord(w.text)) }));
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
    const segEnd = Math.max(seg.end, words.length ? words[words.length - 1].end : seg.end);
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      out.push({
        segmentId: seg.id,
        start: g[0].start,
        end: next ? next[0].start : segEnd,
        words: g,
      });
    });
  }
  return out;
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
