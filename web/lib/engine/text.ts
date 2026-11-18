/* texto: layout de palavras em linhas e estado de animação (puro; medição injetada) */
import type { TextAnimation } from '../types';
import { clamp01, easeOutBack, easeOutBounce, ease } from './easing';

export interface LaidWord { text: string; index: number; x: number; width: number }
export interface LaidLine { words: LaidWord[]; width: number }

/**
 * Quebra palavras em linhas que caibam em maxWidth. `breaks` marca índices de
 * palavras que DEVEM começar linha nova (\n no texto original).
 * x de cada palavra é relativo ao início da linha.
 */
export function layoutWords(
  words: string[],
  measure: (s: string) => number,
  maxWidth: number,
  breaks: Set<number> = new Set(),
): LaidLine[] {
  const space = measure(' ');
  const lines: LaidLine[] = [];
  let cur: LaidLine = { words: [], width: 0 };
  words.forEach((text, index) => {
    const w = measure(text);
    const needBreak = cur.words.length > 0 && (breaks.has(index) || cur.width + space + w > maxWidth);
    if (needBreak) { lines.push(cur); cur = { words: [], width: 0 }; }
    const x = cur.words.length ? cur.width + space : 0;
    cur.words.push({ text, index, x, width: w });
    cur.width = x + w;
  });
  if (cur.words.length) lines.push(cur);
  return lines;
}

/** separa texto em palavras e marca quebras manuais (\n) */
export function splitText(text: string): { words: string[]; breaks: Set<number> } {
  const words: string[] = [];
  const breaks = new Set<number>();
  text.split(/\r?\n/).forEach((line, li) => {
    const toks = line.split(/[ \t]+/).filter(Boolean);
    if (li > 0 && toks.length) breaks.add(words.length);
    words.push(...toks);
  });
  return { words, breaks };
}

export interface AnimState {
  opacity: number;
  /** deslocamento vertical em múltiplos do tamanho da fonte */
  dy: number;
  scale: number;
  /** nº de caracteres visíveis (typewriter); Infinity = todos */
  visibleChars: number;
  /** progresso 0..1 ao longo da duração (karaokê) */
  progress: number;
}

export const INTRO = 0.35;
export const OUTRO = 0.25;

/** estado da animação de um texto `local` segundos após começar, com duração total `duration` */
export function textAnimState(anim: TextAnimation, local: number, duration: number, totalChars: number): AnimState {
  const s: AnimState = { opacity: 1, dy: 0, scale: 1, visibleChars: Infinity, progress: duration > 0 ? clamp01(local / duration) : 1 };
  const intro = Math.min(INTRO, duration / 2);
  const p = intro > 0 ? clamp01(local / intro) : 1;
  const outLeft = duration - local;
  const outro = Math.min(OUTRO, duration / 3);
  const fadeOut = anim !== 'none' && outro > 0 && outLeft < outro ? clamp01(outLeft / outro) : 1;
  switch (anim) {
    case 'fade':
      s.opacity = ease('easeOut', p);
      break;
    case 'pop':
      s.scale = 0.6 + 0.4 * easeOutBack(p, 2.2);
      s.opacity = clamp01(p * 3);
      break;
    case 'slide-up':
      s.dy = (1 - ease('easeOut', p)) * 0.8;
      s.opacity = ease('easeOut', p);
      break;
    case 'bounce':
      s.dy = -(1 - easeOutBounce(clamp01(local / Math.min(0.6, duration / 2 || 0.6)))) * 1.2;
      s.opacity = clamp01(p * 4);
      break;
    case 'typewriter': {
      const typeDur = Math.min(duration * 0.7, Math.max(0.3, totalChars * 0.045));
      s.visibleChars = typeDur > 0 ? Math.floor(totalChars * clamp01(local / typeDur)) : totalChars;
      if (local >= typeDur) s.visibleChars = Infinity;
      break;
    }
    case 'karaoke':
      s.opacity = clamp01(p * 3);
      break;
    default:
      break;
  }
  s.opacity *= fadeOut;
  return s;
}

/** escala de tamanho: fontSize do contrato é relativo à altura 1920 */
export function fontPx(fontSize: number, canvasHeight: number): number {
  return (fontSize * canvasHeight) / 1920;
}
