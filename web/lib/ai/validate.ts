/* =====================================================================
   Validação/sanitização das EditOp vindas da IA.
   - descarta ops desconhecidas/inválidas (com motivo)
   - prende tempos aos limites (mídia, clipe, projeto)
   - gera ids faltantes (op, clipe, trilha, legenda)
   - mescla patches parciais de objetos (style/transform/position) com o valor atual
   - simula a aplicação em sequência (ops posteriores podem usar clipes criados antes)
   Puro: roda no servidor (rota /api/ai/edit) e no cliente (modo demo).
   ===================================================================== */
import type { CaptionSegment, Clip, Id, MediaAsset, Project, TextClip, Track, TrackKind } from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { applyOp, clipEnd, findClip, projectDuration, trackKindFor, type EditOp, type EditOpKind } from '../ops';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { uid } from '../util';
import {
  ASPECTS, COLOR_PRESETS, TEXT_ANIMATIONS, bool, clampNum, isObj, num, oneOf, r3, sanitizeCaptionStyle, sanitizeFilters,
  sanitizeKeyframes, sanitizePosition, sanitizeStyleProfile, sanitizeTextStyle, sanitizeTransform, sanitizeTransition,
  sanitizeTranscript, str,
} from './sanitize';

export const OP_KINDS: EditOpKind[] = [
  'set_project', 'set_aspect', 'add_track', 'update_track', 'remove_track', 'add_clip', 'update_clip', 'remove_clip',
  'move_clip', 'split_clip', 'trim_clip', 'ripple_delete', 'set_captions', 'update_caption', 'set_caption_style', 'toggle_captions',
];

export const MAX_OPS = 80;
const EPS = 1e-3;

export interface Dropped { op: unknown; reason: string }
export interface SanitizeResult { ops: EditOp[]; dropped: Dropped[]; project: Project }

const DEFAULT_EXPLAIN: Record<EditOpKind, string> = {
  set_project: 'Ajustando o projeto',
  set_aspect: 'Mudando o formato do vídeo',
  add_track: 'Criando uma trilha nova',
  update_track: 'Ajustando a trilha',
  remove_track: 'Removendo uma trilha',
  add_clip: 'Adicionando um clipe',
  update_clip: 'Ajustando o clipe',
  remove_clip: 'Removendo um clipe',
  move_clip: 'Reposicionando o clipe',
  split_clip: 'Dividindo o clipe',
  trim_clip: 'Aparando o clipe',
  ripple_delete: 'Cortando um trecho',
  set_captions: 'Colocando as legendas',
  update_caption: 'Corrigindo uma legenda',
  set_caption_style: 'Mudando o estilo das legendas',
  toggle_captions: 'Ligando/desligando as legendas',
};

class Drop extends Error {}
const fail = (reason: string): never => { throw new Drop(reason); };

function mediaLimitOk(asset: MediaAsset | undefined): asset is MediaAsset {
  return !!asset && asset.duration > 0;
}

function pickTrack(p: Project, kind: TrackKind, wanted?: unknown): Id {
  const id = str(wanted, 80);
  if (id) {
    const t = p.tracks.find((x) => x.id === id);
    if (t && t.kind === kind) return id;
    if (!t) return id; // add_clip cria a trilha
  }
  const existing = p.tracks.find((t) => t.kind === kind && !t.locked);
  return existing?.id ?? `track_${kind}_${uid('t').slice(-6)}`;
}

/** monta um clipe completo e válido a partir de dados parciais da IA */
function buildClip(raw: Record<string, unknown>, p: Project, assets: Record<Id, MediaAsset>): Clip {
  const type = oneOf(raw.type, ['video', 'image', 'audio', 'text'] as const) ?? fail('clip.type inválido');
  let id = str(raw.id, 80);
  if (!id || findClip(p, id)) id = uid('clip');
  const start = r3(clampNum(raw.start, 0, 24 * 3600) ?? 0);
  const label = str(raw.label, 60);

  if (type === 'text') {
    const text = str(raw.text, 300) ?? fail('texto vazio');
    const duration = r3(clampNum(raw.duration, 0.2, 600) ?? 2.5);
    const clip: TextClip = {
      id, type, start, duration, text,
      style: { ...DEFAULT_TEXT_STYLE, ...(sanitizeTextStyle(raw.style) ?? {}) },
      position: sanitizePosition(raw.position) ?? { x: 0.5, y: 0.3 },
      animation: oneOf(raw.animation, TEXT_ANIMATIONS) ?? 'pop',
      ...(label ? { label } : {}),
    };
    return clip;
  }

  const assetId = str(raw.assetId, 80) ?? fail('clip sem assetId');
  const asset = assets[assetId] ?? fail(`mídia não existe: ${assetId}`);
  if (type === 'image' && asset.kind !== 'image') fail('assetId não é imagem');
  if (type === 'video' && asset.kind !== 'video') fail('assetId não é vídeo');
  if (type === 'audio' && asset.kind === 'image') fail('assetId não tem áudio');

  if (type === 'image') {
    const duration = r3(clampNum(raw.duration, 0.2, 600) ?? 3);
    const kf = sanitizeKeyframes(raw.keyframes, duration);
    const tr = sanitizeTransition(raw.transitionIn, duration);
    return {
      id, type, assetId, start, duration,
      transform: { ...DEFAULT_TRANSFORM, ...(sanitizeTransform(raw.transform) ?? {}) },
      filters: sanitizeFilters(raw.filters) ?? [],
      ...(kf?.length ? { keyframes: kf } : {}),
      ...(tr ? { transitionIn: tr } : {}),
      ...(label ? { label } : {}),
    };
  }

  const speed = clampNum(raw.speed, 0.1, 8) ?? 1;
  const inPt = r3(clampNum(raw.in, 0, Math.max(0, asset.duration - 0.05)) ?? 0);
  const maxDur = mediaLimitOk(asset) ? (asset.duration - inPt) / speed : 600;
  const duration = r3(Math.min(clampNum(raw.duration, 0.05, 24 * 3600) ?? maxDur, maxDur));
  if (duration <= 0.04) fail('clipe sem duração');
  const volume = clampNum(raw.volume, 0, 2) ?? 1;
  const fadeIn = clampNum(raw.fadeIn, 0, duration / 2);
  const fadeOut = clampNum(raw.fadeOut, 0, duration / 2);

  if (type === 'audio') {
    const duck = bool(raw.duckUnderVoice);
    return {
      id, type, assetId, start, duration, in: inPt, speed, volume,
      ...(fadeIn ? { fadeIn } : {}), ...(fadeOut ? { fadeOut } : {}),
      ...(duck !== undefined ? { duckUnderVoice: duck } : {}),
      ...(label ? { label } : {}),
    };
  }

  const kf = sanitizeKeyframes(raw.keyframes, duration);
  const tr = sanitizeTransition(raw.transitionIn, duration);
  const cp = oneOf(raw.colorPreset, COLOR_PRESETS);
  const muted = bool(raw.muted);
  return {
    id, type, assetId, start, duration, in: inPt, speed, volume,
    transform: { ...DEFAULT_TRANSFORM, ...(sanitizeTransform(raw.transform) ?? {}) },
    filters: sanitizeFilters(raw.filters) ?? [],
    ...(kf?.length ? { keyframes: kf } : {}),
    ...(tr ? { transitionIn: tr } : {}),
    ...(cp ? { colorPreset: cp } : {}),
    ...(muted !== undefined ? { muted } : {}),
    ...(fadeIn ? { fadeIn } : {}), ...(fadeOut ? { fadeOut } : {}),
    ...(label ? { label } : {}),
  };
}

/** patch de update_clip: só campos válidos para o tipo; objetos parciais mesclados com o atual */
function buildClipPatch(raw: Record<string, unknown>, clip: Clip, assets: Record<Id, MediaAsset>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const asset = 'assetId' in clip ? assets[clip.assetId] : undefined;
  const label = str(raw.label, 60); if (label) out.label = label;
  const locked = bool(raw.locked); if (locked !== undefined) out.locked = locked;
  const start = clampNum(raw.start, 0, 24 * 3600); if (start !== undefined) out.start = r3(start);

  let duration = clampNum(raw.duration, 0.05, 24 * 3600);
  if (clip.type === 'video' || clip.type === 'audio') {
    const speed = clampNum(raw.speed, 0.1, 8);
    const inPt = clampNum(raw.in, 0, mediaLimitOk(asset) ? Math.max(0, asset.duration - 0.05) : 24 * 3600);
    if (speed !== undefined) {
      out.speed = speed;
      // mesma porção da mídia: duração na timeline escala com a velocidade
      if (duration === undefined) duration = (clip.duration * clip.speed) / speed;
    }
    if (inPt !== undefined) out.in = r3(inPt);
    const sp = (out.speed as number | undefined) ?? clip.speed;
    const ip = (out.in as number | undefined) ?? clip.in;
    if (duration !== undefined && mediaLimitOk(asset)) duration = Math.min(duration, (asset.duration - ip) / sp);
    const volume = clampNum(raw.volume, 0, 2); if (volume !== undefined) out.volume = volume;
    const d = duration ?? clip.duration;
    const fadeIn = clampNum(raw.fadeIn, 0, d / 2); if (fadeIn !== undefined) out.fadeIn = fadeIn;
    const fadeOut = clampNum(raw.fadeOut, 0, d / 2); if (fadeOut !== undefined) out.fadeOut = fadeOut;
    if (clip.type === 'audio') { const duck = bool(raw.duckUnderVoice); if (duck !== undefined) out.duckUnderVoice = duck; }
    if (clip.type === 'video') { const muted = bool(raw.muted); if (muted !== undefined) out.muted = muted; }
  }
  if (duration !== undefined) out.duration = r3(Math.max(0.05, duration));
  const d = (out.duration as number | undefined) ?? clip.duration;

  if (clip.type === 'video' || clip.type === 'image') {
    const tf = sanitizeTransform(raw.transform, clip.transform); if (tf) out.transform = tf;
    const kf = sanitizeKeyframes(raw.keyframes, d); if (kf) out.keyframes = kf;
    const fl = sanitizeFilters(raw.filters); if (fl) out.filters = fl;
    if (raw.transitionIn === null || ('transitionIn' in raw && raw.transitionIn === undefined)) out.transitionIn = undefined;
    else { const tr = sanitizeTransition(raw.transitionIn, d); if (tr) out.transitionIn = tr; }
  }
  if (clip.type === 'video') {
    const cp = oneOf(raw.colorPreset, COLOR_PRESETS); if (cp) out.colorPreset = cp;
  }
  if (clip.type === 'text') {
    const text = str(raw.text, 300); if (text) out.text = text;
    const st = sanitizeTextStyle(raw.style); if (st) out.style = { ...clip.style, ...st };
    const pos = sanitizePosition(raw.position, clip.position); if (pos) out.position = pos;
    const an = oneOf(raw.animation, TEXT_ANIMATIONS); if (an) out.animation = an;
  }
  if (!Object.keys(out).length) fail('patch vazio');
  return out;
}

function sanitizeSegments(raw: unknown, p: Project): CaptionSegment[] {
  const end = Math.max(projectDuration(p), 0.1);
  return sanitizeTranscript({ segments: raw }, { duration: end });
}

/** sanitiza UMA op contra o projeto atual (lança Drop se inválida) */
export function sanitizeOp(raw: unknown, p: Project, assets: Record<Id, MediaAsset>): EditOp {
  if (!isObj(raw)) fail('não é objeto');
  const r = raw as Record<string, unknown>;
  const kind = oneOf(r.op, OP_KINDS) ?? fail(`op desconhecida: ${String(r.op)}`);
  const explain = str(r.explain, 140) ?? DEFAULT_EXPLAIN[kind];
  const id = str(r.id, 80) ?? uid('op');
  const meta = { id, explain };
  const dur = projectDuration(p);
  const clipOf = (key = 'clipId') => {
    const cid = str(r[key], 80) ?? fail(`${key} ausente`);
    return findClip(p, cid) ?? fail(`clipe não existe: ${cid}`);
  };

  switch (kind) {
    case 'set_project': {
      const patch = isObj(r.patch) ? r.patch : fail('patch ausente');
      const out: Record<string, unknown> = {};
      const name = str(patch.name, 100); if (name) out.name = name;
      const fps = clampNum(patch.fps, 12, 60); if (fps !== undefined) out.fps = Math.round(fps);
      const bg = str(patch.background, 40); if (bg && /^#[0-9a-f]{3,8}$/i.test(bg)) out.background = bg;
      const brief = str(patch.brief, 4000); if (brief) out.brief = brief;
      const style = sanitizeStyleProfile(patch.style); if (style) out.style = style;
      const ref = str(patch.referenceAssetId, 80); if (ref && assets[ref]) out.referenceAssetId = ref;
      if (!Object.keys(out).length) fail('patch vazio');
      return { op: 'set_project', patch: out, ...meta };
    }
    case 'set_aspect': {
      const aspect = oneOf(r.aspect, ASPECTS) ?? fail('aspecto inválido');
      return { op: 'set_aspect', aspect, ...meta };
    }
    case 'add_track': {
      const t = isObj(r.track) ? r.track : r;
      const tk = oneOf(t.kind, ['video', 'audio', 'text'] as const) ?? fail('kind da trilha inválido');
      let tid = str(t.id, 80);
      if (!tid || p.tracks.some((x) => x.id === tid)) tid = uid('track');
      const names: Record<TrackKind, string> = { video: 'Vídeo', audio: 'Áudio', text: 'Texto' };
      const name = str(t.name, 40) ?? `${names[tk]} ${p.tracks.filter((x) => x.kind === tk).length + 1}`;
      const index = clampNum(r.index, 0, p.tracks.length);
      return { op: 'add_track', track: { id: tid, kind: tk, name }, ...(index !== undefined ? { index: Math.round(index) } : {}), ...meta };
    }
    case 'update_track': {
      const tid = str(r.trackId, 80) ?? fail('trackId ausente');
      if (!p.tracks.some((t) => t.id === tid)) fail(`trilha não existe: ${tid}`);
      const patch = isObj(r.patch) ? r.patch : fail('patch ausente');
      const out: Partial<Omit<Track, 'id' | 'clips' | 'kind'>> = {};
      const name = str(patch.name, 40); if (name) out.name = name;
      for (const k of ['muted', 'hidden', 'locked'] as const) { const b = bool(patch[k]); if (b !== undefined) out[k] = b; }
      if (!Object.keys(out).length) fail('patch vazio');
      return { op: 'update_track', trackId: tid, patch: out, ...meta };
    }
    case 'remove_track': {
      const tid = str(r.trackId, 80) ?? fail('trackId ausente');
      const t = p.tracks.find((x) => x.id === tid) ?? fail(`trilha não existe: ${tid}`);
      if (t.kind === 'video' && p.tracks.filter((x) => x.kind === 'video').length <= 1) fail('não remove a única trilha de vídeo');
      return { op: 'remove_track', trackId: tid, ...meta };
    }
    case 'add_clip': {
      const clip = buildClip(isObj(r.clip) ? r.clip : fail('clip ausente'), p, assets);
      const trackId = pickTrack(p, trackKindFor(clip), r.trackId);
      return { op: 'add_clip', trackId, clip, ...meta };
    }
    case 'update_clip': {
      const { clip } = clipOf();
      if (clip.locked) fail('clipe travado');
      const patch = buildClipPatch(isObj(r.patch) ? r.patch : fail('patch ausente'), clip, assets);
      return { op: 'update_clip', clipId: clip.id, patch, ...meta };
    }
    case 'remove_clip': {
      const { clip } = clipOf();
      return { op: 'remove_clip', clipId: clip.id, ...(bool(r.ripple) ? { ripple: true } : {}), ...meta };
    }
    case 'move_clip': {
      const { clip, track } = clipOf();
      const start = r3(clampNum(r.start, 0, 24 * 3600) ?? fail('start inválido'));
      const tid = str(r.trackId, 80);
      const dest = tid ? p.tracks.find((t) => t.id === tid) : undefined;
      const trackOk = dest && dest.kind === track.kind && !dest.locked;
      return { op: 'move_clip', clipId: clip.id, start, ...(trackOk ? { trackId: dest!.id } : {}), ...meta };
    }
    case 'split_clip': {
      const { clip } = clipOf();
      const at = num(r.at) ?? fail('at inválido');
      if (at <= clip.start + 0.05 || at >= clipEnd(clip) - 0.05) fail('ponto de corte fora do clipe');
      let newId = str(r.newId, 80);
      if (!newId || findClip(p, newId)) newId = uid('clip');
      return { op: 'split_clip', clipId: clip.id, at: r3(at), newId, ...meta };
    }
    case 'trim_clip': {
      const { clip } = clipOf();
      let start = num(r.start) ?? clip.start;
      let end = num(r.end) ?? clipEnd(clip);
      if (clip.type === 'video' || clip.type === 'audio') {
        const asset = assets[clip.assetId];
        const minStart = clip.start - clip.in / clip.speed; // não volta antes do início da mídia
        start = Math.max(start, minStart, 0);
        if (mediaLimitOk(asset)) {
          const mediaEndAt = clip.start + (asset.duration - clip.in) / clip.speed;
          end = Math.min(end, mediaEndAt);
        }
      }
      start = Math.max(0, start);
      if (end - start < 0.05) fail('corte resultaria em clipe vazio');
      return { op: 'trim_clip', clipId: clip.id, start: r3(start), end: r3(end), ...meta };
    }
    case 'ripple_delete': {
      const start = Math.max(0, num(r.start) ?? fail('start inválido'));
      const end = Math.min(dur, num(r.end) ?? fail('end inválido'));
      if (end - start < 0.05) fail('intervalo vazio/fora do vídeo');
      if (dur > 0 && end - start >= dur - 0.25) fail('cortaria o vídeo inteiro');
      return { op: 'ripple_delete', start: r3(start), end: r3(end), ...meta };
    }
    case 'set_captions': {
      const segments = sanitizeSegments(r.segments, p);
      if (!segments.length) fail('nenhuma legenda válida');
      const language = str(r.language, 12);
      return { op: 'set_captions', segments, ...(language ? { language } : {}), ...meta };
    }
    case 'update_caption': {
      const sid = str(r.segmentId, 80) ?? fail('segmentId ausente');
      const seg = p.captions.segments.find((s) => s.id === sid) ?? fail(`legenda não existe: ${sid}`);
      const patch = isObj(r.patch) ? r.patch : fail('patch ausente');
      const out: Partial<Omit<CaptionSegment, 'id'>> = {};
      const text = str(patch.text, 400);
      let s = clampNum(patch.start, 0, dur) ?? seg.start;
      let e = clampNum(patch.end, 0, dur) ?? seg.end;
      if (e - s < 0.05) { s = seg.start; e = seg.end; }
      if (s !== seg.start) out.start = r3(s);
      if (e !== seg.end) out.end = r3(e);
      if (text) {
        out.text = text;
        // palavras antigas não batem mais com o texto novo: redistribui
        const words = text.split(/\s+/).filter(Boolean);
        const t0 = out.start ?? seg.start; const t1 = out.end ?? seg.end;
        out.words = words.map((w, i) => ({ text: w, start: r3(t0 + ((t1 - t0) * i) / words.length), end: r3(t0 + ((t1 - t0) * (i + 1)) / words.length) }));
      }
      if (Array.isArray(patch.emphasis)) out.emphasis = patch.emphasis.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 6);
      if (!Object.keys(out).length) fail('patch vazio');
      return { op: 'update_caption', segmentId: sid, patch: out, ...meta };
    }
    case 'set_caption_style': {
      const style = sanitizeCaptionStyle(r.style, p.captions.style) ?? fail('estilo vazio');
      return { op: 'set_caption_style', style, ...meta };
    }
    case 'toggle_captions': {
      const enabled = bool(r.enabled) ?? fail('enabled inválido');
      return { op: 'toggle_captions', enabled, ...meta };
    }
  }
  return fail('op não tratada');
}

/** sanitiza a lista inteira simulando a aplicação em sequência */
export function sanitizeOps(raw: unknown, project: Project, assets: Record<Id, MediaAsset>): SanitizeResult {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.ops) ? raw.ops : [];
  const ops: EditOp[] = [];
  const dropped: Dropped[] = [];
  let p = project;
  for (const item of list.slice(0, MAX_OPS)) {
    try {
      const op = sanitizeOp(item, p, assets);
      const next = applyOp(p, op);
      ops.push(op);
      p = next;
    } catch (e) {
      dropped.push({ op: item, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (list.length > MAX_OPS) dropped.push({ op: null, reason: `limite de ${MAX_OPS} operações` });
  return { ops, dropped, project: p };
}

export { EPS as VALIDATE_EPS };
