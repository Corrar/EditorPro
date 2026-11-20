/* =====================================================================
   Resumo compacto do projeto para o prompt do editor (puro).
   Mantém ids reais e tempos com 2 casas — o modelo precisa deles para
   gerar ops válidas, mas sem thumbnails/waveforms/URLs.
   ===================================================================== */
import type { ChatMessage, Clip, Id, MediaAsset, Project } from '../types';
import { captionsAreSpeech } from './legacyCaptions';
import { clipEnd, projectDuration } from '../ops';

const t2 = (n: number) => Math.round(n * 100) / 100;

function clipLine(c: Clip): Record<string, unknown> {
  const base: Record<string, unknown> = { id: c.id, type: c.type, start: t2(c.start), end: t2(clipEnd(c)), dur: t2(c.duration) };
  if (c.label) base.label = c.label;
  if (c.locked) base.locked = true;
  if (c.type === 'video' || c.type === 'audio') {
    Object.assign(base, { assetId: c.assetId, in: t2(c.in), mediaEnd: t2(c.in + c.duration * c.speed) });
    if (c.speed !== 1) base.speed = c.speed;
    if (c.volume !== 1) base.volume = c.volume;
  }
  if (c.type === 'image') base.assetId = c.assetId;
  if (c.type === 'video' || c.type === 'image') {
    if (c.transform.scale !== 1 || c.transform.x || c.transform.y) base.transform = c.transform;
    if (c.keyframes?.length) {
      // quais propriedades já animam (a IA manda só as novas; o validate/recursos mesclam por campo)
      const props = [...new Set(c.keyframes.flatMap((k) => [...Object.keys(k.transform ?? {}), ...Object.keys(k.props ?? {})]))];
      base.keyframes = { count: c.keyframes.length, props };
    }
    if (c.filters.length) base.filters = c.filters;
    if (c.transitionIn) {
      const tr = c.transitionIn as { kind: string; duration: number; name?: string };
      base.transitionIn = tr.kind === 'custom' ? { kind: 'custom', name: tr.name, duration: tr.duration } : c.transitionIn;
    }
  }
  if (c.type === 'video' && c.colorPreset) base.colorPreset = c.colorPreset;
  const cg = (c as { colorGrade?: import('../types').ColorGrade }).colorGrade;
  if (cg) {
    // resumo da correção de cor atual (update_clip.colorGrade só troca os campos enviados)
    const g: Record<string, unknown> = {};
    if (cg.lut) g.lut = `${cg.lut.id}@${cg.lut.intensity}`;
    for (const k of ['exposure', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows'] as const) if (cg[k]) g[k] = cg[k];
    const wheels = (['lift', 'gamma', 'gain', 'offset'] as const).filter((k) => cg[k]);
    if (wheels.length) g.wheels = wheels;
    if (cg.curves) g.curves = Object.keys(cg.curves);
    if (cg.hsl) g.hsl = Object.keys(cg.hsl);
    base.colorGrade = g;
  }
  if (c.type === 'audio' && c.duckUnderVoice) base.duck = true;
  if (c.type === 'text') Object.assign(base, { text: c.text, position: c.position, animation: c.animation, fontSize: c.style.fontSize, color: c.style.color });
  if (c.type === 'sticker') Object.assign(base, c.emoji ? { emoji: c.emoji } : { assetId: c.assetId });
  if (c.type === 'shape') Object.assign(base, { shape: c.shape, fill: c.fill });
  if (c.type === 'adjustment') Object.assign(base, { ...(c.colorPreset ? { colorPreset: c.colorPreset } : {}), ...(c.effects?.length ? { effects: c.effects.map((e) => e.kind) } : {}) });
  // extras estilo CapCut (só o que estiver ligado, para economizar tokens)
  const x = c as unknown as Record<string, unknown>;
  for (const k of ['speedPreset', 'reverse', 'pitch', 'blendMode', 'fit', 'flipH', 'flipV', 'removeBackground'] as const) if (x[k] !== undefined && x[k] !== false) base[k] = x[k];
  if (Array.isArray(x.effects) && c.type !== 'adjustment' && x.effects.length) base.effects = (x.effects as { kind: string; name?: string }[]).map((e) => (e.kind === 'custom' ? `custom:${e.name ?? 'sem nome'}` : e.kind));
  if (Array.isArray(x.audioEffects) && x.audioEffects.length) base.audioEffects = (x.audioEffects as { kind: string }[]).map((e) => e.kind);
  for (const k of ['mask', 'chromaKey', 'crop', 'animationIn', 'animationOut', 'animationLoop'] as const) if (x[k]) base[k] = x[k];
  return base;
}

export interface SummaryOptions {
  /** máximo de segmentos de legenda listados (resto é resumido) */
  maxCaptions?: number;
  maxMessages?: number;
}

export function summarizeProject(
  p: Project,
  assets: Record<Id, MediaAsset>,
  messages: ChatMessage[] = [],
  opts: SummaryOptions = {},
): Record<string, unknown> {
  const maxCaps = opts.maxCaptions ?? 200;
  const maxMsgs = opts.maxMessages ?? 12;
  const segs = p.captions.segments;
  // transcrição COM ids de palavra: "[w00012 4.20-4.45] né" — a IA corta fala com remove_words (preciso)
  const capList = segs.slice(0, maxCaps).map((s) => ({
    // texto derivado das palavras (cortes com ripple removem palavras mas não reescrevem `text`)
    id: s.id, start: t2(s.start), end: t2(s.end), text: s.words?.length ? s.words.map((w) => w.text).join(' ') : s.text,
    ...(s.words?.some((w) => w.id) ? { words: s.words.map((w) => `[${w.id ?? '?'} ${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.text}`).join(' ') } : {}),
  }));
  const { fontFamily: _f, ...capStyle } = p.captions.style;
  const inUse = new Set(p.tracks.flatMap((t) => t.clips.map((c) => ('assetId' in c ? c.assetId : undefined))).filter(Boolean));
  return {
    project: { name: p.name, aspect: p.aspect, size: `${p.width}x${p.height}`, fps: p.fps, duration: t2(projectDuration(p)), brief: p.brief || undefined },
    assets: Object.values(assets).filter((a) => !a.library).map((a) => ({
      id: a.id, kind: a.kind, role: a.role, name: a.name, duration: t2(a.duration),
      ...(a.width && a.height ? { size: `${a.width}x${a.height}` } : {}),
      ...(a.beats?.length ? { beats: a.beats.slice(0, 200).map(t2) } : {}),
      // gráfico por código: o SVG volta p/ o Claude poder editar (update_graphic) — só o que está na timeline
      // (redesenhar cria um asset novo; a versão antiga fica só para o desfazer)
      ...(a.role === 'graphic' && a.svg && inUse.has(a.id) ? { svg: a.svg.length <= 6000 ? a.svg : `${a.svg.slice(0, 6000)}…(cortado)` } : {}),
      ...(a.role === 'graphic' && !inUse.has(a.id) ? { offTimeline: true } : {}),
    })),
    tracks: p.tracks.map((t) => ({
      id: t.id, kind: t.kind, name: t.name,
      ...(t.locked ? { locked: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}),
      clips: t.clips.map(clipLine),
    })),
    captions: {
      /** true = o texto É a fala transcrita; false = texto que não veio da fala (manual, tradução ou legenda antiga de exemplo) */
      transcribed: captionsAreSpeech(p),
      ...(p.captions.source ? { source: p.captions.source } : {}),
      enabled: p.captions.enabled,
      language: p.captions.language,
      style: capStyle,
      count: segs.length,
      segments: capList,
      ...(segs.length > maxCaps ? { omitted: segs.length - maxCaps } : {}),
    },
    style: p.style ?? null,
    ...(p.canvas ? { canvas: p.canvas } : {}),
    markers: (p.markers ?? []).filter((m) => m.kind !== 'beat').slice(0, 80).map((m) => ({ id: m.id, t: t2(m.t), ...(m.end !== undefined ? { end: t2(m.end) } : {}), kind: m.kind ?? 'user', ...(m.label ? { label: m.label } : {}), ...(m.resolved ? { resolved: true } : {}) })),
    ...((p.markers ?? []).some((m) => m.kind === 'beat') ? { beatMarkers: (p.markers ?? []).filter((m) => m.kind === 'beat').length } : {}),
    chat: messages
      .filter((m) => m.role !== 'system' && m.text)
      .slice(-maxMsgs)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 600) })),
  };
}

/** remove campos pesados/irrelevantes antes de mandar o projeto ao servidor (limite de 4,5 MB da Vercel) */
export function slimAssets(assets: Record<Id, MediaAsset>): Record<Id, MediaAsset> {
  const out: Record<Id, MediaAsset> = {};
  for (const [id, a] of Object.entries(assets)) {
    const { thumbnails: _t, waveform: _w, url: _u, ...rest } = a;
    out[id] = rest;
  }
  return out;
}
