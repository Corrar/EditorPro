/* =====================================================================
   Timeline — keyframes (puro): interpolação do transform e ops de
   adicionar/remover/mover keyframe. Tempos dos keyframes são RELATIVOS
   ao início do clipe.
   ===================================================================== */
import type { Clip, Easing, Id, Keyframe, Project, Seconds, Transform } from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { findClip, type EditOp } from '../ops';

const KEYS: (keyof Transform)[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

export function supportsKeyframes(c: Clip): boolean {
  return c.type === 'video' || c.type === 'image' || c.type === 'sticker' || c.type === 'shape' || c.type === 'text';
}

export function keyframesOf(c: Clip): Keyframe[] {
  return [...((c as { keyframes?: Keyframe[] }).keyframes ?? [])].sort((a, b) => a.t - b.t);
}

export function baseTransform(c: Clip): Transform {
  return 'transform' in c && c.transform ? { ...DEFAULT_TRANSFORM, ...c.transform } : { ...DEFAULT_TRANSFORM };
}

function ease(e: Easing | undefined, u: number): number {
  switch (e) {
    case 'easeIn': return u * u;
    case 'easeOut': return 1 - (1 - u) * (1 - u);
    case 'easeInOut': return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    default: return u;
  }
}

/** transform efetivo no tempo relativo `tRel` (cada propriedade interpola entre os keyframes que a definem) */
export function transformAt(c: Clip, tRel: Seconds): Transform {
  const base = baseTransform(c);
  const kfs = keyframesOf(c);
  const out = { ...base };
  for (const key of KEYS) {
    const pts = kfs.filter((k) => k.transform[key] != null);
    if (!pts.length) continue;
    if (tRel <= pts[0].t) { out[key] = pts[0].transform[key]!; continue; }
    const last = pts[pts.length - 1];
    if (tRel >= last.t) { out[key] = last.transform[key]!; continue; }
    const i = pts.findIndex((k) => k.t > tRel);
    const a = pts[i - 1];
    const b = pts[i];
    const u = ease(b.easing ?? a.easing, (tRel - a.t) / Math.max(1e-6, b.t - a.t));
    out[key] = a.transform[key]! + (b.transform[key]! - a.transform[key]!) * u;
  }
  return out;
}

/** adiciona keyframe no tempo global `t` com o transform atual — ou remove se já houver um a menos de 1 quadro */
export function keyframeToggleOps(p: Project, clipId: Id, t: Seconds): EditOp[] {
  const f = findClip(p, clipId);
  if (!f || f.track.locked || !supportsKeyframes(f.clip)) return [];
  const c = f.clip;
  const tRel = t - c.start;
  if (tRel < -1e-6 || tRel > c.duration + 1e-6) return [];
  const frame = 1 / (p.fps || 30);
  const kfs = keyframesOf(c);
  const hit = kfs.findIndex((k) => Math.abs(k.t - tRel) < frame * 0.75);
  const next = hit >= 0 ? kfs.filter((_, i) => i !== hit) : [...kfs, { t: Math.max(0, Math.min(c.duration, tRel)), transform: transformAt(c, tRel) }].sort((a, b) => a.t - b.t);
  return [{ op: 'update_clip', clipId, patch: { keyframes: next }, explain: hit >= 0 ? 'Removendo keyframe' : 'Adicionando keyframe' }];
}

/** move o keyframe `index` para o tempo relativo `tRel` (limitado ao clipe) */
export function moveKeyframeOps(p: Project, clipId: Id, index: number, tRel: Seconds): EditOp[] {
  const f = findClip(p, clipId);
  if (!f) return [];
  const kfs = keyframesOf(f.clip);
  if (!kfs[index]) return [];
  const t = Math.max(0, Math.min(f.clip.duration, tRel));
  const next = kfs.map((k, i) => (i === index ? { ...k, t } : k)).sort((a, b) => a.t - b.t);
  return [{ op: 'update_clip', clipId, patch: { keyframes: next } }];
}
