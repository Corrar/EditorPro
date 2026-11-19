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
  /** deslocamento vertical/horizontal em múltiplos do tamanho da fonte */
  dy: number;
  dx: number;
  scale: number;
  rotation: number; // graus
  blur: number; // 0..1
  /** amplitude da onda por palavra (em múltiplos da fonte) e fase */
  wave: number;
  wavePhase: number;
  glitch: number; // 0..1
  /** nº de caracteres visíveis (typewriter); Infinity = todos */
  visibleChars: number;
  /** progresso 0..1 ao longo da duração (karaokê) */
  progress: number;
}

export const INTRO = 0.35;
export const OUTRO = 0.3;

const base = (local: number, duration: number): AnimState => ({
  opacity: 1, dy: 0, dx: 0, scale: 1, rotation: 0, blur: 0, wave: 0, wavePhase: 0, glitch: 0,
  visibleChars: Infinity, progress: duration > 0 ? clamp01(local / duration) : 1,
});

const hash = (n: number) => { const x = Math.sin(n * 91.7 + 13.3) * 43758.5453; return x - Math.floor(x); };

/** aplica a animação de entrada `anim` com progresso p (0..1); dir=-1 espelha p/ saída */
function intro(s: AnimState, anim: TextAnimation, p: number, local: number, duration: number, totalChars: number, dir: 1 | -1) {
  const a = 1 - ease('easeOut', p);
  switch (anim) {
    case 'fade': s.opacity *= ease('easeOut', p); break;
    case 'pop': s.scale *= 0.6 + 0.4 * easeOutBack(p, 2.2); s.opacity *= clamp01(p * 3); break;
    case 'slide-up': s.dy += a * 0.8 * dir; s.opacity *= ease('easeOut', p); break;
    case 'slide-down': s.dy -= a * 0.8 * dir; s.opacity *= ease('easeOut', p); break;
    case 'slide-left': s.dx += a * 2.5 * dir; s.opacity *= ease('easeOut', p); break;
    case 'slide-right': s.dx -= a * 2.5 * dir; s.opacity *= ease('easeOut', p); break;
    case 'zoom': s.scale *= 1 + 1.2 * a; s.opacity *= ease('easeOut', p); break;
    case 'blur': s.blur = Math.max(s.blur, a); s.opacity *= clamp01(p * 1.4); break;
    case 'spin': s.rotation += -180 * a * dir; s.scale *= 1 - 0.7 * a; s.opacity *= clamp01(p * 2); break;
    case 'glitch': s.glitch = Math.max(s.glitch, a); s.opacity *= p < 0.15 ? 0 : 1; break;
    case 'flicker': s.opacity *= p >= 1 ? 1 : hash(Math.floor(local * 30)) > 0.45 + 0.5 * (1 - p) ? 1 : 0.15; break;
    case 'wave': s.wave = Math.max(s.wave, 0.35 * a); s.wavePhase = local * 10; s.opacity *= clamp01(p * 2); break;
    case 'bounce': s.dy += -(1 - easeOutBounce(p)) * 1.2 * dir; s.opacity *= clamp01(p * 4); break;
    case 'typewriter':
      if (dir === 1) {
        const typeDur = Math.min(duration * 0.7, Math.max(0.3, totalChars * 0.045));
        s.visibleChars = local >= typeDur ? Infinity : Math.floor(totalChars * clamp01(local / typeDur));
      } else s.visibleChars = Math.min(s.visibleChars, Math.floor(totalChars * p));
      break;
    case 'karaoke': s.opacity *= clamp01(p * 3); break;
    default: break;
  }
}

function loop(s: AnimState, anim: TextAnimation, local: number) {
  const ph = local * Math.PI * 2;
  switch (anim) {
    case 'wave': s.wave = Math.max(s.wave, 0.18); s.wavePhase = local * 6; break;
    case 'bounce': s.dy -= Math.abs(Math.sin(ph * 0.9)) * 0.25; break;
    case 'pop': case 'zoom': s.scale *= 1 + 0.06 * (0.5 - 0.5 * Math.cos(ph)); break;
    case 'flicker': s.opacity *= hash(Math.floor(local * 12)) > 0.12 ? 1 : 0.35; break;
    case 'glitch': s.glitch = Math.max(s.glitch, hash(Math.floor(local * 8)) > 0.8 ? 0.7 : 0); break;
    case 'spin': s.rotation += (local * 90) % 360; break;
    case 'fade': s.opacity *= 0.7 + 0.3 * (0.5 + 0.5 * Math.cos(ph)); break;
    case 'slide-left': case 'slide-right': s.dx += Math.sin(ph * 0.5) * 0.15; break;
    case 'slide-up': case 'slide-down': s.dy += Math.sin(ph * 0.5) * 0.1; break;
    case 'blur': s.blur = Math.max(s.blur, 0.25 * (0.5 - 0.5 * Math.cos(ph))); break;
    default: break;
  }
}

/** estado de um texto `local` s após começar; animação de entrada, saída (opcional) e loop (opcional) */
export function textAnimState(
  anim: TextAnimation, local: number, duration: number, totalChars: number,
  out?: TextAnimation, loopAnim?: TextAnimation,
): AnimState {
  const s = base(local, duration);
  const introDur = Math.min(INTRO, duration / 2);
  intro(s, anim, introDur > 0 ? clamp01(local / introDur) : 1, local, duration, totalChars, 1);
  const outDur = Math.min(OUTRO, duration / 3);
  const left = duration - local;
  if (outDur > 0 && left < outDur) {
    if (out && out !== 'none') intro(s, out, clamp01(left / outDur), local, duration, totalChars, -1);
    else if (!out && anim !== 'none') s.opacity *= clamp01(left / outDur); // padrão: esmaece no fim
  }
  if (loopAnim && loopAnim !== 'none') loop(s, loopAnim, local);
  return s;
}

export const TEXT_ANIMATION_LABELS: Record<TextAnimation, string> = {
  none: 'Nenhuma', fade: 'Esmaecer', pop: 'Pop', 'slide-up': 'Subir', typewriter: 'Máquina de escrever', bounce: 'Quicar',
  karaoke: 'Karaokê', 'slide-down': 'Descer', 'slide-left': 'Deslizar ←', 'slide-right': 'Deslizar →', zoom: 'Zoom',
  blur: 'Desfocar', wave: 'Onda', glitch: 'Glitch', flicker: 'Piscar', spin: 'Girar',
  // biblioteca profissional (rótulos adicionados pela principal; animação implementada pelo engine)
  'word-pop': 'Palavra a palavra · pop', 'word-fade': 'Palavra a palavra · esmaecer', 'word-slide': 'Palavra a palavra · deslizar',
  'word-bounce': 'Palavra a palavra · quicar', 'word-drop': 'Palavra a palavra · cair', 'word-highlight': 'Palavra a palavra · destaque',
  'char-wave': 'Letra a letra · onda', 'char-fade': 'Letra a letra · esmaecer', 'char-pop': 'Letra a letra · pop',
  'char-typewriter': 'Letra a letra · digitando', 'scale-in': 'Crescer', 'blur-in': 'Surgir do desfoque', stomp: 'Pisão',
  drop: 'Cair', 'highlight-sweep': 'Marca-texto', 'underline-draw': 'Sublinhar', 'box-reveal': 'Revelar caixa', shake: 'Tremer',
};

/** escala de tamanho: fontSize do contrato é relativo à altura 1920 */
export function fontPx(fontSize: number, canvasHeight: number): number {
  return (fontSize * canvasHeight) / 1920;
}
