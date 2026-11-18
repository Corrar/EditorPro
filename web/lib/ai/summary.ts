/* =====================================================================
   Resumo compacto do projeto para o prompt do editor (puro).
   Mantém ids reais e tempos com 2 casas — o modelo precisa deles para
   gerar ops válidas, mas sem thumbnails/waveforms/URLs.
   ===================================================================== */
import type { ChatMessage, Clip, Id, MediaAsset, Project } from '../types';
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
    if (c.keyframes?.length) base.keyframes = c.keyframes.length;
    if (c.filters.length) base.filters = c.filters;
    if (c.transitionIn) base.transitionIn = c.transitionIn;
  }
  if (c.type === 'video' && c.colorPreset) base.colorPreset = c.colorPreset;
  if (c.type === 'audio' && c.duckUnderVoice) base.duck = true;
  if (c.type === 'text') Object.assign(base, { text: c.text, position: c.position, animation: c.animation, fontSize: c.style.fontSize, color: c.style.color });
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
  const capList = segs.slice(0, maxCaps).map((s) => ({ id: s.id, start: t2(s.start), end: t2(s.end), text: s.text }));
  const { fontFamily: _f, ...capStyle } = p.captions.style;
  return {
    project: { name: p.name, aspect: p.aspect, size: `${p.width}x${p.height}`, fps: p.fps, duration: t2(projectDuration(p)), brief: p.brief || undefined },
    assets: Object.values(assets).map((a) => ({
      id: a.id, kind: a.kind, role: a.role, name: a.name, duration: t2(a.duration),
      ...(a.width && a.height ? { size: `${a.width}x${a.height}` } : {}),
    })),
    tracks: p.tracks.map((t) => ({
      id: t.id, kind: t.kind, name: t.name,
      ...(t.locked ? { locked: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}),
      clips: t.clips.map(clipLine),
    })),
    captions: {
      enabled: p.captions.enabled,
      language: p.captions.language,
      style: capStyle,
      count: segs.length,
      segments: capList,
      ...(segs.length > maxCaps ? { omitted: segs.length - maxCaps } : {}),
    },
    style: p.style ?? null,
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
