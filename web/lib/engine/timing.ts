/* mapeamento de tempo e visibilidade de clipes, incluindo transições (puro) */
import { easeTransitionProgress } from '../fx/native';
import type { Clip, ImageClip, Project, Seconds, ShapeClip, StickerClip, Track, Transition, VideoClip } from '../types';
import { mapSourceTime, rateAt } from './speed';

/** clipes que viram camada visual em trilhas de vídeo/sobreposição */
export type VisualClip = VideoClip | ImageClip | StickerClip | ShapeClip;

export function isVisual(c: Clip): c is VisualClip {
  return c.type === 'video' || c.type === 'image' || c.type === 'sticker' || c.type === 'shape';
}

/** velocidade instantânea do clipe em t (curvas incluídas) */
export function clipSpeed(c: Clip, t?: Seconds): number {
  if (c.type !== 'video' && c.type !== 'audio') return 1;
  return rateAt(c, t === undefined ? 0 : Math.max(0, Math.min(t - c.start, c.duration)));
}

/** tempo na mídia de origem p/ o tempo de timeline t (curva de velocidade e reverso incluídos;
 *  pode passar do fim do clipe — "continuação" em transições) */
export function sourceTime(c: Clip, t: Seconds): Seconds {
  return mapSourceTime(c as Parameters<typeof mapSourceTime>[0], t);
}

export function effectiveTransition(c: Clip): Transition | null {
  if (c.type !== 'video' && c.type !== 'image') return null;
  if (!c.transitionIn) return null;
  const tr = c.transitionIn;
  if (!tr || tr.kind === 'cut' || !(tr.duration > 0)) return null;
  return { kind: tr.kind, duration: Math.min(tr.duration, c.duration), ...(tr.easing ? { easing: tr.easing } : {}) };
}

/** multiplicador de opacidade por fadeIn/fadeOut (só vídeo tem esses campos no contrato) */
export function fadeOpacity(c: Clip, t: Seconds): number {
  if (c.type !== 'video') return 1;
  const local = t - c.start;
  let o = 1;
  if (c.fadeIn && c.fadeIn > 0) o *= Math.min(1, Math.max(0, local / c.fadeIn));
  if (c.fadeOut && c.fadeOut > 0) o *= Math.min(1, Math.max(0, (c.duration - local) / c.fadeOut));
  return o;
}

export interface LayerItem {
  clip: VisualClip;
  /** progresso da transição 0..1 quando há uma ativa */
  transition?: { kind: Transition['kind']; progress: number; role: 'in' | 'out' };
}

/**
 * Itens visuais de uma trilha de vídeo no tempo t, na ordem de desenho.
 * Transição: ocorre no começo do clipe que entra (B), durante tr.duration; o
 * clipe anterior (A) — se terminar exatamente onde B começa (ou com lacuna
 * pequena) — continua sendo desenhado além do seu fim, como "saída".
 */
export function trackLayers(track: Track, t: Seconds): LayerItem[] {
  if (track.hidden || (track.kind !== 'video' && track.kind !== 'overlay')) return [];
  const clips = track.clips.filter(isVisual);
  const out: LayerItem[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const end = c.start + c.duration;
    if (t < c.start || t >= end) continue;
    const tr = effectiveTransition(c);
    const local = t - c.start;
    if (tr && local < tr.duration) {
      const progress = easeTransitionProgress(tr.easing, local / tr.duration);
      const prev = i > 0 ? clips[i - 1] : null;
      if (prev && Math.abs(prev.start + prev.duration - c.start) <= GAP_TOLERANCE) {
        // remove a entrada "normal" do anterior (se ainda ativo por arredondamento) e põe como saída
        const k = out.findIndex((x) => x.clip.id === prev.id);
        if (k >= 0) out.splice(k, 1);
        out.push({ clip: prev, transition: { kind: tr.kind, progress, role: 'out' } });
      }
      out.push({ clip: c, transition: { kind: tr.kind, progress, role: 'in' } });
    } else {
      out.push({ clip: c });
    }
  }
  return out;
}

/** tolerância p/ considerar dois clipes "colados" (transição entre eles) */
export const GAP_TOLERANCE = 0.05;

/** camadas de todas as trilhas de vídeo (baixo p/ cima) */
export function visualLayers(p: Project, t: Seconds): LayerItem[] {
  return p.tracks.flatMap((tr) => trackLayers(tr, t));
}

/** clipes de vídeo/áudio que precisam estar tocando em t (inclui "continuação" de saída de transição) */
export function activeMediaClips(p: Project, t: Seconds): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of p.tracks) {
    if (track.kind === 'video') {
      for (const l of trackLayers(track, t)) out.push({ clip: l.clip, track });
    } else if (track.kind === 'audio') {
      for (const c of track.clips) if (t >= c.start && t < c.start + c.duration) out.push({ clip: c, track });
    }
  }
  return out;
}
