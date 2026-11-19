/* =====================================================================
   EditorPro — operações de edição (a "linguagem" que a IA e a UI falam).
   Toda mudança no projeto passa por applyOp/applyOps (puro, imutável).
   A IA devolve EditOp[] com `explain`; o cliente aplica uma a uma,
   animando a timeline/preview ("editando ao vivo").
   ===================================================================== */

import type {
  AspectRatio, CaptionSegment, CaptionStyle, Clip, Id, Keyframe, Marker, Project, Seconds, SpeedPoint, Track, TrackKind, Transform,
} from './types';
import { ASPECT_SIZES } from './types';
import { uid } from './util';
import { curveOf, curveSpeedAt, sourceOffset, sourceSpan } from './engine/speed';
import { interpolateTransform } from './engine/easing';

type ClipPatch = Partial<Omit<Clip, 'id' | 'type'>> & Record<string, unknown>;

export type EditOp = (
  | { op: 'set_project'; patch: Partial<Pick<Project, 'name' | 'fps' | 'background' | 'brief' | 'style' | 'referenceAssetId' | 'canvas' | 'coverTime'>> }
  | { op: 'set_aspect'; aspect: AspectRatio }
  | { op: 'add_track'; track: Omit<Track, 'clips'> & { clips?: Clip[] }; index?: number }
  | { op: 'update_track'; trackId: Id; patch: Partial<Omit<Track, 'id' | 'clips' | 'kind'>> }
  | { op: 'remove_track'; trackId: Id }
  /** adiciona clipe; se trackId não existir, cria trilha do tipo certo */
  | { op: 'add_clip'; trackId: Id; clip: Clip }
  | { op: 'update_clip'; clipId: Id; patch: ClipPatch }
  | { op: 'remove_clip'; clipId: Id; ripple?: boolean }
  /** move para nova posição (e opcionalmente outra trilha) */
  | { op: 'move_clip'; clipId: Id; start: Seconds; trackId?: Id }
  /** corta o clipe em `at` (tempo de timeline); o pedaço direito ganha newId */
  | { op: 'split_clip'; clipId: Id; at: Seconds; newId?: Id }
  /** apara bordas: novo início/fim NA TIMELINE (ajusta `in` da mídia) */
  | { op: 'trim_clip'; clipId: Id; start?: Seconds; end?: Seconds }
  /** remove o intervalo [start,end) de TODAS as trilhas destravadas e puxa o resto (cortar silêncio/erro) */
  | { op: 'ripple_delete'; start: Seconds; end: Seconds }
  | { op: 'set_captions'; segments: CaptionSegment[]; language?: string }
  | { op: 'update_caption'; segmentId: Id; patch: Partial<Omit<CaptionSegment, 'id'>> }
  | { op: 'set_caption_style'; style: Partial<CaptionStyle> }
  | { op: 'toggle_captions'; enabled: boolean }
  /** duplica o clipe logo após o original (ou em `start`), na mesma trilha ou em `trackId` */
  | { op: 'duplicate_clip'; clipId: Id; newId?: Id; start?: Seconds; trackId?: Id }
  | { op: 'add_marker'; marker: Marker }
  | { op: 'update_marker'; markerId: Id; patch: Partial<Omit<Marker, 'id'>> }
  | { op: 'remove_marker'; markerId: Id }
  /** reordena trilhas (camadas): move a trilha para o índice */
  | { op: 'move_track'; trackId: Id; index: number }
  /** corta as palavras de fromWordId até toWordId (ids de CaptionWord) com ripple — cortes ancorados na fala */
  | { op: 'remove_words'; fromWordId: string; toWordId: string; padding?: Seconds }
) & {
  /** id único da operação (preenchido por normalizeOp se faltar) */
  id?: Id;
  /** frase curta em PT-BR mostrada no chat enquanto aplica ("Cortando a pausa em 0:12") */
  explain?: string;
};

export type EditOpKind = EditOp['op'];

/* ---------- consultas ---------- */

export function clipEnd(c: Clip): Seconds {
  return c.start + c.duration;
}

export function projectDuration(p: Project): Seconds {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  for (const s of p.captions.segments) end = Math.max(end, s.end);
  return end;
}

export function findClip(p: Project, clipId: Id): { track: Track; clip: Clip; index: number } | null {
  for (const track of p.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

export function trackKindFor(clip: Clip): TrackKind {
  switch (clip.type) {
    case 'audio': return 'audio';
    case 'text': return 'text';
    case 'sticker':
    case 'shape': return 'overlay';
    case 'adjustment': return 'effect';
    default: return 'video';
  }
}

export const TRACK_NAMES: Record<TrackKind, string> = {
  video: 'Vídeo', audio: 'Áudio', text: 'Texto', overlay: 'Sobreposição', effect: 'Ajuste',
};

/** clipes ativos no tempo t (de baixo p/ cima), ignorando trilhas ocultas */
export function clipsAt(p: Project, t: Seconds): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of p.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) if (t >= clip.start && t < clipEnd(clip)) out.push({ track, clip });
  }
  return out;
}

/* ---------- aplicação ---------- */

const EPS = 1e-6;

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

function mapTracks(p: Project, fn: (t: Track) => Track): Project {
  return { ...p, tracks: p.tracks.map(fn) };
}

function hasSourceIn(c: Clip): c is Extract<Clip, { in: Seconds }> {
  return c.type === 'video' || c.type === 'audio';
}

function speedOf(c: Clip): number {
  return (c.type === 'video' || c.type === 'audio') && c.speed > 0 ? c.speed : 1;
}

type SpeedyClip = Parameters<typeof sourceOffset>[0];
const KF_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;

/** curva de velocidade do trecho [u0,u1] (normalizado ao clipe) re-escalada para 0..1 */
function sliceCurve(curve: SpeedPoint[], u0: number, u1: number): SpeedPoint[] {
  const w = u1 - u0;
  const pts: SpeedPoint[] = [{ t: 0, speed: curveSpeedAt(curve, u0) }];
  for (const p of curve) if (p.t > u0 + 1e-9 && p.t < u1 - 1e-9) pts.push({ t: (p.t - u0) / w, speed: p.speed });
  pts.push({ t: 1, speed: curveSpeedAt(curve, u1) });
  return pts;
}

/** keyframes do trecho local [a,b] re-baseados em 0, com valores interpolados nas bordas (sem saltos) */
function sliceKeyframes(kfs: Keyframe[], a: Seconds, b: Seconds): Keyframe[] {
  const sorted = [...kfs].sort((x, y) => x.t - y.t);
  const animated = KF_KEYS.filter((k) => sorted.some((f) => typeof f.transform[k] === 'number'));
  const at = (t: Seconds): Partial<Transform> => {
    const tf = interpolateTransform(undefined, sorted, t);
    const o: Partial<Transform> = {};
    for (const k of animated) o[k] = tf[k];
    return o;
  };
  const inner = sorted.filter((k) => k.t > a + EPS && k.t < b - EPS).map((k) => ({ ...k, t: k.t - a }));
  const next = sorted.find((k) => k.t >= b - EPS);
  const last: Keyframe = { t: b - a, transform: at(b) };
  if (next?.easing) last.easing = next.easing;
  return [{ t: 0, transform: at(a) }, ...inner, last];
}

/**
 * Pedaço do clipe que cobre o trecho LOCAL [a,b] (segundos após c.start), mostrando exatamente
 * os mesmos quadros/valores que o original mostrava nesse trecho: `in` calculado pela integral
 * da velocidade (constante, curva ou preset) e pelo reverso; curva fatiada; keyframes fatiados.
 */
function sliceClip(c: Clip, a: Seconds, b: Seconds): Clip {
  const out = { ...c, start: c.start + a, duration: b - a } as Clip;
  if (a <= EPS && b >= c.duration - EPS) return out;
  if (hasSourceIn(c) && hasSourceIn(out)) {
    const sc = c as unknown as SpeedyClip;
    const off = (x: Seconds) => sourceOffset(sc, x);
    out.in = c.reverse ? c.in + sourceSpan(sc) - off(b) : c.in + off(a);
    const curve = curveOf(sc);
    if (curve && c.duration > EPS) {
      out.speedCurve = sliceCurve(curve, a / c.duration, b / c.duration);
      delete out.speedPreset;
    }
  }
  const kfs = (c as { keyframes?: Keyframe[] }).keyframes;
  if (kfs?.length) (out as { keyframes?: Keyframe[] }).keyframes = sliceKeyframes(kfs, a, b);
  return out;
}

/** o pedaço da esquerda de um corte não faz saída; o da direita não faz entrada (sem mergulho no preto) */
function joinEdges(left: Clip | null, right: Clip | null) {
  if (left) {
    delete (left as { fadeOut?: unknown }).fadeOut;
    delete (left as { animationOut?: unknown }).animationOut;
  }
  if (right) {
    delete (right as { fadeIn?: unknown }).fadeIn;
    delete (right as { animationIn?: unknown }).animationIn;
    delete (right as { transitionIn?: unknown }).transitionIn;
    if (right.type === 'text') right.animation = 'none';
  }
}

/** divide um clipe em dois em `at` (tempo de timeline) */
export function splitClipValue(c: Clip, at: Seconds, newId: Id): [Clip, Clip] | null {
  if (at <= c.start + EPS || at >= clipEnd(c) - EPS) return null;
  const leftDur = at - c.start;
  const left = sliceClip(c, 0, leftDur);
  const right = { ...sliceClip(c, leftDur, c.duration), id: newId } as Clip;
  joinEdges(left, right);
  return [left, right];
}

/** apara um clipe para [start,end] (tempo de timeline), ajustando `in`, curva e keyframes */
export function trimClipValue(c: Clip, start: Seconds, end: Seconds): Clip | null {
  const s = Math.max(start, c.start);
  const e = Math.min(end, clipEnd(c));
  if (e - s <= EPS) return null;
  return sliceClip(c, s - c.start, e - c.start);
}

/** id determinístico p/ o pedaço direito de um clipe cortado por ripple_delete */
export function rippleRightId(track: Track, clipId: Id, end: Seconds): Id {
  const base = `${clipId}_r${Math.round(end * 1000).toString(36)}`;
  let id = base;
  for (let n = 2; track.clips.some((x) => x.id === id); n++) id = `${base}${n}`;
  return id;
}

function rippleTrack(track: Track, start: Seconds, end: Seconds): Track {
  if (track.locked) return track;
  const gap = end - start;
  const clips: Clip[] = [];
  for (const c of track.clips) {
    const cEnd = clipEnd(c);
    if (cEnd <= start + EPS) clips.push(c); // antes do corte
    else if (c.start >= end - EPS) clips.push({ ...c, start: c.start - gap } as Clip); // depois: puxa
    else {
      // sobrepõe o corte: mantém pedaço da esquerda e/ou da direita
      const left = trimClipValue(c, c.start, start);
      const rightRaw = trimClipValue(c, end, cEnd);
      // id determinístico (mesma op no mesmo projeto => mesmo id): a IA/simulações podem
      // referenciar o pedaço direito em ops seguintes e o replay ao vivo bate com a simulação
      const right = rightRaw ? ({ ...rightRaw, id: left ? rippleRightId(track, c.id, end) : c.id, start: start } as Clip) : null;
      if (right) delete (right as { transitionIn?: unknown }).transitionIn;
      if (left && right) joinEdges(left, right);
      if (left) clips.push(left);
      if (right) clips.push(right);
    }
  }
  return { ...track, clips: sortClips(clips) };
}

function rippleCaptions(segs: CaptionSegment[], start: Seconds, end: Seconds): CaptionSegment[] {
  const gap = end - start;
  const shift = (t: Seconds) => (t >= end ? t - gap : t > start ? start : t);
  return segs
    .filter((s) => !(s.start >= start - EPS && s.end <= end + EPS)) // totalmente dentro do corte
    .map((s) => {
      const words = s.words
        ?.filter((w) => !(w.start >= start - EPS && w.end <= end + EPS))
        .map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }));
      // se o corte removeu palavras, o texto do segmento passa a ser o das palavras que sobraram
      const text = words && s.words && words.length !== s.words.length ? words.map((w) => w.text).join(' ') : s.text;
      return { ...s, start: shift(s.start), end: shift(s.end), words, text };
    })
    .filter((s) => s.end - s.start > EPS && (s.words ? s.words.length > 0 : true));
}

export class OpError extends Error {}

/** todas as palavras das legendas, em ordem */
export function allWords(p: Project): import('./types').CaptionWord[] {
  return p.captions.segments.flatMap((s) => s.words ?? []);
}

/** intervalo de tempo (timeline) coberto pelas palavras fromId..toId (inclusive) */
export function wordRange(p: Project, fromId: string, toId: string): { start: Seconds; end: Seconds } | null {
  const words = allWords(p);
  const a = words.findIndex((w) => w.id === fromId);
  const b = words.findIndex((w) => w.id === toId);
  if (a < 0 || b < 0) return null;
  const [i, j] = a <= b ? [a, b] : [b, a];
  return { start: words[i].start, end: words[j].end };
}

export function applyOp(p: Project, op: EditOp): Project {
  const next = applyOpInner(p, op);
  return next === p ? p : { ...next, updatedAt: Date.now() };
}

function applyOpInner(p: Project, op: EditOp): Project {
  switch (op.op) {
    case 'set_project':
      return { ...p, ...op.patch };

    case 'set_aspect': {
      const size = ASPECT_SIZES[op.aspect];
      if (!size) throw new OpError(`aspecto inválido: ${op.aspect}`);
      return { ...p, aspect: op.aspect, ...size };
    }

    case 'add_track': {
      if (p.tracks.some((t) => t.id === op.track.id)) return p;
      const track: Track = { ...op.track, clips: sortClips(op.track.clips ?? []) };
      const tracks = [...p.tracks];
      tracks.splice(op.index ?? tracks.length, 0, track);
      return { ...p, tracks };
    }

    case 'update_track':
      return mapTracks(p, (t) => (t.id === op.trackId ? { ...t, ...op.patch } : t));

    case 'remove_track':
      return { ...p, tracks: p.tracks.filter((t) => t.id !== op.trackId) };

    case 'add_clip': {
      const clip = op.clip;
      if (findClip(p, clip.id)) throw new OpError(`clipe já existe: ${clip.id}`);
      let tracks = p.tracks;
      if (!tracks.some((t) => t.id === op.trackId)) {
        const kind = trackKindFor(clip);
        const n = tracks.filter((t) => t.kind === kind).length + 1;
        tracks = [...tracks, { id: op.trackId, kind, name: `${TRACK_NAMES[kind]} ${n}`, clips: [] }];
      }
      return {
        ...p,
        tracks: tracks.map((t) => (t.id === op.trackId ? { ...t, clips: sortClips([...t.clips, clip]) } : t)),
      };
    }

    case 'update_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      const { id: _i, type: _t, ...patch } = op.patch as Record<string, unknown>;
      const updated = { ...found.clip, ...patch } as Clip;
      return mapTracks(p, (t) =>
        t.id === found.track.id ? { ...t, clips: sortClips(t.clips.map((c) => (c.id === op.clipId ? updated : c))) } : t,
      );
    }

    case 'remove_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      if (op.ripple) {
        const { start, duration } = found.clip;
        const gap = duration;
        return mapTracks(p, (t) =>
          t.id !== found.track.id
            ? t
            : {
                ...t,
                clips: t.clips
                  .filter((c) => c.id !== op.clipId)
                  .map((c) => (c.start >= start ? ({ ...c, start: c.start - gap } as Clip) : c)),
              },
        );
      }
      return mapTracks(p, (t) => (t.id === found.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== op.clipId) } : t));
    }

    case 'move_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      const moved = { ...found.clip, start: Math.max(0, op.start) } as Clip;
      const dest = op.trackId ?? found.track.id;
      if (!p.tracks.some((t) => t.id === dest)) throw new OpError(`trilha não encontrada: ${dest}`);
      return mapTracks(p, (t) => {
        let clips = t.clips.filter((c) => c.id !== op.clipId);
        if (t.id === dest) clips = sortClips([...clips, moved]);
        return { ...t, clips };
      });
    }

    case 'split_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      const parts = splitClipValue(found.clip, op.at, op.newId ?? uid('clip'));
      if (!parts) return p;
      return mapTracks(p, (t) =>
        t.id === found.track.id ? { ...t, clips: sortClips(t.clips.flatMap((c) => (c.id === op.clipId ? parts : [c]))) } : t,
      );
    }

    case 'trim_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      const c = found.clip;
      const start = op.start ?? c.start;
      const end = op.end ?? clipEnd(c);
      // permite "esticar" para trás/frente só até o limite da mídia (validação fina fica na UI)
      let out: Clip | null;
      if (start < c.start || end > clipEnd(c)) {
        out = { ...c, start, duration: end - start } as Clip;
        if (hasSourceIn(c) && hasSourceIn(out)) out.in = Math.max(0, c.in + (start - c.start) * speedOf(c));
        // esticou para trás: keyframes acompanham o conteúdo
        const kfs = (c as { keyframes?: Keyframe[] }).keyframes;
        if (kfs?.length && start < c.start) (out as { keyframes?: Keyframe[] }).keyframes = kfs.map((k) => ({ ...k, t: k.t + (c.start - start) }));
      } else out = trimClipValue(c, start, end);
      if (!out || out.duration <= EPS) throw new OpError('corte resultaria em clipe vazio');
      const trimmed = out;
      return mapTracks(p, (t) =>
        t.id === found.track.id ? { ...t, clips: sortClips(t.clips.map((x) => (x.id === op.clipId ? trimmed : x))) } : t,
      );
    }

    case 'ripple_delete': {
      if (op.end - op.start <= EPS) return p;
      const gap = op.end - op.start;
      return {
        ...mapTracks(p, (t) => rippleTrack(t, op.start, op.end)),
        captions: { ...p.captions, segments: rippleCaptions(p.captions.segments, op.start, op.end) },
        markers: p.markers?.flatMap((m) => {
          const shift = (t: Seconds) => (t >= op.end ? t - gap : t > op.start ? op.start : t);
          if (m.end === undefined) return m.t >= op.start && m.t < op.end ? [] : [{ ...m, t: shift(m.t) }];
          // trecho: só some se estiver todo dentro do corte; senão encolhe junto
          if (m.t >= op.start - EPS && m.end <= op.end + EPS) return [];
          return [{ ...m, t: shift(m.t), end: shift(m.end) }];
        }),
      };
    }

    case 'set_captions':
      return {
        ...p,
        captions: {
          ...p.captions,
          enabled: true,
          language: op.language ?? p.captions.language,
          segments: [...op.segments].sort((a, b) => a.start - b.start),
        },
      };

    case 'update_caption':
      return {
        ...p,
        captions: {
          ...p.captions,
          segments: p.captions.segments.map((s) => (s.id === op.segmentId ? { ...s, ...op.patch } : s)),
        },
      };

    case 'set_caption_style':
      return { ...p, captions: { ...p.captions, style: { ...p.captions.style, ...op.style } } };

    case 'toggle_captions':
      return { ...p, captions: { ...p.captions, enabled: op.enabled } };

    case 'duplicate_clip': {
      const found = findClip(p, op.clipId);
      if (!found) throw new OpError(`clipe não encontrado: ${op.clipId}`);
      const copy = { ...found.clip, id: op.newId ?? uid('clip'), start: op.start ?? clipEnd(found.clip) } as Clip;
      const dest = op.trackId ?? found.track.id;
      if (!p.tracks.some((t) => t.id === dest)) throw new OpError(`trilha não encontrada: ${dest}`);
      return mapTracks(p, (t) => (t.id === dest ? { ...t, clips: sortClips([...t.clips, copy]) } : t));
    }

    case 'add_marker':
      return { ...p, markers: [...(p.markers ?? []).filter((m) => m.id !== op.marker.id), op.marker].sort((a, b) => a.t - b.t) };

    case 'update_marker':
      return { ...p, markers: (p.markers ?? []).map((m) => (m.id === op.markerId ? { ...m, ...op.patch } : m)).sort((a, b) => a.t - b.t) };

    case 'remove_marker':
      return { ...p, markers: (p.markers ?? []).filter((m) => m.id !== op.markerId) };

    case 'remove_words': {
      const r = wordRange(p, op.fromWordId, op.toWordId);
      if (!r) throw new OpError(`palavras não encontradas: ${op.fromWordId}..${op.toWordId}`);
      const pad = op.padding ?? 0.02;
      return applyOpInner(p, { op: 'ripple_delete', start: Math.max(0, r.start - pad), end: r.end + pad });
    }

    case 'move_track': {
      const i = p.tracks.findIndex((t) => t.id === op.trackId);
      if (i < 0) throw new OpError(`trilha não encontrada: ${op.trackId}`);
      const tracks = [...p.tracks];
      const [t] = tracks.splice(i, 1);
      tracks.splice(Math.max(0, Math.min(op.index, tracks.length)), 0, t);
      return { ...p, tracks };
    }

    default: {
      const never: never = op;
      throw new OpError(`operação desconhecida: ${(never as { op: string }).op}`);
    }
  }
}

/** aplica em sequência; operações inválidas são puladas e reportadas */
export function applyOps(p: Project, ops: EditOp[]): { project: Project; errors: { op: EditOp; error: string }[] } {
  const errors: { op: EditOp; error: string }[] = [];
  let project = p;
  for (const op of ops) {
    try {
      project = applyOp(project, op);
    } catch (e) {
      errors.push({ op, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { project, errors };
}

export function normalizeOp(op: EditOp): EditOp {
  return op.id ? op : { ...op, id: uid('op') };
}

/** tempo/alvo de interesse de uma operação (p/ a UI mover o playhead e destacar ao vivo) */
export function opFocus(p: Project, op: EditOp): { time?: Seconds; clipId?: Id } {
  switch (op.op) {
    case 'add_clip': return { time: op.clip.start, clipId: op.clip.id };
    case 'update_clip':
    case 'remove_clip':
    case 'trim_clip': { const f = findClip(p, op.clipId); return { time: f?.clip.start, clipId: op.clipId }; }
    case 'move_clip': return { time: op.start, clipId: op.clipId };
    case 'split_clip': return { time: op.at, clipId: op.clipId };
    case 'ripple_delete': return { time: op.start };
    case 'update_caption': { const s = p.captions.segments.find((x) => x.id === op.segmentId); return { time: s?.start }; }
    case 'duplicate_clip': { const f = findClip(p, op.clipId); return { time: op.start ?? (f ? clipEnd(f.clip) : undefined), clipId: op.newId }; }
    case 'add_marker': return { time: op.marker.t };
    case 'remove_words': { const r = wordRange(p, op.fromWordId, op.toWordId); return { time: r?.start }; }
    default: return {};
  }
}
