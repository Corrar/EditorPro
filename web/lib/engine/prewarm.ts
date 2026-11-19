/* =====================================================================
   PRÉ-AQUECIMENTO de shaders (transições e efeitos por pixel): compilar um
   programa WebGL no 1º uso trava a página (SwiftShader ~250–500 ms; celular
   também engasga) — e era isso que fazia "a transição/efeito demorar para
   aparecer" ao aplicar. Compilamos antes:
     - no ócio, depois da carga: primeiro o que o projeto usa, depois o catálogo;
     - ao passar o dedo/mouse num item do catálogo (prewarmTransition/prewarmEffect);
     - tocando, a próxima transição ~1,5 s antes (components/preview).
   A compilação é feita em etapas pela API de lib/fx/warm (sem desenhar nada e sem travar).
   ===================================================================== */
import type { Project, TransitionKind, VisualEffectKind } from '../types';
import { isShaderTransition } from './shaderTransitions';
import { EFFECT_CATALOG, TRANSITION_CATALOG } from '../fx/catalog';
import { warmupCustom, warmupEffect, warmupTransition, type WarmState } from '../fx/warm';

const warmedTr = new Set<string>();
const warmedFx = new Set<string>();
const warmedCustom = new Set<string>();

function disabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ep:pv-warm') === '0'; } catch { return false; }
}

type RIC = (cb: (d?: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
function ric(cb: () => void, timeout: number) {
  const r = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback : undefined;
  if (r) r(cb, { timeout }); else setTimeout(cb, 60);
}

/**
 * Compilação em etapas (lib/fx/warm, KHR_parallel_shader_compile): cada chamada só DISPARA ou CONSULTA
 * a compilação — nunca trava a thread. Enquanto der 'pending', tenta de novo na próxima fatia ociosa.
 * Sem a extensão, a 1ª chamada dispara e a 2ª finaliza (bloqueando só o que faltar): uma por fatia.
 */
const inflight = new Set<string>();
function pump(key: string, step: () => WarmState, done: () => void) {
  if (inflight.has(key)) return;
  inflight.add(key);
  const run = () => {
    let st: WarmState;
    try { st = step(); } catch { st = 'failed'; }
    if (st === 'pending') { ric(run, 1000); return; }
    inflight.delete(key);
    done();
  };
  run();
}

export function isTransitionWarm(kind: TransitionKind): boolean {
  return warmedTr.has(kind);
}

/** compila o shader da transição (se for de shader), sem travar; true se já estava pronto */
export function prewarmTransition(kind: TransitionKind): boolean {
  if (warmedTr.has(kind)) return true;
  if (typeof document === 'undefined' || disabled()) return false;
  if (!isShaderTransition(kind)) { warmedTr.add(kind); return true; }
  pump('tr:' + kind, () => warmupTransition(kind), () => warmedTr.add(kind));
  return warmedTr.has(kind);
}

/** compila o(s) programa(s) do efeito por pixel; 2D/geometria ficam prontos na hora */
export function prewarmEffect(kind: VisualEffectKind): boolean {
  if (warmedFx.has(kind)) return true;
  if (typeof document === 'undefined' || disabled()) return false;
  pump('fx:' + kind, () => warmupEffect(kind), () => warmedFx.add(kind));
  return warmedFx.has(kind);
}

/** compila um shader 'custom' escrito pela IA (efeito ou transição); idempotente por código */
export function prewarmCustom(code: string | undefined, stage: 'effect' | 'transition'): boolean {
  if (!code) return true;
  const k = stage + '|' + code;
  if (warmedCustom.has(k)) return true;
  if (typeof document === 'undefined' || disabled()) return false;
  pump('c:' + k, () => warmupCustom(code, stage), () => warmedCustom.add(k));
  return warmedCustom.has(k);
}

/** shaders 'custom' (código GLSL da IA) usados entre `from` e `until` (tempo de timeline) */
export function customShadersIn(p: Project, from = 0, until = Infinity): { code: string; stage: 'effect' | 'transition' }[] {
  const out: { code: string; stage: 'effect' | 'transition' }[] = [];
  for (const track of p.tracks) for (const c of track.clips) {
    if (c.start > until || c.start + c.duration < from) continue;
    const ti = (c as { transitionIn?: { kind: string; code?: string } }).transitionIn;
    if (ti?.kind === 'custom' && ti.code) out.push({ code: ti.code, stage: 'transition' });
    for (const e of (c as { effects?: { kind: string; code?: string }[] }).effects ?? []) if (e.kind === 'custom' && e.code) out.push({ code: e.code, stage: 'effect' });
  }
  return out;
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
    customShadersIn(p).forEach((x) => add(() => prewarmCustom(x.code, x.stage)));
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
