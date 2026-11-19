/* =====================================================================
   Pré-aquecimento dos shaders de transição: compilar um programa WebGL na
   1ª vez trava a página (SwiftShader ~1,5–2 s; celular também engasga).
   Compilamos antes: no ócio (pausado) todos os do projeto, e durante a
   reprodução o da próxima transição ~1,5 s antes dela.
   ===================================================================== */
import type { Project, Seconds, TransitionKind } from '@/lib/types';
import { isShaderTransition, runShaderTransition, shaderTransitionsAvailable } from '@/lib/engine/shaderTransitions';

const warmed = new Set<string>();

/** tipos de transição em shader usados no projeto (na ordem do tempo), sem repetir */
export function shaderKindsIn(p: Project, from: Seconds = 0, until: Seconds = Infinity): TransitionKind[] {
  const hits: { t: number; kind: TransitionKind }[] = [];
  for (const tr of p.tracks) {
    if (tr.hidden || (tr.kind !== 'video' && tr.kind !== 'overlay')) continue;
    for (const c of tr.clips) {
      const k = (c as { transitionIn?: { kind: TransitionKind; duration: number } }).transitionIn;
      if (!k || !(k.duration > 0) || !isShaderTransition(k.kind)) continue;
      if (c.start + k.duration < from || c.start > until) continue;
      hits.push({ t: c.start, kind: k.kind });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  return [...new Set(hits.map((h) => h.kind))];
}

/** localStorage 'ep:pv-warm' = '0' desliga (comparação) */
function warmDisabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ep:pv-warm') === '0'; } catch { return false; }
}

let tiny: HTMLCanvasElement | null = null;
/** compila o shader `kind` (desenhando 2×2); true se já estava pronto */
export function warmShader(kind: TransitionKind): boolean {
  if (warmed.has(kind)) return true;
  if (warmDisabled()) return false;
  warmed.add(kind);
  if (typeof document === 'undefined' || !isShaderTransition(kind) || !shaderTransitionsAvailable()) return false;
  if (!tiny) { tiny = document.createElement('canvas'); tiny.width = 2; tiny.height = 2; tiny.getContext('2d')?.fillRect(0, 0, 2, 2); }
  try { runShaderTransition(kind as never, tiny, tiny, 0.5, 2, 2); } catch { /* fica p/ o fallback */ }
  return false;
}

export function isWarm(kind: TransitionKind): boolean {
  return warmed.has(kind);
}

/** aquece no ócio, um shader por vez (não trava a interação) */
export function warmIdle(kinds: TransitionKind[]): () => void {
  const todo = kinds.filter((k) => !warmed.has(k));
  let cancelled = false;
  type RIC = (cb: () => void, o?: { timeout: number }) => number;
  const ric: RIC = (typeof window !== 'undefined' && (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback) || ((cb) => window.setTimeout(cb, 200));
  const next = () => {
    if (cancelled || !todo.length) return;
    warmShader(todo.shift()!);
    ric(next, { timeout: 2000 });
  };
  if (todo.length) ric(next, { timeout: 2000 });
  return () => { cancelled = true; };
}
