/* =====================================================================
   Renderização HÍBRIDA do preview (pura, testada em hybrid.test.ts).
   Modo NATIVO: a camada base é o próprio <video> visível (decodificação e
   composição por hardware, sem drawImage por quadro); um <canvas> transparente
   por cima desenha só textos/legendas/stickers/formas. Keyframes de posição/
   escala/rotação/opacidade, fades e filtros simples (brilho/contraste/saturação/
   matiz) viram CSS no <video>.
   Modo CANVAS (composição total pelo renderFrame) só nos trechos que exigem:
   transição entre clipes, looks com ajuste por pixel, efeitos, máscara, chroma,
   recorte, blend, remover fundo, reverso, animação de clipe, PiP/2ª trilha,
   camada de ajuste e fundo desfocado/imagem. O export não muda (sempre renderFrame).
   ===================================================================== */
import type { Clip, Project, Seconds, Track, TransitionKind, VideoClip } from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { trackLayers, fadeOpacity } from '@/lib/engine/timing';
import { interpolateTransform } from '@/lib/engine/easing';
import { clipAnimFx } from '@/lib/engine/animations';
import { resolveFilters, needsPixelGrade } from '@/lib/engine/filters';
import { transitionVisual, type TransitionVisual } from '@/lib/engine/transitions';
import { isShaderTransition } from '@/lib/engine/shaderTransitions';
import { gradeNeedsCanvas, gradeCssEquivalent } from '@/lib/color';
import { effectsNativeMode } from '@/lib/fx/native';
import { animateClip } from '@/lib/engine/animate';
import { effectGeometry } from '@/lib/engine/effects';

/** uma camada nativa: um <video> visível com geometria/opacidade/filtro em CSS */
export interface NativeLayer {
  clip: VideoClip;
  opacity: number;
  filter: string;
  /** visual da transição (CSS) quando dois clipes se sobrepõem num corte com transição simples */
  tv?: TransitionVisual;
  /** ordem de empilhamento (o que entra fica por cima) */
  z: number;
}

export type NativePlan =
  | { native: true; track: Track; layers: NativeLayer[] }
  | { native: false; reason: string };

const no = (reason: string): NativePlan => ({ native: false, reason });

/** a trilha principal: 1ª trilha de vídeo visível (a de baixo na composição) */
export function mainVideoTrack(p: Project): Track | undefined {
  return p.tracks.find((tr) => tr.kind === 'video' && !tr.hidden);
}

const cssCache = new Map<string, boolean>();
/**
 * Transição que dá para fazer só com CSS nos dois <video> (opacidade, deslocamento,
 * escala, rotação, desfoque): fade/dissolve, slides, zooms, push… Flash, mergulho de
 * cor, cortina, glitch, pixelado, RGB, queimado, borrão de movimento e shaders → canvas.
 */
export function isCssTransition(kind: TransitionKind): boolean {
  const hit = cssCache.get(kind);
  if (hit !== undefined) return hit;
  let ok = !isShaderTransition(kind);
  for (const pr of [0.15, 0.35, 0.5, 0.65, 0.85]) {
    if (!ok) break;
    for (const role of ['in', 'out'] as const) {
      const v = transitionVisual(kind, pr, role);
      if (v.flash > 0.001 || v.glitch > 0.01 || v.pixelate > 0.01 || v.rgbSplit > 0.01 || v.burn > 0.01 || v.shake > 0.001
        || v.motionBlur > 0.05 || v.reveal || (v.dip && v.dip.alpha > 0.001)) { ok = false; break; }
    }
  }
  cssCache.set(kind, ok);
  return ok;
}

/** decide o modo do quadro em t */
export function nativePlan(p: Project, t: Seconds): NativePlan {
  if (p.canvas && p.canvas.type !== 'color') return no(p.canvas.type === 'blur' ? 'fundo desfocado' : 'imagem de fundo');
  const main = mainVideoTrack(p);
  if (!main) return no('sem trilha de vídeo');
  const items = trackLayers(main, t);
  if (items.length === 0) return no('sem clipe');
  // outras camadas que precisam ficar ENTRE a base e o resto: canvas
  for (const tr of p.tracks) {
    if (tr === main || tr.hidden) continue;
    if (tr.kind === 'video' && trackLayers(tr, t).length) return no('2ª trilha de vídeo');
    if (tr.kind === 'overlay' && tr.clips.some((c) => c.type === 'video' && t >= c.start && t < c.start + c.duration)) return no('PiP');
    if (tr.kind === 'effect' && tr.clips.some((c) => c.type === 'adjustment' && t >= c.start && t < c.start + c.duration)) return no('camada de ajuste');
  }
  if (items.length > 2) return no('camadas sobrepostas');
  const layers: NativeLayer[] = [];
  for (const it of items) {
    // keyframes universais: filtros/efeitos/cor/máscara animados entram na decisão e no CSS
    const clip = animateClip(it.clip, t - it.clip.start);
    if (clip.type !== 'video') return no(clip.type === 'image' ? 'imagem' : 'camada especial');
    const why = clipNeedsCanvas(clip, t);
    if (why) return no(why);
    let tv: TransitionVisual | undefined;
    if (it.transition) {
      if (!isCssTransition(it.transition.kind)) return no('transição');
      tv = transitionVisual(it.transition.kind, it.transition.progress, it.transition.role);
    } else if (items.length > 1) return no('camadas sobrepostas');
    const f = resolveFilters(clip.filters, clip.colorPreset, 1);
    const local = t - clip.start;
    const tf = interpolateTransform(clip.transform ?? DEFAULT_TRANSFORM, clip.keyframes, Math.min(Math.max(0, local), clip.duration));
    // (como no drawLayer: o clipe que sai não aplica o próprio fade)
    const fade = it.transition?.role === 'out' ? 1 : fadeOpacity(clip, t);
    const opacity = Math.max(0, Math.min(1, tf.opacity * fade * (tv ? tv.opacity : 1)));
    const filter = [f.css, gradeCssEquivalent(clip.colorGrade)].filter((x) => x && x !== 'none').join(' ') || 'none';
    layers.push({ clip, opacity, filter, tv, z: it.transition?.role === 'out' ? 0 : 1 });
  }
  return { native: true, track: main, layers };
}

/** motivo para o clipe precisar do canvas (ou null se o <video> nativo dá conta) */
export function clipNeedsCanvas(clip: Clip, t: Seconds): string | null {
  if (clip.type !== 'video') return 'não é vídeo';
  if (clip.reverse) return 'reverso';
  // efeitos: 'css' (geometria vira CSS no <video>) fica nativo; 'overlay' e 'canvas' compõem no canvas
  if (clip.effects?.length && effectsNativeMode(clip.effects) !== 'css') return 'efeito';
  if (clip.mask) return 'máscara';
  if (clip.chromaKey) return 'chroma';
  if (clip.removeBackground) return 'remover fundo';
  if (clip.blendMode && clip.blendMode !== 'normal') return 'mesclagem';
  const cr = clip.crop;
  if (cr && (cr.w < 0.999 || cr.h < 0.999 || cr.x > 0.001 || cr.y > 0.001)) return 'recorte';
  const f = resolveFilters(clip.filters, clip.colorPreset, 1);
  if (needsPixelGrade(f) || f.temperature || f.tint || f.fade || f.vignette || f.grain) return 'look';
  // correção de cor: CSS quando há equivalente (exposição/contraste/saturação), senão WebGL no canvas
  if (gradeNeedsCanvas(clip.colorGrade)) return 'cor';
  if (/blur\(/.test(f.css)) return 'desfoque';
  const a = clipAnimFx(clip, Math.max(0, t - clip.start), clip.duration);
  if (a.opacity < 0.999 || a.dx || a.dy || Math.abs(a.scale - 1) > 0.001 || a.rotation || a.blur || a.scaleX !== 1) return 'animação';
  return null;
}

export interface NativeGeometry {
  x: number; y: number; w: number; h: number; rot: number; fx: number; fy: number;
  /** recorte (px, relativo à caixa do elemento) que imita o clip do quadro deslocado numa transição */
  clip?: { top: number; right: number; bottom: number; left: number };
}

/**
 * Retângulo do <video> no quadro (px CSS, W×H) — mesma conta do drawLayer:
 * encaixe (cover/contain/fill), escala, posição relativa, rotação e espelho.
 */
export function nativeGeometry(clip: VideoClip, t: Seconds, W: number, H: number, sw: number, sh: number, tv?: TransitionVisual): NativeGeometry {
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  const tf = interpolateTransform(clip.transform ?? DEFAULT_TRANSFORM, clip.keyframes, local);
  const fit = clip.fit || 'cover';
  let dw: number, dh: number;
  if (fit === 'fill') { dw = W; dh = H; } else {
    const k = fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    dw = sw * k; dh = sh * k;
  }
  const eg = effectGeometry(clip.effects, t);
  const s = Math.max(0.0001, tf.scale) * (tv ? tv.scale : 1) * eg.scale;
  dw *= s; dh *= s;
  const tdx = tv ? tv.dx : 0, tdy = tv ? tv.dy : 0;
  const cx = W / 2 + (tf.x + tdx + eg.dx) * W;
  const cy = H / 2 + (tf.y + tdy + eg.dy) * H;
  const rot = tf.rotation + (tv ? tv.rotation : 0) + eg.rotation;
  const g: NativeGeometry = { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, rot, fx: clip.flipH ? -1 : 1, fy: clip.flipV ? -1 : 1 };
  // slide: o canvas recorta a camada no quadro deslocado; aqui, clip-path na caixa (sem rotação)
  if ((tdx || tdy) && !rot) {
    const fx0 = tdx * W, fy0 = tdy * H;
    g.clip = {
      left: Math.max(0, fx0 - g.x), top: Math.max(0, fy0 - g.y),
      right: Math.max(0, g.x + g.w - (fx0 + W)), bottom: Math.max(0, g.y + g.h - (fy0 + H)),
    };
  }
  return g;
}

/** clip-path CSS da geometria ('' = sem recorte) */
export function geometryClip(g: NativeGeometry): string {
  const c = g.clip;
  if (!c || (c.top < 0.5 && c.right < 0.5 && c.bottom < 0.5 && c.left < 0.5)) return '';
  return `inset(${c.top.toFixed(1)}px ${c.right.toFixed(1)}px ${c.bottom.toFixed(1)}px ${c.left.toFixed(1)}px)`;
}

/** filtro CSS da camada (filtros simples + desfoque da transição, em px do quadro) */
export function layerFilter(l: NativeLayer, W: number, H: number): string {
  const blurPx = l.tv ? l.tv.blur * Math.min(W, H) * 0.03 : 0;
  const parts = [l.filter !== 'none' ? l.filter : '', blurPx > 0.3 ? `blur(${blurPx.toFixed(1)}px)` : ''].filter(Boolean);
  return parts.join(' ');
}

/** transform CSS (origem no centro do elemento) */
export function geometryTransform(g: NativeGeometry): string {
  let s = `translate(${g.x.toFixed(2)}px,${g.y.toFixed(2)}px)`;
  if (g.rot) s += ` rotate(${g.rot.toFixed(3)}deg)`;
  if (g.fx !== 1 || g.fy !== 1) s += ` scale(${g.fx},${g.fy})`;
  return s;
}
