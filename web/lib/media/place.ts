/* =====================================================================
   Colocar mídia na timeline (puro): gera EditOps add_clip.
   ===================================================================== */
import { makeAudioClip, makeImageClip, makeVideoClip } from '../defaults';
import { clipEnd, type EditOp } from '../ops';
import type { MediaAsset, Project, Track, TrackKind } from '../types';
import { uid } from '../util';

export const IMAGE_DEFAULT_DURATION = 3;

export function trackKindForAsset(a: MediaAsset): TrackKind {
  return a.kind === 'audio' ? 'audio' : 'video';
}

export function trackEnd(t: Track): number {
  return t.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** primeira trilha destravada do tipo (ou id novo — add_clip cria a trilha) */
export function targetTrackId(p: Project, kind: TrackKind): string {
  return p.tracks.find((t) => t.kind === kind && !t.locked)?.id ?? uid(`track_${kind}`);
}

function clipFor(a: MediaAsset, start: number) {
  if (a.kind === 'image') return makeImageClip(a, start, IMAGE_DEFAULT_DURATION, { label: a.name });
  if (a.kind === 'audio') return makeAudioClip(a, start, { label: a.name, duration: a.duration || 1 });
  return makeVideoClip(a, start, { duration: a.duration || 1 });
}

/** add_clip do asset no fim da trilha compatível (ou em `at`, se informado) */
export function placeAssetOp(p: Project, a: MediaAsset, opts: { at?: number; trackId?: string } = {}): EditOp {
  const kind = trackKindForAsset(a);
  const trackId = opts.trackId ?? targetTrackId(p, kind);
  const track = p.tracks.find((t) => t.id === trackId);
  const start = opts.at ?? (track ? trackEnd(track) : 0);
  return { op: 'add_clip', trackId, clip: clipFor(a, start), explain: `Adicionando “${a.name}”` };
}

/** coloca vídeos/imagens em sequência na trilha de vídeo e áudios na de áudio */
export function sequenceOps(p: Project, assets: MediaAsset[]): EditOp[] {
  const ops: EditOp[] = [];
  const cursor: Partial<Record<TrackKind, { id: string; t: number }>> = {};
  for (const a of assets) {
    if (a.role === 'reference') continue;
    const kind = trackKindForAsset(a);
    if (!cursor[kind]) {
      const id = targetTrackId(p, kind);
      const track = p.tracks.find((t) => t.id === id);
      cursor[kind] = { id, t: track ? trackEnd(track) : 0 };
    }
    const c = cursor[kind]!;
    const op = placeAssetOp(p, a, { at: c.t, trackId: c.id });
    if (op.op === 'add_clip') c.t += op.clip.duration;
    ops.push(op);
  }
  return ops;
}

/** nome curto de projeto a partir da descrição */
export function projectNameFromBrief(brief: string, fallback = 'Projeto sem título'): string {
  let clean = brief.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) clean = clean.replace(/^(quero|faça|faz|crie|cria|preciso de|um|uma|o|a)\s+/i, '');
  if (!clean) return fallback;
  const first = clean.split(/[.!?\n]/)[0];
  const words = first.split(' ').slice(0, 6).join(' ');
  const name = words.length > 48 ? `${words.slice(0, 46)}…` : words;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
