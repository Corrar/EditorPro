/* renderização dos shaders da IA no motor (preview e export usam o mesmo caminho) */
import type { Transition, VisualEffect } from '../types';
import type { AnyCanvas, Ctx } from '../engine/surface';
import { hexToRgb01, runFx } from './glcore';
import { shaderHash, staticCheck, wrapShader, type ShaderStage } from './customShader';
import type { FxOpts } from './effects2d';

const srcCache = new Map<string, { key: string; src: string } | null>();

/** fonte embrulhada + chave do programa (null = código inválido pelas checagens estáticas) */
function prepared(code: string | undefined, stage: ShaderStage): { key: string; src: string } | null {
  if (!code) return null;
  const h = shaderHash(code, stage);
  if (srcCache.has(h)) return srcCache.get(h)!;
  const v = staticCheck(code, stage).ok ? { key: 'c:' + stage[0] + ':' + h, src: wrapShader(code, stage) } : null;
  if (srcCache.size > 256) srcCache.clear();
  srcCache.set(h, v);
  return v;
}

function params8(p: number[] | undefined): Float32Array {
  const a = new Float32Array(8);
  (p ?? []).slice(0, 8).forEach((v, i) => { a[i] = Number.isFinite(v) ? v : 0; });
  return a;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Aplica o efeito 'custom' na superfície (no lugar). Qualquer falha (sem WebGL, código inválido,
 * não compila, GPU caiu) = passagem direta: a superfície fica como estava.
 */
export function applyCustomEffect(ctx: Ctx, W: number, H: number, e: VisualEffect, t: number, o: FxOpts = {}): boolean {
  const prep = prepared(e.code, 'effect');
  if (!prep) return false;
  const duration = Math.max(0, num(o.duration, 0));
  const local = num(o.local, num(t, 0));
  let out: AnyCanvas | null = null;
  try {
    out = runFx(prep.key, prep.src, [['uTex', ctx.canvas as TexImageSource]], W, H, {
      uResolution: [W, H],
      uTime: local,
      uDuration: duration,
      uProgress: duration > 0 ? Math.min(1, Math.max(0, local / duration)) : 0,
      uIntensity: Math.max(0, Math.min(1, num(e.intensity, 1))),
      uSpeed: Math.max(0, num(e.speed, 1)),
      uColor: hexToRgb01(e.color),
      uParams: params8(e.params),
    }, { premultiply: false });
  } catch { out = null; }
  if (!out) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(out as CanvasImageSource, 0, 0, W, H);
  ctx.restore();
  return true;
}

const CROSSFADE = 'precision mediump float;varying vec2 v_uv;uniform sampler2D uFrom,uTo;uniform float uProgress;' +
  'void main(){gl_FragColor=mix(texture2D(uFrom,v_uv),texture2D(uTo,v_uv),uProgress);}';

/** transição 'custom' (crossfade se o código falhar). null só sem WebGL. */
export function runCustomTransition(tr: Transition | undefined, from: TexImageSource, to: TexImageSource, progress: number, W: number, H: number): AnyCanvas | null {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const prep = prepared(tr?.code, 'transition');
  if (prep) {
    try {
      const out = runFx(prep.key, prep.src, [['uFrom', from], ['uTo', to]], W, H, {
        uResolution: [W, H], uProgress: p, uTime: p * Math.max(0, num(tr?.duration, 0)), uParams: params8(tr?.params),
      }, { premultiply: false });
      if (out) return out;
    } catch { /* cai no crossfade */ }
  }
  return runFx('tr:custom-crossfade', CROSSFADE, [['uFrom', from], ['uTo', to]], W, H, { uProgress: p });
}

/** chave + fonte do programa de um código da IA (null = inválido nas checagens estáticas) */
export function customProgram(code: string | undefined, stage: ShaderStage): { key: string; src: string } | null {
  return prepared(code, stage);
}

/** compila antes de precisar (evita engasgo no 1º quadro ao trocar nativo→canvas) */
export function warmCustomShader(code: string | undefined, stage: ShaderStage): void {
  const prep = prepared(code, stage);
  if (!prep || typeof document === 'undefined') return;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const tex: [string, TexImageSource][] = stage === 'effect' ? [['uTex', c]] : [['uFrom', c], ['uTo', c]];
    runFx(prep.key, prep.src, tex, 2, 2, { uResolution: [2, 2] }, { premultiply: false });
  } catch { /* ignora */ }
}
