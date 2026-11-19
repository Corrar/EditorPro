/* =====================================================================
   Arrastar texto/sticker/forma/PiP direto no preview (puro, testado em
   manipulate.test.ts): caixa de cada camada no quadro, quem está sob o dedo,
   e o patch da op ao mover (com encaixe em centro/terços/zona segura).
   Coordenadas normalizadas 0..1 do quadro.
   ===================================================================== */
import type { Clip, Project, Seconds, TextClip } from '@/lib/types';
import { DEFAULT_TRANSFORM } from '@/lib/types';
import { interpolateTransform } from '@/lib/engine/easing';
import { clipShapeAspect } from '@/lib/engine/shapes';
import { snapTo, snapTargets } from './viewing';

export interface Box { cx: number; cy: number; w: number; h: number }
/** mede a largura de um texto em px (canvas.measureText) */
export type Measure = (text: string, fontPx: number, clip: TextClip) => number;

const active = (c: Clip, t: Seconds) => t >= c.start && t < c.start + c.duration;

/** caixa do texto (mesma regra do drawTextClip: largura máx. 86% e quebra por palavra) */
export function textBox(clip: TextClip, t: Seconds, W: number, H: number, measure: Measure): Box {
  const local = Math.max(0, t - clip.start);
  const tf = interpolateTransform({ x: 0, y: 0, scale: clip.scale ?? 1, rotation: clip.rotation ?? 0, opacity: 1 }, clip.keyframes, local);
  const px = (clip.style.fontSize * H) / 1920;
  const text = clip.style.uppercase ? clip.text.toLocaleUpperCase('pt-BR') : clip.text;
  const maxW = W * 0.86;
  let lines = 0, widest = 0;
  for (const para of text.split('\n')) {
    let line = 0;
    lines++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const ww = measure(word, px, clip), sp = measure(' ', px, clip);
      if (line > 0 && line + sp + ww > maxW) { widest = Math.max(widest, line); line = ww; lines++; }
      else line = line ? line + sp + ww : ww;
    }
    widest = Math.max(widest, line);
  }
  const pad = clip.style.background ? px * 0.5 : px * 0.2;
  const s = tf.scale;
  return {
    cx: clip.position.x + tf.x, cy: clip.position.y + tf.y,
    w: Math.min(1, ((widest + pad * 2) * s) / W), h: Math.min(1, ((lines * px * 1.2 + pad * 2) * s) / H),
  };
}

/** caixa de sticker/forma/PiP (mesma conta do drawLayer) */
export function visualBox(clip: Clip, t: Seconds, W: number, H: number, mediaAspect?: number): Box | null {
  if (!('transform' in clip)) return null;
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  const tf = interpolateTransform(clip.transform ?? DEFAULT_TRANSFORM, 'keyframes' in clip ? clip.keyframes : undefined, local);
  let dw: number, dh: number;
  if (clip.type === 'sticker' || clip.type === 'shape') {
    const base = Math.min(W, H) * 0.95;
    const asp = clip.type === 'shape' ? clipShapeAspect(clip) : (mediaAspect || 1);
    dh = asp >= 1 ? base / asp : base;
    dw = dh * asp;
  } else {
    // vídeo/imagem (PiP): encaixe 'cover' do quadro, escalado
    const asp = mediaAspect || W / H;
    const k = Math.max(W / asp, H);
    dw = asp * k; dh = k;
    if ('fit' in clip && clip.fit === 'contain') { const kc = Math.min(W / asp, H); dw = asp * kc; dh = kc; }
  }
  return { cx: 0.5 + tf.x, cy: 0.5 + tf.y, w: (dw * tf.scale) / W, h: (dh * tf.scale) / H };
}

export interface Hit { clip: Clip; box: Box }

/**
 * Camada sob o ponto (x,y): a de cima primeiro (textos > sobreposições). A trilha
 * principal de vídeo não é arrastável. Caixas pequenas ganham folga p/ o dedo (44 px).
 */
export function hitTest(p: Project, t: Seconds, x: number, y: number, W: number, H: number, measure: Measure, slackPx = 22, aspectOf?: (c: Clip) => number | undefined): Hit | null {
  const mainVideo = p.tracks.find((tr) => tr.kind === 'video' && !tr.hidden);
  for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
    const tr = p.tracks[ti];
    if (tr.hidden || tr.locked || tr === mainVideo) continue;
    if (tr.kind !== 'text' && tr.kind !== 'overlay' && tr.kind !== 'video') continue;
    for (let ci = tr.clips.length - 1; ci >= 0; ci--) {
      const c = tr.clips[ci];
      if (!active(c, t) || c.locked) continue;
      const box = c.type === 'text' ? (c.text.trim() ? textBox(c, t, W, H, measure) : null) : visualBox(c, t, W, H, aspectOf?.(c));
      if (!box) continue;
      const sx = Math.max(box.w / 2, slackPx / W), sy = Math.max(box.h / 2, slackPx / H);
      if (Math.abs(x - box.cx) <= sx && Math.abs(y - box.cy) <= sy) return { clip: c, box };
    }
  }
  return null;
}

export interface DragResult { patch: Record<string, unknown>; guideX: number | null; guideY: number | null; center: { x: number; y: number } }

/**
 * Patch p/ mover a camada: o centro vai de `startCenter` + delta, com encaixe no centro/terços
 * (e bordas da zona segura). Texto mexe em `position`; o resto em `transform.x/y`.
 */
export function dragPatch(clip: Clip, startCenter: { x: number; y: number }, dx: number, dy: number,
  safe?: { top: number; bottom: number; left: number; right: number }, snap = true): DragResult {
  let x = startCenter.x + dx, y = startCenter.y + dy;
  let gx: number | null = null, gy: number | null = null;
  if (snap) {
    const sx = snapTo(x, snapTargets('x', safe)), sy = snapTo(y, snapTargets('y', safe));
    x = sx.value; y = sy.value; gx = sx.guide; gy = sy.guide;
  }
  x = Math.min(1.2, Math.max(-0.2, x));
  y = Math.min(1.2, Math.max(-0.2, y));
  const ddx = x - startCenter.x, ddy = y - startCenter.y;
  let patch: Record<string, unknown>;
  if (clip.type === 'text') patch = { position: { x: clip.position.x + ddx, y: clip.position.y + ddy } };
  else {
    const tf = ('transform' in clip && clip.transform) || DEFAULT_TRANSFORM;
    patch = { transform: { ...tf, x: tf.x + ddx, y: tf.y + ddy } };
  }
  return { patch, guideX: gx, guideY: gy, center: { x, y } };
}
