/* aquecimento de shaders sem travar a thread principal (para lib/engine/prewarm.ts, da engine).
   Chame no ócio, repetindo até devolver 'ready'/'failed'/'unavailable'. Mesmas chaves de cache do
   uso real, então o 1º quadro com o efeito/transição já encontra o programa pronto. */
import type { TransitionKind, VisualEffectKind } from '../types';
import { prewarmFx, type WarmState } from './glcore';
import { effectFragment } from './effectShaders';
import { customProgram } from './customRender';
import { isShaderTransition, shaderTransitionFragment } from '../engine/shaderTransitions';
import type { ShaderStage } from './customShader';

export type { WarmState };

/** efeito do catálogo ('ready' direto p/ os que não usam shader: 2D/geometria) */
export function warmupEffect(kind: VisualEffectKind): WarmState {
  const frag = effectFragment(kind);
  return frag ? prewarmFx('fx:' + kind, frag) : 'ready';
}

/** transição do catálogo ('ready' direto p/ as CSS; 'custom' usa warmupCustom) */
export function warmupTransition(kind: TransitionKind): WarmState {
  if (kind === 'custom' || !isShaderTransition(kind)) return 'ready';
  const frag = shaderTransitionFragment(kind);
  return frag ? prewarmFx('tr:' + kind, frag) : 'failed';
}

/** código escrito pela IA (efeito ou transição) */
export function warmupCustom(code: string | undefined, stage: ShaderStage): WarmState {
  const prog = customProgram(code, stage);
  return prog ? prewarmFx(prog.key, prog.src) : 'failed';
}
