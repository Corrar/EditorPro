/* =====================================================================
   PRÉ-AQUECIMENTO de shaders (transições e efeitos por pixel): compilar um
   programa WebGL no 1º uso trava a página (SwiftShader ~250–500 ms; celular
   também engasga) — e era isso que fazia "a transição/efeito demorar para
   aparecer" ao aplicar. Compilamos antes:
     - no ócio, depois da carga: primeiro o que o projeto usa, depois o catálogo;
     - ao passar o dedo/mouse num item do catálogo (prewarmTransition/prewarmEffect);
     - tocando, a próxima transição ~1,5 s antes (components/preview).
   Desenhar 4×4 px basta para o driver compilar e linkar.
   ===================================================================== */
import type { Project, TransitionKind, VisualEffectKind } from '../types';
import { isShaderTransition, runShaderTransition, shaderTransitionsAvailable } from './shaderTransitions';
import { applySurfaceEffects } from './effects';
import { makeCanvas, type Ctx } from './surface';
import { EFFECT_CATALOG, TRANSITION_CATALOG } from '../fx/catalog';

const warmedTr = new Set<string>();
const warmedFx = new Set<string>();
let tiny: ReturnType<typeof makeCanvas> | null = null;
let fxCv: ReturnType<typeof makeCanvas> | null = null;

function disabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ep:pv-warm') === '0'; } catch { return false; }
}

function tinySrc() {
  // dimensões NÃO potência de 2 (como os quadros reais): alguns drivers (SwiftShader/ANGLE) recompilam
  // o shader por estado de textura — aquecer com 4×4 não evitava a trava no 1º uso real
  if (!tiny) { tiny = makeCanvas(18, 30); const c = tiny.getContext('2d') as Ctx | null; if (c) { c.fillStyle = '#888'; c.fillRect(0, 0, 18, 30); } }
  return tiny;
}

export function isTransitionWarm(kind: TransitionKind): boolean {
  return warmedTr.has(kind);
}

/** compila o shader da transição (se for de shader); true se já estava pronto */
export function prewarmTransition(kind: TransitionKind): boolean {
  if (warmedTr.has(kind)) return true;
  if (typeof document === 'undefined' || disabled()) return false;
  warmedTr.add(kind);
  if (!isShaderTransition(kind) || !shaderTransitionsAvailable()) return false;
  try { runShaderTransition(kind, tinySrc() as TexImageSource, tinySrc() as TexImageSource, 0.5, 18, 30); } catch { /* fallback na hora */ }
  return false;
}

/** compila o(s) programa(s) do efeito por pixel (gl/2d) desenhando 4×4 */
export function prewarmEffect(kind: VisualEffectKind): boolean {
  if (warmedFx.has(kind)) return true;
  if (typeof document === 'undefined' || disabled()) return false;
  warmedFx.add(kind);
  try {
    if (!fxCv) fxCv = makeCanvas(18, 30);
    const c = fxCv.getContext('2d') as Ctx | null;
    if (!c) return false;
    c.fillStyle = '#888'; c.fillRect(0, 0, 18, 30);
    applySurfaceEffects(c, 18, 30, [{ kind, intensity: 0.5 } as never], 0.5, { local: 0.5, duration: 2 });
  } catch { /* só aquecimento */ }
  return false;
}

/** transições/efeitos que o projeto usa (na ordem do tempo), p/ aquecer primeiro */
export function projectWarmList(p: Project): { transitions: TransitionKind[]; effects: VisualEffectKind[] } {
  const tr: { t: number; k: TransitionKind }[] = [];
  const fx = new Set<VisualEffectKind>();
  for (const track of p.tracks) for (const c of track.clips) {
    const ti = (c as { transitionIn?: { kind: TransitionKind; duration: number } }).transitionIn;
    if (ti && ti.duration > 0 && isShaderTransition(ti.kind)) tr.push({ t: c.start, k: ti.kind });
    for (const e of (c as { effects?: { kind: VisualEffectKind }[] }).effects ?? []) fx.add(e.kind);
  }
  tr.sort((a, b) => a.t - b.t);
  return { transitions: [...new Set(tr.map((x) => x.k))], effects: [...fx] };
}

/** fila de aquecimento no ócio: projeto primeiro, depois o catálogo inteiro (shaders e efeitos por pixel) */
export function prewarmIdle(p: Project | null, opts: { catalog?: boolean; isBusy?: () => boolean } = {}): () => void {
  const jobs: (() => void)[] = [];
  const add = (f: () => void) => jobs.push(f);
  if (p) {
    const w = projectWarmList(p);
    w.transitions.forEach((k) => add(() => prewarmTransition(k)));
    w.effects.forEach((k) => add(() => prewarmEffect(k)));
  }
  if (opts.catalog) {
    for (const e of TRANSITION_CATALOG) if (e.render === 'shader' && !warmedTr.has(e.kind)) add(() => prewarmTransition(e.kind));
    for (const e of EFFECT_CATALOG) if ((e.render === 'gl' || e.render === '2d') && !warmedFx.has(e.kind)) add(() => prewarmEffect(e.kind));
  }
  let cancelled = false;
  type RIC = (cb: (d?: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
  const ric: RIC = (typeof window !== 'undefined' && (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback) || ((cb) => window.setTimeout(() => cb(), 120));
  const step = () => {
    if (cancelled || !jobs.length) return;
    if (opts.isBusy?.()) { ric(step, { timeout: 3000 }); return; }
    jobs.shift()!();
    ric(step, { timeout: 3000 });
  };
  if (jobs.length) ric(step, { timeout: 3000 });
  return () => { cancelled = true; };
}
