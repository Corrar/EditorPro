/* Painéis de clipe sem seleção (Efeitos, Ajustes, Cor, Transições): qual clipe pegar com um toque.
   Puro (testado): o clipe aceito que está sob o cursor (vídeo/imagem antes de texto/sticker; camada
   de cima antes da de baixo); sem nenhum sob o cursor, o mais perto dele. */
import type { Clip, Project, Seconds } from '@/lib/types';

export interface PickedClip { clip: Clip; underPlayhead: boolean }

const MEDIA = new Set<Clip['type']>(['video', 'image']);

export function clipForPanel(p: Project, t: Seconds, accept: (c: Clip) => boolean): PickedClip | null {
  const all = p.tracks.flatMap((tr, layer) => (tr.hidden ? [] : tr.clips.filter(accept).map((clip) => ({ clip, layer }))));
  if (!all.length) return null;
  const end = Math.max(...all.map((x) => x.clip.start + x.clip.duration));
  const at = Math.min(t, end - 1e-3);
  const under = all.filter((x) => x.clip.start <= at + 1e-6 && at < x.clip.start + x.clip.duration);
  if (under.length) {
    under.sort((a, b) => Number(MEDIA.has(b.clip.type)) - Number(MEDIA.has(a.clip.type)) || b.layer - a.layer);
    return { clip: under[0].clip, underPlayhead: true };
  }
  const dist = (c: Clip) => (at < c.start ? c.start - at : at - (c.start + c.duration));
  all.sort((a, b) => dist(a.clip) - dist(b.clip) || Number(MEDIA.has(b.clip.type)) - Number(MEDIA.has(a.clip.type)));
  return { clip: all[0].clip, underPlayhead: false };
}
