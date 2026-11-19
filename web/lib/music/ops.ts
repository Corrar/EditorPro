/* =====================================================================
   Música · colocar a trilha no projeto (puro: devolve EditOps).
   ===================================================================== */
import type { AudioClip, Id, MediaAsset, Project, Seconds } from '../types';
import { clipEnd, type EditOp } from '../ops';
import { makeAudioClip } from '../defaults';
import { uid } from '../util';
import { MAX_DURATION } from './engine';

const isMusicTrack = (name: string) => /m[uú]sica|music|trilha/i.test(name);

/** fim do conteúdo visual (vídeo, imagem, texto, sticker…) do projeto; 0 se não houver */
export function visualEnd(p: Project): Seconds {
  let end = 0;
  for (const t of p.tracks) {
    if (t.kind === 'audio') continue;
    for (const c of t.clips) end = Math.max(end, clipEnd(c));
  }
  return end;
}

/**
 * Duração para a música a partir de `at`: vai até o fim do vídeo (se houver
 * vídeo depois de `at`); senão usa `fallback` (30 s). Mínimo 3 s.
 */
export function fitMusicDuration(p: Project, at: Seconds, fallback: Seconds = 30): Seconds {
  const end = visualEnd(p);
  const d = end - at > 1 ? end - at : fallback;
  return Math.round(Math.min(MAX_DURATION, Math.max(3, d)) * 1000) / 1000;
}

export interface MusicClipOptions {
  /** duração do clipe (padrão: a do asset) */
  duration?: Seconds;
  /** 0..1 (padrão 0,8 — música de fundo) */
  volume?: number;
  fadeIn?: Seconds;
  fadeOut?: Seconds;
  /** abaixar sob a voz (padrão true) */
  duck?: boolean;
  id?: Id;
  trackId?: Id;
}

/**
 * EditOps para pôr a música na trilha de áudio em `at`: usa uma trilha
 * "Música" livre nesse trecho ou cria uma nova. 1 lote = 1 desfazer.
 */
export function musicClipOps(p: Project, asset: MediaAsset, at: Seconds, opts: MusicClipOptions = {}): EditOp[] {
  const start = Math.max(0, Math.round(at * 1000) / 1000);
  const dur = Math.max(0.1, Math.min(asset.duration || opts.duration || 30, opts.duration ?? Infinity));
  const busy = (t: Project['tracks'][number]) => t.clips.some((c) => c.start < start + dur - 1e-6 && clipEnd(c) > start + 1e-6);
  const ops: EditOp[] = [];
  let trackId = opts.trackId;
  if (!trackId) {
    const free = p.tracks.find((t) => t.kind === 'audio' && !t.locked && isMusicTrack(t.name) && !busy(t))
      ?? p.tracks.find((t) => t.kind === 'audio' && !t.locked && t.clips.length === 0 && !/narra|voz|efeito|sfx/i.test(t.name));
    trackId = free?.id;
  }
  if (!trackId) {
    trackId = uid('track_music');
    const n = p.tracks.filter((t) => isMusicTrack(t.name)).length;
    ops.push({ op: 'add_track', track: { id: trackId, kind: 'audio', name: n ? `Música ${n + 1}` : 'Música' }, explain: 'Nova trilha de música' });
  }
  const label = `Música · ${asset.name.replace(/\.(wav|mp3|m4a|ogg)$/i, '')}`;
  const extra: Partial<AudioClip> = { id: opts.id ?? uid('clip'), label, volume: opts.volume ?? 0.8, duration: dur, duckUnderVoice: opts.duck ?? true };
  if (opts.fadeIn && opts.fadeIn > 0) extra.fadeIn = Math.min(opts.fadeIn, dur / 2);
  if (opts.fadeOut && opts.fadeOut > 0) extra.fadeOut = Math.min(opts.fadeOut, dur / 2);
  const clip: AudioClip = makeAudioClip(asset, start, extra);
  ops.push({ op: 'add_clip', trackId, clip, explain: `Música “${label.slice(9)}”` });
  return ops;
}

/** marcadores de batida (kind 'beat') na timeline a partir dos tempos da música + início do clipe */
export function beatMarkerOps(p: Project, beats: Seconds[], at: Seconds, opts: { every?: number; color?: string } = {}): EditOp[] {
  const every = Math.max(1, opts.every ?? 1);
  const existing = new Set((p.markers ?? []).filter((m) => m.kind === 'beat').map((m) => m.t.toFixed(2)));
  const out: EditOp[] = [];
  beats.forEach((b, i) => {
    if (i % every) return;
    const t = Math.round((at + b) * 1000) / 1000;
    if (existing.has(t.toFixed(2))) return;
    out.push({ op: 'add_marker', marker: { id: `beat_${Math.round(t * 1000)}`, t, kind: 'beat', color: opts.color ?? '#E0A32E' }, explain: out.length === 0 ? 'Marcando as batidas da música' : undefined });
  });
  return out;
}
