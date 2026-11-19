/* =====================================================================
   Conversão de tempos: MÍDIA (transcrição/silêncios) <-> TIMELINE (clipes).
   Um clipe de vídeo/áudio mostra a mídia [in, in + duration*speed] em
   [start, start + duration] na timeline. Puro e testado.
   ===================================================================== */
import type { CaptionSegment, CaptionWord, Clip, Id, Project, Seconds } from '../types';
import { uid } from '../util';
import { r3 } from './sanitize';
import { sourceRangeOf, timelineTimeForSource } from '../ops';

type MediaClip = Extract<Clip, { in: Seconds }>;

/** clipes (vídeo/áudio) que exibem a mídia `assetId`, em trilhas visíveis/audíveis */
export function clipsOfAsset(p: Project, assetId: Id): MediaClip[] {
  const out: MediaClip[] = [];
  for (const t of p.tracks) {
    for (const c of t.clips) if ((c.type === 'video' || c.type === 'audio') && c.assetId === assetId) out.push(c);
  }
  // vídeo tem prioridade sobre áudio solto do mesmo asset
  return out.sort((a, b) => (a.type === b.type ? a.start - b.start : a.type === 'video' ? -1 : 1));
}

/** tempo da mídia -> tempo da timeline, ou null se esse trecho não está na timeline (velocidade, curva e reverso) */
export function mediaToTimeline(clips: MediaClip[], m: Seconds): { t: Seconds; clipId: Id } | null {
  for (const c of clips) {
    const t = timelineTimeForSource(c, m);
    if (t !== null) return { t, clipId: c.id };
  }
  return null;
}

/** intervalo de mídia -> intervalos de timeline (um por clipe que o mostra) */
export function mediaRangeToTimeline(clips: MediaClip[], m0: Seconds, m1: Seconds): { start: Seconds; end: Seconds; clipId: Id }[] {
  const out: { start: Seconds; end: Seconds; clipId: Id }[] = [];
  for (const c of clips) {
    const [ca, cb] = sourceRangeOf(c);
    const a = Math.max(m0, ca);
    const b = Math.min(m1, cb);
    if (b - a <= 1e-6) continue;
    const ta = timelineTimeForSource(c, a)!, tb = timelineTimeForSource(c, b)!;
    out.push({ start: Math.min(ta, tb), end: Math.max(ta, tb), clipId: c.id });
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * converte legendas com tempos da MÍDIA para tempos da TIMELINE.
 * Palavras fora de qualquer clipe somem; um segmento que atravessa
 * clipes diferentes vira um segmento por clipe.
 */
export function captionsMediaToTimeline(p: Project, assetId: Id, segs: CaptionSegment[]): CaptionSegment[] {
  const clips = clipsOfAsset(p, assetId);
  if (!clips.length) return [];
  const out: CaptionSegment[] = [];
  for (const s of segs) {
    const words = s.words?.length ? s.words : [{ start: s.start, end: s.end, text: s.text }];
    const groups = new Map<Id, CaptionWord[]>();
    const order: Id[] = [];
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      const hit = mediaToTimeline(clips, mid);
      if (!hit) continue;
      const c = clips.find((x) => x.id === hit.clipId)!;
      const cEnd = c.start + c.duration;
      const [ca, cb] = sourceRangeOf(c);
      // inverso da curva de velocidade (antes: velocidade constante → até 14,6 s de deriva com "montagem")
      const ta = timelineTimeForSource(c, Math.min(cb, Math.max(ca, w.start)))!;
      const tb = timelineTimeForSource(c, Math.min(cb, Math.max(ca, w.end)))!;
      const ws = Math.max(c.start, Math.min(ta, tb));
      const we = Math.min(cEnd, Math.max(ta, tb));
      if (we - ws < 0.01) continue;
      if (!groups.has(hit.clipId)) { groups.set(hit.clipId, []); order.push(hit.clipId); }
      groups.get(hit.clipId)!.push({ start: r3(ws), end: r3(we), text: w.text });
    }
    order.forEach((cid, i) => {
      const ws = groups.get(cid)!.sort((a, b) => a.start - b.start);
      const text = ws.map((w) => w.text).join(' ');
      out.push({
        id: i === 0 ? s.id : uid('cap'),
        start: ws[0].start,
        end: ws[ws.length - 1].end,
        text,
        words: s.words?.length ? ws : undefined,
        ...(s.emphasis?.length ? { emphasis: s.emphasis } : {}),
      });
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** une intervalos sobrepostos/encostados (entrada em qualquer ordem) */
export function mergeRanges(ranges: { start: Seconds; end: Seconds }[], gap = 0): { start: Seconds; end: Seconds }[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: { start: Seconds; end: Seconds }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
