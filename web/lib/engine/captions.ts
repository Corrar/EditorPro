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
