/* =====================================================================
   Animações de texto por PALAVRA e por LETRA (estilo After Effects/CapCut).
   Puro: calcula o estado de cada unidade (palavra ou letra) no tempo.
   - Em textos: as unidades entram em cascata (stagger) no começo, saem em
     cascata inversa no fim (se for a animação de saída) ou ficam em loop.
   - Em legendas: cada palavra entra no instante em que é falada (starts).
   ===================================================================== */
import type { TextAnimation } from '../types';
import { clamp01, ease, easeOutBack, easeOutBounce } from './easing';

export type UnitKind = 'word' | 'char';

const WORD_ANIMS = ['word-pop', 'word-fade', 'word-slide', 'word-bounce', 'word-drop', 'word-highlight'] as const;
const CHAR_ANIMS = ['char-wave', 'char-fade', 'char-pop', 'char-typewriter'] as const;

export function unitKindOf(anim: TextAnimation | undefined): UnitKind | null {
  if (!anim) return null;
  if ((WORD_ANIMS as readonly string[]).includes(anim)) return 'word';
  if ((CHAR_ANIMS as readonly string[]).includes(anim)) return 'char';
  return null;
}

export interface UnitFx {
  opacity: number;
  dx: number; // em múltiplos do tamanho da fonte
  dy: number;
  scale: number;
  rotation: number; // graus
  /** 0..1: força da caixa de destaque atrás da unidade (word-highlight) */
  highlight: number;
}

export const UNIT_NEUTRAL: UnitFx = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, highlight: 0 };

/** duração da animação de cada unidade */
export function unitDuration(kind: UnitKind): number {
  return kind === 'word' ? 0.32 : 0.2;
}

/**
 * instantes (relativos ao início do texto) em que cada unidade começa a entrar.
 * Cascata que cabe em `window` segundos (máx. 0,09 s/palavra, 0,035 s/letra).
 */
export function staggerStarts(count: number, kind: UnitKind, window: number): number[] {
  if (count <= 0) return [];
  const per = kind === 'word' ? 0.09 : 0.035;
  const step = count > 1 ? Math.min(per, Math.max(0, window - unitDuration(kind)) / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => i * step);
}

/** progresso de entrada 0..1 da unidade (p) aplicado ao efeito */
function intro(anim: TextAnimation, p: number): UnitFx {
  const fx = { ...UNIT_NEUTRAL };
  const e = ease('easeOut', p);
  switch (anim) {
    case 'word-pop': case 'char-pop':
      fx.scale = Math.max(0, easeOutBack(p, 2.6)); fx.opacity = clamp01(p * 3); break;
    case 'word-fade': case 'char-fade':
      fx.opacity = e; break;
    case 'word-slide':
      fx.dy = (1 - e) * 0.6; fx.opacity = e; break;
    case 'word-bounce':
      fx.dy = -(1 - easeOutBounce(p)) * 0.9; fx.opacity = clamp01(p * 4); break;
    case 'word-drop':
      fx.dy = -(1 - easeOutBounce(p)) * 1.6; fx.rotation = (1 - e) * -8; fx.opacity = clamp01(p * 3); break;
    case 'char-wave':
      fx.dy = (1 - easeOutBack(p, 2)) * 0.8; fx.opacity = clamp01(p * 2.5); break;
    case 'char-typewriter':
      fx.opacity = p > 0 ? 1 : 0; break;
    case 'word-highlight':
      fx.opacity = clamp01(p * 3); break;
    default: break;
  }
  return fx;
}

export interface UnitTiming {
  /** início (s, relativo ao texto) de cada unidade; sem isso, cascata automática */
  starts?: number[];
  /** duração total do texto */
  duration: number;
}

/**
 * Estado da unidade i (de `count`) em `local` segundos.
 * `role`: 'in' (entrada), 'out' (saída, cascata inversa no fim), 'loop'.
 */
export function unitFx(anim: TextAnimation, kind: UnitKind, i: number, count: number, local: number, timing: UnitTiming, role: 'in' | 'out' | 'loop' = 'in'): UnitFx {
  const d = unitDuration(kind);
  if (role === 'loop') {
    const fx = { ...UNIT_NEUTRAL };
    const ph = local * Math.PI * 2;
    switch (anim) {
      case 'char-wave': fx.dy = Math.sin(ph * 1.2 - i * 0.55) * 0.12; break;
      case 'word-bounce': fx.dy = -Math.abs(Math.sin(ph * 0.8 - i * 0.7)) * 0.18; break;
      case 'word-pop': case 'char-pop': fx.scale = 1 + 0.08 * Math.max(0, Math.sin(ph * 0.8 - i * 0.9)); break;
      case 'word-highlight': {
        const active = Math.floor((local * 2.5) % Math.max(1, count));
        fx.highlight = i === active ? 1 : 0;
        break;
      }
      default: break;
    }
    return fx;
  }
  const window = Math.min(timing.duration * 0.55, kind === 'word' ? 1.6 : 1.2);
  const starts = timing.starts ?? staggerStarts(count, kind, window);
  if (role === 'out') {
    // cascata inversa terminando no fim do texto
    const outStarts = staggerStarts(count, kind, window);
    const endWin = (outStarts[count - 1] ?? 0) + d;
    const t0 = timing.duration - endWin;
    const rev = count - 1 - i;
    const p = clamp01((local - t0 - (outStarts[rev] ?? 0)) / d);
    return intro(anim, 1 - p);
  }
  const s = starts[i] ?? 0;
  if (anim === 'word-highlight') {
    // a caixa acompanha a palavra "da vez" (a mais recente que começou)
    const fx = intro(anim, clamp01((local - s) / d));
    const next = starts[i + 1] ?? Infinity;
    fx.highlight = local >= s && local < next ? 1 : 0;
    return fx;
  }
  if (anim === 'char-typewriter') return intro(anim, local >= s ? 1 : 0);
  return intro(anim, clamp01((local - s) / d));
}

/** índices globais de letra: offset inicial de cada palavra (sem contar espaços) */
export function charOffsets(words: string[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const w of words) { out.push(acc); acc += [...w].length; }
  return out;
}
