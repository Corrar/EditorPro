/* SRT / WebVTT a partir das legendas (ou, sem legendas, dos textos na tela) */
import type { Project, Seconds } from '../types';

export interface Cue { start: Seconds; end: Seconds; text: string }

export function captionCues(p: Project): Cue[] {
  const segs = p.captions.segments.filter((s) => s.text.trim() && s.end > s.start);
  if (segs.length) {
    return [...segs].sort((a, b) => a.start - b.start).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  }
  const cues: Cue[] = [];
  for (const tr of p.tracks) {
    if (tr.hidden) continue;
    for (const c of tr.clips) if (c.type === 'text' && c.text.trim()) cues.push({ start: c.start, end: c.start + c.duration, text: c.text.trim() });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function stamp(sec: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}${sep}${String(r).padStart(3, '0')}`;
}

/** quebra texto longo em até 2 linhas de ~42 caracteres (padrão de legenda) */
export function wrapCue(text: string, max = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const words = clean.split(' ');
  let best = clean.length;
  let split = -1;
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].length + (i ? 1 : 0);
    const diff = Math.abs(clean.length - acc * 2);
    if (diff < best) { best = diff; split = i; }
  }
  if (split < 0) return clean;
  return `${words.slice(0, split + 1).join(' ')}\n${words.slice(split + 1).join(' ')}`;
}

export function toSRT(p: Project): string {
  return captionCues(p)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${wrapCue(c.text)}\n`)
    .join('\n');
}

export function toVTT(p: Project): string {
  const body = captionCues(p)
    .map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${wrapCue(c.text)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}
