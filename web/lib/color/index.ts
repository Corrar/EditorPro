/* =====================================================================
   lib/color — API pública do módulo de cor (sessão "cor").
   Ponto único de integração com o render: gradeLayer().
   ===================================================================== */
import type { ColorGrade } from '../types';
import { isNeutralGrade, gradeToCssFilter, gradeCssEquivalent as cssEq } from './grade';
import { resolveGrade, type ResolvedGrade } from './pipeline';
import { getColorGrader } from './gl';
import { getLut, lutVersion } from './luts';

export * from './grade';
export { monotoneSpline, curveTable, sampleTable } from './curves';
export { parseCube, writeCube, sampleLut, CubeParseError, type Lut3D } from './cube';
export { resolveGrade, gradePixel, applyGradeImageData, type ResolvedGrade } from './pipeline';
export { ColorGrader, getColorGrader } from './gl';
export {
  BUILTIN_LOOKS, getLut, registerLut, importCubeFile, loadImportedLuts, importedLuts, deleteImportedLut, onLutsChanged, lutName, lookById,
} from './luts';
export { wheelFromPuck, puckFromWheel } from './wheel';

/* ---------- comparação antes/depois (global, lida por gradeLayer) ---------- */

export interface CompareState { mode: 'off' | 'split' | 'bypass'; split: number }
let compare: CompareState = { mode: 'off', split: 0.5 };
const compareListeners = new Set<() => void>();
export function getCompare(): CompareState { return compare; }
export function setCompare(c: Partial<CompareState>): void {
  compare = { ...compare, ...c };
  compareListeners.forEach((f) => f());
}
export function onCompareChanged(f: () => void): () => void { compareListeners.add(f); return () => { compareListeners.delete(f); }; }

/* ---------- cache da grade resolvida (curvas/LUT só sobem p/ GPU quando mudam) ---------- */

interface Cached { r: ResolvedGrade; v: number }
const resolved = new WeakMap<ColorGrade, Cached>();
/** cache por VALOR: grade animada (Keyframe.props) gera um objeto novo por quadro */
const byValue = new Map<string, Cached>();
export function resolvedFor(g: ColorGrade): ResolvedGrade {
  // a versão do registro só importa se a grade usa LUT (carregou depois / foi excluída)
  const v = g.lut ? lutVersion() : 0;
  const hit = resolved.get(g);
  if (hit && hit.v === v) return hit.r;
  const key = JSON.stringify(g);
  let c = byValue.get(key);
  if (!c || c.v !== v) c = { r: resolveGrade(g, getLut), v };
  resolved.set(g, c);
  byValue.delete(key);
  byValue.set(key, c);
  if (byValue.size > 48) byValue.delete(byValue.keys().next().value as string);
  return c.r;
}

/** precisa passar pelo canvas (não dá para o preview nativo só com CSS)? */
export function gradeNeedsCanvas(g?: ColorGrade | null): boolean {
  if (compare.mode === 'bypass' || isNeutralGrade(g)) return false;
  if (compare.mode === 'split') return true;
  return cssEq(g) === null;
}

let fallback: { c: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;

/**
 * Aplica a correção de cor a uma camada já desenhada/decodificada.
 * - devolve um canvas w×h com o resultado (REUTILIZADO: desenhe logo em seguida)
 * - devolve null quando a grade é neutra (use a fonte original)
 * Sem WebGL, cai para uma aproximação via ctx.filter.
 * `offline` (export): ignora o modo de comparação (Dividir/Original).
 */
export function gradeLayer(source: CanvasImageSource, grade: ColorGrade | undefined | null, w: number, h: number, opts: { offline?: boolean } = {}): CanvasImageSource | null {
  // export (offline): a comparação antes/depois é só do preview — nunca vai para o arquivo
  const cmp = opts.offline ? 'off' : compare.mode;
  if (!grade || cmp === 'bypass' || isNeutralGrade(grade)) return null;
  const R = resolvedFor(grade);
  const grader = getColorGrader();
  const out = grader?.render(source as TexImageSource, R, w, h, undefined, cmp === 'split' ? { split: compare.split } : {});
  if (out) return out as CanvasImageSource;
  // fallback: CSS aproximado
  try {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    if (!fallback || fallback.c.width !== W || fallback.c.height !== H) {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
      fallback = { c, ctx: c.getContext('2d') as CanvasRenderingContext2D };
    }
    const { ctx } = fallback;
    ctx.clearRect(0, 0, W, H);
    ctx.filter = gradeToCssFilter(grade);
    ctx.drawImage(source, 0, 0, W, H);
    ctx.filter = 'none';
    return fallback.c as CanvasImageSource;
  } catch {
    return null;
  }
}
