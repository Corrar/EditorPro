/* =====================================================================
   Validação/sanitização das EditOp vindas da IA.
   - descarta ops desconhecidas/inválidas (com motivo)
   - prende tempos aos limites (mídia, clipe, projeto)
   - gera ids faltantes (op, clipe, trilha, legenda, marcador)
   - mescla patches parciais de objetos (style/transform/position) com o valor atual
   - simula a aplicação em sequência (ops posteriores podem usar clipes criados antes)
   Puro: roda no servidor (rota /api/ai/edit) e no cliente (modo demo).
   ===================================================================== */
import type { CaptionSegment, Clip, Filter, Id, Marker, MediaAsset, Project, TextClip, Track, TrackKind } from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { TRACK_NAMES, allWords, applyOp, clipEnd, findClip, projectDuration, trackKindFor, type EditOp, type EditOpKind } from '../ops';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { uid } from '../util';
import {
  ASPECTS, COLOR_PRESETS, sanitizeColorGrade, MARKER_KINDS, SHAPE_KINDS, TEXT_ANIMATIONS, bool, clampNum, color, isObj, num, oneOf, r3,
  sanitizeAudioExtras, sanitizeCaptionStyle, sanitizeEffects, sanitizeFilters, sanitizeKeyframes, sanitizePosition,
  sanitizeStyleProfile, sanitizeTextStyle, sanitizeTransform, sanitizeTransition, sanitizeTranscript, sanitizeVisualExtras, str,
} from './sanitize';
import { assignWordIds } from './features';
import { COLOR_GRADE_LIVE, gradeToFilters } from './colormatch';
import { expandLibraryOp, isLibraryMacro, type SfxRequest } from './library';

export const OP_KINDS: EditOpKind[] = [
  'set_project', 'set_aspect', 'add_track', 'update_track', 'remove_track', 'move_track', 'add_clip', 'update_clip',
  'remove_clip', 'duplicate_clip', 'move_clip', 'split_clip', 'trim_clip', 'ripple_delete', 'remove_words', 'set_captions',
  'update_caption', 'set_caption_style', 'toggle_captions', 'add_marker', 'update_marker', 'remove_marker',
];

export const CLIP_TYPES = ['video', 'image', 'audio', 'text', 'sticker', 'shape', 'adjustment'] as const;
export const TRACK_KINDS: TrackKind[] = ['video', 'audio', 'text', 'overlay', 'effect'];

export const MAX_OPS = 80;
const EPS = 1e-3;

export interface Dropped { op: unknown; reason: string }
export interface SanitizeResult { ops: EditOp[]; dropped: Dropped[]; project: Project; sfx: SfxRequest[] }

const DEFAULT_EXPLAIN: Record<EditOpKind, string> = {
  set_project: 'Ajustando o projeto',
  set_aspect: 'Mudando o formato do vídeo',
  add_track: 'Criando uma trilha nova',
  update_track: 'Ajustando a trilha',
  remove_track: 'Removendo uma trilha',
  move_track: 'Reordenando as camadas',
  add_clip: 'Adicionando um clipe',
  update_clip: 'Ajustando o clipe',
  remove_clip: 'Removendo um clipe',
  duplicate_clip: 'Duplicando o clipe',
  move_clip: 'Reposicionando o clipe',
  split_clip: 'Dividindo o clipe',
  trim_clip: 'Aparando o clipe',
  ripple_delete: 'Cortando um trecho',
  remove_words: 'Cortando um trecho da fala',
  set_captions: 'Colocando as legendas',
  update_caption: 'Corrigindo uma legenda',
  set_caption_style: 'Mudando o estilo das legendas',
  toggle_captions: 'Ligando/desligando as legendas',
  add_marker: 'Marcando um ponto',
  update_marker: 'Atualizando o marcador',
  remove_marker: 'Removendo o marcador',
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
    if (t && t.kind === kind && !t.locked) return id;
    if (!t) return id; // add_clip cria a trilha
  }
  const existing = p.tracks.find((t) => t.kind === kind && !t.locked);
  return existing?.id ?? `track_${kind}_${uid('t').slice(-6)}`;
}

/** animação de texto: aceita a string (TextAnimation) ou o objeto {kind} das animações de clipe */
function textAnim(v: unknown) {
  const direct = oneOf(v, TEXT_ANIMATIONS);
  if (direct) return direct;
  const kind = isObj(v) ? String(v.kind ?? '') : '';
  const map: Record<string, (typeof TEXT_ANIMATIONS)[number]> = { 'zoom-in': 'zoom', 'zoom-out': 'zoom', flip: 'spin', swing: 'wave', shake: 'glitch' };
  return oneOf(kind, TEXT_ANIMATIONS) ?? map[kind];
}

/** emoji: no máximo alguns caracteres gráficos */
function emojiOf(v: unknown): string | undefined {
  const s = str(v, 16);
  if (!s) return undefined;
  return /\p{Extended_Pictographic}/u.test(s) ? s : undefined;
}

/** monta um clipe completo e válido a partir de dados parciais da IA */
/** sem o motor de cor ligado, um colorGrade pedido vira filtros equivalentes */
function withGrade(filters: Filter[], rawGrade: unknown): Filter[] {
  if (COLOR_GRADE_LIVE) return filters;
  const cg = sanitizeColorGrade(rawGrade);
  if (!cg) return filters;
  const eq = gradeToFilters(cg);
  return [...filters.filter((f) => !eq.some((e) => e.kind === f.kind)), ...eq];
}

function buildClip(raw: Record<string, unknown>, p: Project, assets: Record<Id, MediaAsset>): Clip {
  const type = oneOf(raw.type, CLIP_TYPES) ?? fail('clip.type inválido');
  let id = str(raw.id, 80);
  if (!id || findClip(p, id)) id = uid('clip');
  const start = r3(clampNum(raw.start, 0, 24 * 3600) ?? 0);
  const label = str(raw.label, 60);
  const lbl = label ? { label } : {};

  if (type === 'text') {
    const text = str(raw.text, 300) ?? fail('texto vazio');
    const duration = r3(clampNum(raw.duration, 0.2, 600) ?? 2.5);
    const kf = sanitizeKeyframes(raw.keyframes, duration);
    const out = textAnim(raw.animationOut);
    const loop = textAnim(raw.animationLoop);
    const rot = clampNum(raw.rotation, -360, 360);
    const sc = clampNum(raw.scale, 0.1, 5);
    const tpl = str(raw.templateId, 60);
    const clip: TextClip = {
      id, type, start, duration, text,
      style: { ...DEFAULT_TEXT_STYLE, ...(sanitizeTextStyle(raw.style) ?? {}) },
      position: sanitizePosition(raw.position) ?? { x: 0.5, y: 0.3 },
      animation: textAnim(raw.animation) ?? textAnim(raw.animationIn) ?? 'pop',
      ...(out ? { animationOut: out } : {}), ...(loop ? { animationLoop: loop } : {}),
      ...(rot !== undefined ? { rotation: rot } : {}), ...(sc !== undefined ? { scale: sc } : {}),
      ...(kf?.length ? { keyframes: kf } : {}), ...(tpl ? { templateId: tpl } : {}),
      ...lbl,
    };
    return clip;
  }

  if (type === 'adjustment') {
    const duration = r3(clampNum(raw.duration, 0.1, 24 * 3600) ?? 3);
    const cp = oneOf(raw.colorPreset, COLOR_PRESETS);
    const fx = sanitizeEffects(raw.effects);
    const filters = withGrade(sanitizeFilters(raw.filters) ?? [], raw.colorGrade);
    const cg = COLOR_GRADE_LIVE ? sanitizeColorGrade(raw.colorGrade) ?? undefined : undefined;
    if (!cp && !fx?.length && !filters.length && !cg) fail('camada de ajuste vazia');
    return { id, type, start, duration, filters, ...(cp ? { colorPreset: cp } : {}), ...(cg ? { colorGrade: cg } : {}), ...(fx?.length ? { effects: fx } : {}), ...lbl };
  }

  if (type === 'shape') {
    const duration = r3(clampNum(raw.duration, 0.1, 600) ?? 3);
    const kf = sanitizeKeyframes(raw.keyframes, duration);
    const stroke = color(raw.stroke);
    const sw = clampNum(raw.strokeWidth, 0, 60);
    const cr = clampNum(raw.cornerRadius, 0, 200);
    return {
      id, type, start, duration,
      shape: oneOf(raw.shape, SHAPE_KINDS) ?? 'rounded-rect',
      fill: color(raw.fill) || '#D9641E',
      ...(stroke ? { stroke } : {}), ...(sw !== undefined ? { strokeWidth: sw } : {}), ...(cr !== undefined ? { cornerRadius: cr } : {}),
      transform: { ...DEFAULT_TRANSFORM, scale: 0.3, ...(sanitizeTransform(raw.transform) ?? {}) },
      ...(kf?.length ? { keyframes: kf } : {}),
      ...sanitizeVisualExtras(raw, duration),
      ...lbl,
    };
  }

  if (type === 'sticker') {
    const duration = r3(clampNum(raw.duration, 0.1, 600) ?? 3);
    const emoji = emojiOf(raw.emoji);
    const assetId = str(raw.assetId, 80);
    const asset = assetId ? assets[assetId] : undefined;
    if (assetId && (!asset || asset.kind !== 'image')) fail(`sticker: imagem não existe: ${assetId}`);
    if (!emoji && !asset) fail('sticker sem emoji nem imagem');
    const kf = sanitizeKeyframes(raw.keyframes, duration);
    return {
      id, type, start, duration,
      ...(asset ? { assetId: asset.id } : { emoji }),
      transform: { ...DEFAULT_TRANSFORM, scale: 0.35, ...(sanitizeTransform(raw.transform) ?? {}) },
      animationIn: { kind: 'pop', duration: 0.3 },
      ...(kf?.length ? { keyframes: kf } : {}),
      ...sanitizeVisualExtras(raw, duration),
      ...lbl,
    };
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
      ...sanitizeVisualExtras(raw, duration),
      ...lbl,
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
  const audioX = sanitizeAudioExtras(raw);

  if (type === 'audio') {
    const duck = bool(raw.duckUnderVoice);
    return {
      id, type, assetId, start, duration, in: inPt, speed, volume,
      ...(fadeIn ? { fadeIn } : {}), ...(fadeOut ? { fadeOut } : {}),
      ...(duck !== undefined ? { duckUnderVoice: duck } : {}),
      ...audioX,
      ...lbl,
    };
  }

  const kf = sanitizeKeyframes(raw.keyframes, duration);
  const tr = sanitizeTransition(raw.transitionIn, duration);
  const cp = oneOf(raw.colorPreset, COLOR_PRESETS);
  const muted = bool(raw.muted);
  return {
    id, type, assetId, start, duration, in: inPt, speed, volume,
    transform: { ...DEFAULT_TRANSFORM, ...(sanitizeTransform(raw.transform) ?? {}) },
    filters: withGrade(sanitizeFilters(raw.filters) ?? [], raw.colorGrade),
    ...(kf?.length ? { keyframes: kf } : {}),
    ...(tr ? { transitionIn: tr } : {}),
    ...(cp ? { colorPreset: cp } : {}),
    ...(COLOR_GRADE_LIVE && sanitizeColorGrade(raw.colorGrade) ? { colorGrade: sanitizeColorGrade(raw.colorGrade)! } : {}),
    ...(muted !== undefined ? { muted } : {}),
    ...(fadeIn ? { fadeIn } : {}), ...(fadeOut ? { fadeOut } : {}),
    ...sanitizeVisualExtras(raw, duration),
    ...audioX,
    ...lbl,
  };
}

/** patch de update_clip: só campos válidos para o tipo; objetos parciais mesclados com o atual */
function buildClipPatch(raw: Record<string, unknown>, clip: Clip, assets: Record<Id, MediaAsset>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const asset = 'assetId' in clip && clip.assetId ? assets[clip.assetId] : undefined;
  const label = str(raw.label, 60); if (label) out.label = label;
  const gid = str(raw.groupId, 80); if (gid) out.groupId = gid;
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
    Object.assign(out, sanitizeAudioExtras(raw));
  }
  if (duration !== undefined) out.duration = r3(Math.max(0.05, duration));
  const d = (out.duration as number | undefined) ?? clip.duration;

  if (clip.type === 'video' || clip.type === 'image' || clip.type === 'sticker' || clip.type === 'shape') {
    const tf = sanitizeTransform(raw.transform, clip.transform); if (tf) out.transform = tf;
    const kf = sanitizeKeyframes(raw.keyframes, d); if (kf) out.keyframes = kf;
    Object.assign(out, sanitizeVisualExtras(raw, d));
  }
  if (clip.type === 'video' || clip.type === 'image') {
    const fl = sanitizeFilters(raw.filters); if (fl) out.filters = fl;
    if (raw.transitionIn === null || ('transitionIn' in raw && raw.transitionIn === undefined)) out.transitionIn = undefined;
    else { const tr = sanitizeTransition(raw.transitionIn, d); if (tr) out.transitionIn = tr; }
  }
  if (clip.type === 'video' || clip.type === 'adjustment' || clip.type === 'image') {
    const cp = oneOf(raw.colorPreset, COLOR_PRESETS); if (cp) out.colorPreset = cp;
    if ('colorGrade' in raw) {
      const cg = sanitizeColorGrade(raw.colorGrade);
      if (cg === null) out.colorGrade = undefined;
      else if (cg && COLOR_GRADE_LIVE) out.colorGrade = cg;
      else if (cg) {
        // motor de cor ainda não renderiza colorGrade: vira filtros equivalentes (que já aparecem)
        const base = (out.filters as Filter[] | undefined) ?? ('filters' in clip ? clip.filters : []) ?? [];
        const eq = gradeToFilters(cg);
        out.filters = [...base.filter((f) => !eq.some((e) => e.kind === f.kind)), ...eq];
      }
    }
  }
  if (clip.type === 'adjustment') {
    const fl = sanitizeFilters(raw.filters); if (fl) out.filters = fl;
    const fx = raw.effects === null ? [] : sanitizeEffects(raw.effects); if (fx) out.effects = fx;
  }
  if (clip.type === 'sticker') { const e = emojiOf(raw.emoji); if (e) out.emoji = e; }
  if (clip.type === 'shape') {
    const sh = oneOf(raw.shape, SHAPE_KINDS); if (sh) out.shape = sh;
    const f = color(raw.fill); if (f) out.fill = f;
    const s = color(raw.stroke); if (s !== undefined) out.stroke = s;
    const sw = clampNum(raw.strokeWidth, 0, 60); if (sw !== undefined) out.strokeWidth = sw;
    const cr = clampNum(raw.cornerRadius, 0, 200); if (cr !== undefined) out.cornerRadius = cr;
  }
  if (clip.type === 'text') {
    const text = str(raw.text, 300); if (text) out.text = text;
    const st = sanitizeTextStyle(raw.style); if (st) out.style = { ...clip.style, ...st };
    const pos = sanitizePosition(raw.position, clip.position); if (pos) out.position = pos;
    const an = textAnim(raw.animation) ?? textAnim(raw.animationIn); if (an) out.animation = an;
    const ao = textAnim(raw.animationOut); if (ao) out.animationOut = ao;
    const al = textAnim(raw.animationLoop); if (al) out.animationLoop = al;
    const rot = clampNum(raw.rotation, -360, 360); if (rot !== undefined) out.rotation = rot;
    const sc = clampNum(raw.scale, 0.1, 5); if (sc !== undefined) out.scale = sc;
    const kf = sanitizeKeyframes(raw.keyframes, d); if (kf) out.keyframes = kf;
  }
  if (!Object.keys(out).length) fail('patch vazio');
  return out;
}

function sanitizeSegments(raw: unknown, p: Project): CaptionSegment[] {
  const end = Math.max(projectDuration(p), 0.1);
  // palavras ganham ids estáveis ("w00001"…) p/ cortes ancorados na fala (remove_words)
  return assignWordIds(sanitizeTranscript({ segments: raw }, { duration: end }));
}

function sanitizeMarker(raw: Record<string, unknown>, p: Project, partial: boolean): Partial<Marker> {
  const dur = Math.max(projectDuration(p), 0.1);
  const out: Partial<Marker> = {};
  const t = clampNum(raw.t, 0, dur); if (t !== undefined) out.t = r3(t);
  const end = clampNum(raw.end, 0, dur); if (end !== undefined && end > (out.t ?? 0)) out.end = r3(end);
  const label = str(raw.label, 80); if (label) out.label = label;
  const c = color(raw.color); if (c) out.color = c;
  const kind = oneOf(raw.kind, MARKER_KINDS); if (kind) out.kind = kind;
  const res = bool(raw.resolved); if (res !== undefined) out.resolved = res;
  if (!partial && out.t === undefined) fail('marcador sem tempo');
  return out;
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
      if (isObj(patch.canvas)) {
        const type = oneOf(patch.canvas.type, ['color', 'blur', 'image'] as const);
        if (type) {
          const img = str(patch.canvas.assetId, 80);
          if (type === 'image' && !(img && assets[img]?.kind === 'image')) fail('canvas: imagem não existe');
          out.canvas = {
            type,
            ...(type === 'color' ? { color: color(patch.canvas.color) || '#000000' } : {}),
            ...(type === 'blur' ? { blur: clampNum(patch.canvas.blur, 0, 1) ?? 0.6 } : {}),
            ...(type === 'image' ? { assetId: img } : {}),
          };
        }
      }
      if (!Object.keys(out).length) fail('patch vazio');
      return { op: 'set_project', patch: out, ...meta };
    }
    case 'set_aspect': {
      const aspect = oneOf(r.aspect, ASPECTS) ?? fail('aspecto inválido');
      return { op: 'set_aspect', aspect, ...meta };
    }
    case 'add_track': {
      const t = isObj(r.track) ? r.track : r;
      const tk = oneOf(t.kind, TRACK_KINDS) ?? fail('kind da trilha inválido');
      let tid = str(t.id, 80);
      if (!tid || p.tracks.some((x) => x.id === tid)) tid = uid('track');
      const name = str(t.name, 40) ?? `${TRACK_NAMES[tk]} ${p.tracks.filter((x) => x.kind === tk).length + 1}`;
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
    case 'move_track': {
      const tid = str(r.trackId, 80) ?? fail('trackId ausente');
      if (!p.tracks.some((x) => x.id === tid)) fail(`trilha não existe: ${tid}`);
      const index = Math.round(clampNum(r.index, 0, Math.max(0, p.tracks.length - 1)) ?? fail('index inválido'));
      return { op: 'move_track', trackId: tid, index, ...meta };
    }
    case 'add_clip': {
      const rc = isObj(r.clip) ? r.clip : fail('clip ausente');
      const built = buildClip(rc, p, assets);
      const gid = str(rc.groupId, 80);
      const clip = (gid ? { ...built, groupId: gid } : built) as Clip;
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
    case 'duplicate_clip': {
      const { clip, track } = clipOf();
      let newId = str(r.newId, 80);
      if (!newId || findClip(p, newId)) newId = uid('clip');
      const start = clampNum(r.start, 0, 24 * 3600);
      const tid = str(r.trackId, 80);
      const dest = tid ? p.tracks.find((t) => t.id === tid) : undefined;
      const trackOk = dest && dest.kind === track.kind && !dest.locked;
      return { op: 'duplicate_clip', clipId: clip.id, newId, ...(start !== undefined ? { start: r3(start) } : {}), ...(trackOk ? { trackId: dest!.id } : {}), ...meta };
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
    case 'remove_words': {
      const from = str(r.fromWordId, 20) ?? fail('fromWordId ausente');
      const to = str(r.toWordId, 20) ?? from;
      const words = allWords(p);
      const a = words.findIndex((w) => w.id === from);
      const b = words.findIndex((w) => w.id === to);
      if (a < 0 || b < 0) fail(`palavras não encontradas: ${from}..${to}`);
      const [i, j] = a <= b ? [a, b] : [b, a];
      if (dur > 0 && words[j].end - words[i].start >= dur - 0.25) fail('cortaria o vídeo inteiro');
      const padding = clampNum(r.padding, 0, 0.3);
      return { op: 'remove_words', fromWordId: words[i].id!, toWordId: words[j].id!, ...(padding !== undefined ? { padding } : {}), ...meta };
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
        // palavras antigas não batem mais com o texto novo: redistribui (ids novos derivados do segmento)
        const words = text.split(/\s+/).filter(Boolean);
        const t0 = out.start ?? seg.start; const t1 = out.end ?? seg.end;
        out.words = words.map((w, i) => ({ id: `${sid}_${i}`, text: w, start: r3(t0 + ((t1 - t0) * i) / words.length), end: r3(t0 + ((t1 - t0) * (i + 1)) / words.length) }));
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
    case 'add_marker': {
      const m = isObj(r.marker) ? r.marker : r;
      const out = sanitizeMarker(m, p, false);
      let mid = str(m.id, 80);
      if (!mid || p.markers?.some((x) => x.id === mid)) mid = uid('mk');
      return { op: 'add_marker', marker: { kind: 'user', ...out, id: mid } as Marker, ...meta };
    }
    case 'update_marker': {
      const mid = str(r.markerId, 80) ?? fail('markerId ausente');
      if (!p.markers?.some((x) => x.id === mid)) fail(`marcador não existe: ${mid}`);
      const patch = sanitizeMarker(isObj(r.patch) ? r.patch : fail('patch ausente'), p, true);
      if (!Object.keys(patch).length) fail('patch vazio');
      return { op: 'update_marker', markerId: mid, patch, ...meta };
    }
    case 'remove_marker': {
      const mid = str(r.markerId, 80) ?? fail('markerId ausente');
      if (!p.markers?.some((x) => x.id === mid)) fail(`marcador não existe: ${mid}`);
      return { op: 'remove_marker', markerId: mid, ...meta };
    }
  }
  return fail('op não tratada');
}

/** sanitiza a lista inteira simulando a aplicação em sequência */
export function sanitizeOps(raw: unknown, project: Project, assets: Record<Id, MediaAsset>): SanitizeResult {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.ops) ? raw.ops : [];
  const ops: EditOp[] = [];
  const dropped: Dropped[] = [];
  const sfx: SfxRequest[] = [];
  let p = project;
  for (const item of list.slice(0, MAX_OPS)) {
    try {
      if (isLibraryMacro(item)) {
        // macro da biblioteca (modelo, preset de legenda, look, efeito sonoro) -> ops reais
        for (const raw of expandLibraryOp(item as Record<string, unknown>, p, sfx)) {
          const op = { ...raw, id: raw.id ?? uid('op'), explain: raw.explain || DEFAULT_EXPLAIN[raw.op] } as EditOp;
          p = applyOp(p, op);
          ops.push(op);
        }
        continue;
      }
      const op = sanitizeOp(item, p, assets);
      const next = applyOp(p, op);
      ops.push(op);
      p = next;
    } catch (e) {
      dropped.push({ op: item, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (list.length > MAX_OPS) dropped.push({ op: null, reason: `limite de ${MAX_OPS} operações` });
  return { ops, dropped, project: p, sfx };
}

export { EPS as VALIDATE_EPS };
