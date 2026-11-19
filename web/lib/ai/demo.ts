/* =====================================================================
   MODO DEMO (sem chave de IA): planejador heurístico local.
   Tudo aqui é PURO (testado em vitest). A parte que depende do navegador
   (decodificar áudio, amostrar quadros) fica em analysis.ts.
   Sempre devolve EditOp[] com `explain` em PT-BR.
   ===================================================================== */
import type {
  AspectRatio, AudioClip, AudioEffectKind, CaptionSegment, CaptionStyle, ChatContext as UIChatContext, Clip, ClipAnimation, ColorPreset, Id,
  Keyframe, MediaAsset, Project, Seconds, SpeedPreset, StyleProfile, TransitionKind, VideoClip, VisualEffectKind,
} from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { beatMarkerOps, beatSyncOps, chapterOps, fillerOps, highlightOps, hookFromTranscript, hookOps, timelineBeats } from './features';
import { applyOps, clipEnd, projectDuration, type EditOp } from '../ops';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { formatTime, uid } from '../util';
import { distributeWords, r3, splitSegment } from './sanitize';
import { captionsMediaToTimeline, clipsOfAsset, mediaRangeToTimeline, mergeRanges } from './timemap';
import { demoLibraryOps } from './library';

export interface Range { start: Seconds; end: Seconds }
export interface DemoResult { reply: string; ops: EditOp[]; undo?: boolean }

/* ---------- texto ---------- */

/** minúsculas, sem acentos, espaços normalizados */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const fmt = (t: number) => formatTime(t, { decimals: true });

/* ---------- silêncios (áudio) ---------- */

export interface SilenceOptions {
  /** janela de análise em segundos */
  frame?: number;
  /** silêncio mínimo para cortar (s) */
  minSilence?: number;
  /** respiro mantido de cada lado da fala (s) */
  pad?: number;
}

/** RMS em dB por janela */
export function rmsDb(samples: Float32Array, sampleRate: number, frame = 0.03): number[] {
  const n = Math.max(1, Math.round(sampleRate * frame));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += n) {
    let sum = 0;
    const end = Math.min(samples.length, i + n);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    out.push(rms > 1e-7 ? 20 * Math.log10(rms) : -140);
  }
  return out;
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)))];
}

/** detecta silêncios (tempos da MÍDIA) com limiar adaptativo ao nível de ruído/fala */
export function detectSilences(samples: Float32Array, sampleRate: number, opts: SilenceOptions = {}): Range[] {
  const frame = opts.frame ?? 0.03;
  const minSilence = opts.minSilence ?? 0.55;
  const pad = opts.pad ?? 0.12;
  const db = rmsDb(samples, sampleRate, frame);
  if (db.length < 3) return [];
  const floor = Math.max(percentile(db, 0.1), -100);
  const speech = percentile(db, 0.9);
  if (speech - floor < 10) return []; // sem contraste: áudio contínuo ou mudo
  const threshold = Math.min(-18, Math.max(-60, floor + (speech - floor) * 0.3));
  const total = samples.length / sampleRate;
  const out: Range[] = [];
  let runStart = -1;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      const s = runStart * frame;
      const e = Math.min(total, i * frame);
      // nas bordas do arquivo não precisa de respiro do lado de fora
      const a = s <= 1e-6 ? 0 : s + pad;
      const b = e >= total - 1e-6 ? total : e - pad;
      if (b - a >= minSilence - 2 * pad && b - a > 0.15) out.push({ start: r3(a), end: r3(b) });
      runStart = -1;
    }
  }
  return out;
}

/** complemento dos silêncios = trechos de fala (mídia) */
export function speechRanges(silences: Range[], duration: Seconds): Range[] {
  const sil = mergeRanges(silences);
  const out: Range[] = [];
  let t = 0;
  for (const s of sil) {
    if (s.start - t > 0.2) out.push({ start: t, end: s.start });
    t = Math.max(t, s.end);
  }
  if (duration - t > 0.2) out.push({ start: t, end: duration });
  return out;
}

/** converte silêncios (mídia) em ripple_delete na timeline, do começo para o fim (ajustando o deslocamento) */
export function silenceCutOps(p: Project, silencesByAsset: Record<Id, Range[]>): { ops: EditOp[]; removed: number } {
  const ranges: Range[] = [];
  for (const [assetId, sil] of Object.entries(silencesByAsset)) {
    const clips = clipsOfAsset(p, assetId).filter((c) => c.type === 'video' || c.type === 'audio');
    for (const s of sil) for (const r of mediaRangeToTimeline(clips, s.start, s.end)) ranges.push(r);
  }
  const total = projectDuration(p);
  // une cortes separados por menos de 0,3 s de conteúdo (evita "piscadas" de 1-2 quadros)
  const merged = mergeRanges(ranges, 0.3).filter((r) => r.end - r.start >= 0.2);
  // sobra minúscula no fim/começo vira parte do corte
  const last = merged[merged.length - 1];
  if (last && total - last.end < 0.35) last.end = total;
  const first = merged[0];
  if (first && first.start < 0.35) first.start = 0;
  const ops: EditOp[] = [];
  let shift = 0;
  let removed = 0;
  for (const r of merged) {
    if (removed + (r.end - r.start) >= total - 0.5) break; // nunca apaga tudo
    const start = r3(r.start - shift);
    const end = r3(r.end - shift);
    const len = r.end - r.start;
    ops.push({
      op: 'ripple_delete', start, end,
      explain: start < 0.05 ? `Cortando o silêncio do começo (${len.toFixed(1)} s)` : `Cortando a pausa em ${fmt(start)} (${len.toFixed(1)} s)`,
    });
    shift += len;
    removed += len;
  }
  return { ops, removed: r3(removed) };
}

/* ---------- cortes do vídeo-exemplo (diferença entre quadros) ---------- */

/** detecta cortes a partir de diferenças entre quadros consecutivos (0..1) amostrados em `times` */
export function cutsFromDiffs(diffs: number[], times: Seconds[]): Seconds[] {
  if (diffs.length < 3) return [];
  // limiar robusto (mediana + MAD): funciona com poucos OU muitos cortes
  const sorted = [...diffs].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const mad = [...diffs.map((x) => Math.abs(x - med))].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  // teto: em vídeos com cortes muito frequentes a mediana já é um corte
  const th = Math.max(0.06, Math.min(med + 5 * mad, 0.3));
  const cuts: Seconds[] = [];
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] >= th && (!cuts.length || times[i] - cuts[cuts.length - 1] > 0.3)) cuts.push(times[i]);
  }
  return cuts;
}

function aspectOf(w?: number, h?: number): AspectRatio | undefined {
  if (!w || !h) return undefined;
  const r = w / h;
  const opts: [AspectRatio, number][] = [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1], ['4:5', 0.8]];
  return opts.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
}

/** perfil de estilo heurístico a partir dos cortes detectados no exemplo */
/** cor média -> preset de cor do exemplo (heurística local) */
export function colorPresetFromStats(c?: { r: number; g: number; b: number; sat: number; lum: number }): ColorPreset | undefined {
  if (!c) return undefined;
  if (c.sat < 0.07) return 'bw';
  if (c.lum < 0.28) return 'moody';
  if (c.sat > 0.5) return 'vibrant';
  const warm = c.r - c.b;
  if (warm > 0.08) return 'warm';
  if (warm < -0.06) return 'cool';
  if (c.sat < 0.18 && c.lum > 0.35) return 'vintage';
  return undefined;
}

export function styleFromCuts(cuts: Seconds[], duration: Seconds, size: { width?: number; height?: number } = {}, color?: { r: number; g: number; b: number; sat: number; lum: number }): StyleProfile {
  const shots = cuts.length + 1;
  const avg = r3(duration > 0 ? duration / shots : 3);
  const pacing: StyleProfile['pacing'] = avg < 1.2 ? 'very-fast' : avg < 2.5 ? 'fast' : avg < 5 ? 'medium' : 'slow';
  const fast = pacing === 'fast' || pacing === 'very-fast';
  const aspect = aspectOf(size.width, size.height);
  const names = { 'very-fast': 'muito rápido', fast: 'rápido', medium: 'moderado', slow: 'calmo' } as const;
  return {
    summary: `Ritmo ${names[pacing]}: ${shots} tomada${shots > 1 ? 's' : ''} em ${duration.toFixed(0)} s (média de ${avg.toFixed(1)} s por tomada)${aspect ? `, formato ${aspect}` : ''}. Análise local (modo demo).`,
    pacing,
    avgShotLength: avg,
    ...(aspect ? { aspect } : {}),
    transitions: fast ? ['cut', 'zoom-in'] : ['cut', 'crossfade'],
    zoomPunchIns: fast,
    captions: fast ? { present: true, preset: 'bold-pop', maxWords: 2, uppercase: true } : { present: true, preset: 'classic', maxWords: 5 },
    hook: fast ? 'Começa direto na ação, sem introdução' : undefined,
    ...(colorPresetFromStats(color) ? { colorPreset: colorPresetFromStats(color) } : {}),
  };
}

/* ---------- intenção a partir do texto (brief ou chat) ---------- */

const COLOR_WORDS: [RegExp, string, string][] = [
  [/amarel/, '#FFD23F', 'amarela'], [/branc/, '#FFFFFF', 'branca'], [/pret/, '#111111', 'preta'],
  [/vermelh/, '#FF3B30', 'vermelha'], [/verde/, '#2ED573', 'verde'], [/azul/, '#3B82F6', 'azul'],
  [/rosa|pink/, '#FF4FA3', 'rosa'], [/laranja/, '#D9641E', 'laranja'], [/roxa|roxo|lilas/, '#8B5CF6', 'roxa'],
  [/ciano|turquesa/, '#22D3EE', 'ciano'], [/dourad/, '#F5C542', 'dourada'],
];

const PRESET_WORDS: [RegExp, ColorPreset, string][] = [
  [/preto e branco|p&b|p\/b|monocrom/, 'bw', 'em preto e branco'],
  [/cinemat|filme|cinema/, 'cinematic', 'cinematográficas'],
  [/quente|aconchegante|dourado/, 'warm', 'quentes'],
  [/\bfri[oa]s?\b|azulad/, 'cool', 'frias'],
  [/vibrante|saturad|vivas?\b|colorid/, 'vibrant', 'vibrantes'],
  [/vintage|retro|antig|nostalg/, 'vintage', 'vintage'],
  [/sombri|moody|dramatic|escur/, 'moody', 'sombrias'],
];

const TRANSITION_WORDS: [RegExp, TransitionKind, string][] = [
  [/\bgir[oa]r?\b|spin|rodar|rotac/, 'spin', 'de giro'],
  [/cortina|wipe|varr/, 'wipe-left', 'cortina'],
  [/circul|iris|bolinha/, 'circle-open', 'círculo'],
  [/pixel/, 'pixelate', 'pixelada'],
  [/trem(or|id)|shake|balanc/, 'shake', 'tremida'],
  [/rgb|cromatic|aberrac/, 'rgb-split', 'RGB'],
  [/queim|film ?burn|pelicula/, 'film-burn', 'filme queimando'],
  [/desfoc|borr|blur/, 'blur', 'desfoque'],
  [/\bpreto\b|escurec/, 'dip-black', 'fade no preto'],
  [/crossfade|dissolv|cruzad/, 'crossfade', 'dissolver'],
  [/fade|esmaec|suave/, 'fade', 'fade'],
  [/zoom/, 'zoom-in', 'zoom'],
  [/whip|chicote|rapida|swipe/, 'whip', 'chicote'],
  [/glitch|falha|digital/, 'glitch', 'glitch'],
  [/flash|clarao|branco/, 'flash', 'flash'],
  [/desliz|slide|lateral/, 'slide-left', 'deslizar'],
];

export function colorPresetFrom(text: string): { preset: ColorPreset; name: string } | undefined {
  const t = norm(text);
  if (/(sem filtro|tira[r]? (o )?filtro|cor(es)? (normal|original)|remove[r]? (a )?cor)/.test(t)) return { preset: 'none', name: 'originais' };
  for (const [re, preset, name] of PRESET_WORDS) if (re.test(t)) return { preset, name };
  return undefined;
}

export function transitionFrom(text: string): { kind: TransitionKind; name: string } | undefined {
  const t = norm(text);
  for (const [re, kind, name] of TRANSITION_WORDS) if (re.test(t)) return { kind, name };
  return undefined;
}

export interface CaptionLook { style: Partial<CaptionStyle>; name: string }

/** estilo de legenda a partir de palavras ("TikTok", "karaokê", "legenda amarela"...) */
export function captionLookFrom(text: string): CaptionLook | undefined {
  const t = norm(text);
  let look: CaptionLook | undefined;
  if (/tiktok|tik tok|reels|shorts|viral/.test(t))
    look = { name: 'estilo TikTok', style: { preset: 'bold-pop', maxWords: 2, uppercase: true, animation: 'pop', fontWeight: 900, fontSize: 84, highlightColor: '#FFD23F', strokeColor: '#000000', strokeWidth: 8, background: '' } };
  else if (/karaok/.test(t))
    look = { name: 'karaokê', style: { preset: 'karaoke', animation: 'karaoke', maxWords: 4, highlightColor: '#FFD23F', uppercase: false } };
  else if (/neon/.test(t))
    look = { name: 'neon', style: { preset: 'neon', color: '#22D3EE', highlightColor: '#FF4FA3', shadow: true, strokeWidth: 0, maxWords: 3 } };
  else if (/caixa|box|fundo/.test(t) && /legenda/.test(t))
    look = { name: 'com caixa', style: { preset: 'boxed', background: 'rgba(0,0,0,0.72)', strokeWidth: 0, maxWords: 5, uppercase: false, fontSize: 64 } };
  else if (/minimal|discret|simples|clean/.test(t))
    look = { name: 'minimalista', style: { preset: 'minimal', fontSize: 56, fontWeight: 600, strokeWidth: 0, uppercase: false, maxWords: 6, animation: 'fade' } };
  else if (/classic|tradicional/.test(t) && /legenda/.test(t))
    look = { name: 'clássica', style: { preset: 'classic', maxWords: 7, uppercase: false, animation: 'none', fontSize: 60 } };

  // cor explícita da legenda ("legenda amarela", "letra vermelha")
  const m = t.match(/(legenda|letra|texto)s?( [a-z]+){0,3}/);
  if (m) {
    const span = t.slice(m.index!, m.index! + 60);
    const destaque = /destaque|realce/.test(span);
    for (const [re, hex, name] of COLOR_WORDS) {
      if (re.test(span)) {
        look = look ?? { name: '', style: {} };
        if (destaque) look.style.highlightColor = hex;
        else look.style.color = hex;
        look.name = [look.name, destaque ? `destaque ${name}` : name].filter(Boolean).join(', ');
        break;
      }
    }
  }
  return look;
}

export interface BriefIntent {
  dynamic: boolean;
  calm: boolean;
  zoom: boolean;
  cutSilences: boolean;
  captions: boolean;
  color?: { preset: ColorPreset; name: string };
  transition?: { kind: TransitionKind; name: string };
  captionLook?: CaptionLook;
  hook?: string;
  cta?: string;
  aspect?: AspectRatio;
}

/** extrai o título/gancho do brief: texto entre aspas, "título: ..." ou o assunto ("sobre X") */
export function hookFromBrief(brief: string): string | undefined {
  const q = brief.match(/["“”«]([^"“”»]{3,60})["“”»]/);
  if (q) return q[1].trim();
  const labeled = brief.match(/(?:t[ií]tulo|gancho|chamada|frase)\s*[:=-]\s*([^\n.!?;]{3,60})/i);
  if (labeled) return labeled[1].trim();
  const about = brief.match(/\bsobre\s+([^\n.,;!?]{3,60})/i);
  if (about) {
    const cut: string[] = [];
    for (const w of about[1].trim().split(/\s+/)) {
      if (/^(com|usando|para|pra|e)$/i.test(w) && cut.length >= 1) break;
      cut.push(w);
      if (cut.length >= 6) break;
    }
    const out = cut.join(' ').replace(/^(a|o|as|os|um|uma)\s+/i, '');
    if (out.length >= 3) return out.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  }
  return undefined;
}

export function parseBrief(brief: string): BriefIntent {
  const t = norm(brief);
  const dynamic = /dinamic|rapid|agil|energ|tiktok|reels|shorts|viral|frenetic|acelerad|ritmo/.test(t);
  const calm = /calm|tranquil|lent|suave|relax|contemplativ/.test(t);
  let cta: string | undefined;
  if (/link na bio/.test(t)) cta = 'Link na bio';
  else if (/inscrev/.test(t)) cta = 'Inscreva-se!';
  else if (/sig[ae]|seguir|seguidor|cta|chamada para acao/.test(t)) cta = 'Siga para mais!';
  else if (/compr|encomend|pedido|whats/.test(t)) cta = 'Peça já o seu!';
  let aspect: AspectRatio | undefined;
  if (/16:9|horizontal|youtube(?! shorts)/.test(t)) aspect = '16:9';
  else if (/1:1|quadrad/.test(t)) aspect = '1:1';
  else if (/4:5|feed/.test(t)) aspect = '4:5';
  else if (/9:16|vertical|tiktok|reels|shorts|stories/.test(t)) aspect = '9:16';
  return {
    dynamic,
    calm,
    zoom: /zoom|punch/.test(t) || dynamic,
    cutSilences: !/(nao|sem) cort/.test(t),
    captions: !/sem legenda/.test(t),
    color: colorPresetFrom(brief),
    transition: /transi/.test(t) ? transitionFrom(t.slice(t.indexOf('transi'))) ?? transitionFrom(t) : undefined,
    captionLook: captionLookFrom(brief),
    hook: hookFromBrief(brief),
    cta,
    aspect,
  };
}

/* ---------- blocos de edição reutilizáveis ---------- */

export function videoClipsOf(p: Project): VideoClip[] {
  const out: VideoClip[] = [];
  for (const t of p.tracks) if (t.kind === 'video') for (const c of t.clips) if (c.type === 'video') out.push(c);
  return out.sort((a, b) => a.start - b.start);
}

/** keyframes de punch-in: alterna 1.0 / `scale` a cada `period` segundos dentro do clipe */
export function punchKeyframes(duration: Seconds, period = 2.6, scale = 1.12): Keyframe[] {
  const kf: Keyframe[] = [{ t: 0, transform: { scale: 1 } }];
  if (duration < period * 1.5) {
    kf.push({ t: r3(Math.min(0.2, duration / 4)), transform: { scale }, easing: 'easeOut' });
    return kf;
  }
  for (let a = period, i = 1; a < duration - 0.4; a += period, i++) {
    const z = i % 2 === 1 ? scale : 1;
    const prev = i % 2 === 1 ? 1 : scale;
    kf.push({ t: r3(a - 0.001), transform: { scale: prev } });
    kf.push({ t: r3(Math.min(a + 0.18, duration)), transform: { scale: z }, easing: 'easeOut' });
  }
  return kf;
}

/** zoom punch-in: em clipes cortados, alterna enquadramento a cada corte; em clipe único, usa keyframes */
export function zoomOps(p: Project, strong = false, only?: Set<Id>): EditOp[] {
  const clips = videoClipsOf(p).filter((c) => !c.locked && (!only || only.has(c.id)));
  const z = strong ? 1.16 : 1.1;
  if (clips.length >= 3) {
    return clips.map((c, i) => ({
      op: 'update_clip' as const,
      clipId: c.id,
      patch: { transform: { ...c.transform, scale: i % 2 === 1 ? z : 1 }, keyframes: i % 2 === 1 ? [] : [{ t: 0, transform: { scale: 1 } }, { t: r3(c.duration), transform: { scale: 1.04 } }] },
      explain: i % 2 === 1 ? `Punch-in no corte em ${fmt(c.start)}` : `Zoom lento em ${fmt(c.start)}`,
    }));
  }
  return clips.map((c) => ({
    op: 'update_clip' as const,
    clipId: c.id,
    patch: { keyframes: punchKeyframes(c.duration, strong ? 2 : 2.8, z) },
    explain: `Zoom punch-in ritmado no clipe de ${fmt(c.start)}`,
  }));
}

export function removeZoomOps(p: Project, only?: Set<Id>): EditOp[] {
  return videoClipsOf(p)
    .filter((c) => !c.locked && (!only || only.has(c.id)) && (c.keyframes?.length || c.transform.scale !== 1))
    .map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { keyframes: [], transform: { ...c.transform, scale: 1 } }, explain: `Tirando o zoom do clipe de ${fmt(c.start)}` }));
}

export function colorOps(p: Project, preset: ColorPreset, name: string, only?: Set<Id>): EditOp[] {
  return videoClipsOf(p)
    .filter((c) => !c.locked && (!only || only.has(c.id)))
    .map((c, i) => ({ op: 'update_clip' as const, clipId: c.id, patch: { colorPreset: preset }, explain: i === 0 ? `Aplicando cores ${name}` : `Cores ${name} no clipe de ${fmt(c.start)}` }));
}

export function transitionOps(p: Project, kind: TransitionKind | null, name: string, only?: Set<Id>): EditOp[] {
  const clips = videoClipsOf(p).filter((c) => !c.locked);
  return clips.slice(1).filter((c) => !only || only.has(c.id)).map((c) => ({
    op: 'update_clip' as const,
    clipId: c.id,
    patch: kind ? { transitionIn: { kind, duration: kind === 'whip' || kind === 'flash' || kind === 'glitch' ? 0.25 : 0.4 } } : { transitionIn: undefined },
    explain: kind ? `Transição ${name} em ${fmt(c.start)}` : `Corte seco em ${fmt(c.start)}`,
  }));
}

/** muda a velocidade global: vídeo/voz aceleram; textos e legendas acompanham; música mantém */
/** velocidade só nos clipes apontados: muda o clipe e empurra os seguintes da mesma trilha */
export function clipSpeedOps(p: Project, only: Set<Id>, factor: number): EditOp[] {
  const ops: EditOp[] = [];
  for (const t of p.tracks) {
    let shift = 0;
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      if ((c.type === 'video' || c.type === 'audio') && only.has(c.id) && !c.locked) {
        const sp = r3(c.speed * factor);
        const dur = r3(c.duration / factor);
        ops.push({ op: 'update_clip', clipId: c.id, patch: { speed: sp, duration: dur, ...(shift ? { start: r3(c.start + shift) } : {}) }, explain: `Velocidade ${sp}x no clipe de ${fmt(c.start)}` });
        shift += dur - c.duration;
      } else if (shift && !c.locked) {
        ops.push({ op: 'move_clip', clipId: c.id, start: r3(c.start + shift), explain: `Empurrando o clipe de ${fmt(c.start)}` });
      }
    }
  }
  return ops;
}

export function speedOps(p: Project, assets: Record<Id, MediaAsset>, factor: number): EditOp[] {
  const ops: EditOp[] = [];
  const f = factor;
  for (const t of p.tracks) {
    if (t.locked) continue;
    for (const c of t.clips) {
      if (c.locked) continue;
      const isMusic = c.type === 'audio' && assets[c.assetId]?.role === 'music';
      if (c.type === 'video' || (c.type === 'audio' && !isMusic)) {
        ops.push({ op: 'update_clip', clipId: c.id, patch: { speed: r3(c.speed * f), start: r3(c.start / f), duration: r3(c.duration / f) }, explain: `Acelerando ${c.label ? `"${c.label}"` : 'o clipe'} para ${r3(c.speed * f)}x` });
      } else if (c.type === 'text' || c.type === 'image') {
        ops.push({ op: 'update_clip', clipId: c.id, patch: { start: r3(c.start / f), duration: r3(c.duration / f) }, explain: `Reposicionando "${c.type === 'text' ? c.text : 'imagem'}" no novo ritmo` });
      }
    }
  }
  if (p.captions.segments.length) {
    ops.push({
      op: 'set_captions',
      segments: p.captions.segments.map((s) => ({
        ...s, start: r3(s.start / f), end: r3(s.end / f),
        words: s.words?.map((w) => ({ ...w, start: r3(w.start / f), end: r3(w.end / f) })),
      })),
      explain: 'Sincronizando as legendas com a nova velocidade',
    });
  }
  // música: apara no novo fim
  const newEnd = projectDuration(p) / f;
  for (const t of p.tracks) for (const c of t.clips) {
    if (c.type === 'audio' && assets[c.assetId]?.role === 'music' && clipEnd(c) > newEnd + 0.05 && c.start < newEnd - 0.1) {
      ops.push({ op: 'trim_clip', clipId: c.id, end: r3(newEnd), explain: 'Ajustando a música ao novo final' });
    }
  }
  return ops;
}

/** texto de exemplo p/ legendas no modo demo (a partir do brief) */
function demoWordPool(brief: string): string[] {
  const clean = brief.replace(/["“”]/g, '').replace(/[^\p{L}\p{N}\s!?,.]/gu, ' ');
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  return words.length >= 4 ? words : 'Este é um exemplo de legenda automática no modo demonstração do EditorPro'.split(' ');
}

/** legendas de exemplo alinhadas aos trechos de FALA detectados (tempos de timeline) */
export function demoCaptions(p: Project, speechByAsset: Record<Id, Range[]>, brief: string): CaptionSegment[] {
  const pool = demoWordPool(brief);
  let k = 0;
  const media: { assetId: Id; seg: CaptionSegment }[] = [];
  for (const [assetId, ranges] of Object.entries(speechByAsset)) {
    for (const r of ranges) {
      const n = Math.max(1, Math.round((r.end - r.start) / 0.42));
      const words: string[] = [];
      for (let i = 0; i < n; i++) words.push(pool[k++ % pool.length]);
      const seg: CaptionSegment = { id: uid('cap'), start: r.start, end: r.end, text: words.join(' '), words: distributeWords(words.join(' '), r.start, r.end) };
      for (const s of splitSegment(seg, 3.2, 6)) media.push({ assetId, seg: s });
    }
  }
  const out: CaptionSegment[] = [];
  const byAsset = new Map<Id, CaptionSegment[]>();
  for (const m of media) byAsset.set(m.assetId, [...(byAsset.get(m.assetId) ?? []), m.seg]);
  for (const [assetId, segs] of byAsset) out.push(...captionsMediaToTimeline(p, assetId, segs));
  return out.sort((a, b) => a.start - b.start);
}

function hookClip(text: string, start: Seconds, duration: Seconds, label: string, y: number) {
  return {
    id: uid('clip'),
    type: 'text' as const,
    text,
    start: r3(start),
    duration: r3(duration),
    label,
    style: { ...DEFAULT_TEXT_STYLE, fontSize: label === 'gancho' ? 96 : 78, fontWeight: 900, uppercase: true, color: '#FFFFFF', highlightColor: '#FFD23F', strokeWidth: 8 },
    position: { x: 0.5, y },
    animation: 'pop' as const,
  };
}

function textTrackId(p: Project): Id {
  return p.tracks.find((t) => t.kind === 'text' && !t.locked)?.id ?? 'track_text_1';
}

/* ---------- 1ª edição (brief + material + estilo) ---------- */

export interface FirstEditInput {
  project: Project;
  assets: Record<Id, MediaAsset>;
  brief: string;
  /** silêncios por asset, em tempo da MÍDIA (vazio se não deu p/ analisar) */
  silencesByAsset: Record<Id, Range[]>;
  style?: StyleProfile;
}

export function planFirstEdit(input: FirstEditInput): DemoResult {
  const { assets, brief, silencesByAsset, style } = input;
  const intent = parseBrief(brief);
  const fast = intent.dynamic || style?.pacing === 'fast' || style?.pacing === 'very-fast';
  const ops: EditOp[] = [];
  const said: string[] = [];
  let p = input.project;
  const push = (more: EditOp[]) => {
    if (!more.length) return;
    const r = applyOps(p, more);
    p = r.project;
    ops.push(...more);
  };

  // formato pedido (ou do exemplo) se for diferente do atual
  const aspect = intent.aspect ?? style?.aspect;
  if (aspect && aspect !== p.aspect) {
    push([{ op: 'set_aspect', aspect, explain: `Ajustando o formato para ${aspect}` }]);
    said.push(`formato ${aspect}`);
  }

  let exampleCaptions = false; // legendas de exemplo não servem de fonte p/ o gancho
  // 1) legendas de exemplo nos trechos de fala (antes dos cortes: o ripple leva junto)
  const durations: Record<Id, number> = {};
  for (const id of Object.keys(silencesByAsset)) durations[id] = assets[id]?.duration ?? 0;
  if (intent.captions && !p.captions.segments.length) {
    const speech: Record<Id, Range[]> = {};
    for (const [id, sil] of Object.entries(silencesByAsset)) speech[id] = speechRanges(sil, durations[id]);
    const segs = demoCaptions(p, speech, brief);
    if (segs.length) {
      push([{ op: 'set_captions', segments: segs, language: 'pt-BR', explain: `Colocando ${segs.length} legendas de exemplo nos trechos de fala` }]);
      exampleCaptions = true;
      said.push('legendas de exemplo nos trechos de fala');
    }
  }

  // 2) cortar silêncios
  if (intent.cutSilences) {
    const { ops: cut, removed } = silenceCutOps(p, silencesByAsset);
    push(cut);
    if (cut.length) said.push(`cortei ${cut.length} pausa${cut.length > 1 ? 's' : ''} (${removed.toFixed(1)} s a menos)`);
  }

  // 3) estilo de legenda (brief > exemplo > ritmo)
  const look = intent.captionLook
    ?? (style?.captions?.present ? { name: 'do vídeo-exemplo', style: (({ present: _p, ...rest }) => rest)(style.captions) } : undefined)
    ?? (fast ? captionLookFrom('tiktok') : undefined);
  if (look && p.captions.segments.length) {
    push([{ op: 'set_caption_style', style: look.style, explain: `Legenda ${look.name}` }]);
    said.push(`legenda ${look.name}`);
  }

  // 4) gancho/título nos primeiros segundos
  // pedido explícito de título/gancho sem texto citado: tira da fala (frase mais forte) ou usa um padrão
  const wantsHook = /titulo|gancho|chamada|headline|\bhook\b/.test(norm(brief));
  const hook = intent.hook ?? style?.textOverlays?.examples?.[0]
    ?? (wantsHook ? (!exampleCaptions ? hookFromTranscript(p) : undefined) ?? 'Você precisa ver isso!' : undefined);
  if (hook) {
    const d = r3(Math.min(2.5, Math.max(1.2, projectDuration(p) * 0.3)));
    const existing = p.tracks.flatMap((tr) => tr.clips).find((c) => c.type === 'text' && (c.label === 'gancho' || c.templateId === 'hook'));
    if (existing) push([{ op: 'update_clip', clipId: existing.id, patch: { text: hook, start: 0, duration: d, animation: 'pop' }, explain: `Título de gancho: "${hook}"` }]);
    else push([{ op: 'add_clip', trackId: textTrackId(p), clip: { ...hookClip(hook, 0, d, 'gancho', 0.2), templateId: 'hook' }, explain: `Título de gancho: "${hook}"` }]);
    said.push(`título "${hook}"`);
  }

  // 5) zoom punch-in
  if (intent.zoom || style?.zoomPunchIns) {
    const z = zoomOps(p, fast);
    push(z);
    if (z.length) said.push('zoom punch-in');
  }

  // 6) cor
  const color = intent.color ?? (style?.colorPreset && style.colorPreset !== 'none' ? { preset: style.colorPreset, name: 'do exemplo' } : undefined)
    ?? (intent.calm ? { preset: 'warm' as ColorPreset, name: 'quentes' } : undefined);
  if (color) {
    const c = colorOps(p, color.preset, color.name);
    push(c);
    if (c.length) said.push(`cores ${color.name}`);
  }

  // 7) transições entre os cortes
  const styleTr = style?.transitions.find((k) => k !== 'cut');
  const tr = intent.transition ?? (styleTr ? { kind: styleTr, name: 'do exemplo' } : undefined) ?? (intent.calm ? { kind: 'crossfade' as TransitionKind, name: 'suave' } : undefined);
  if (tr && videoClipsOf(p).length > 1) {
    const t = transitionOps(p, tr.kind, tr.name);
    push(t);
    if (t.length) said.push(`transições ${tr.name}`);
  }

  // 8) música de fundo (se o usuário enviou)
  const music = Object.values(assets).find((a) => a.role === 'music' && (a.kind === 'audio' || a.kind === 'video'));
  const hasAudioClip = p.tracks.some((t) => t.clips.some((c) => c.type === 'audio'));
  if (music && !hasAudioClip) {
    const total = projectDuration(p);
    const trackId = p.tracks.find((t) => t.kind === 'audio')?.id ?? 'track_audio_1';
    const dur = r3(Math.min(music.duration || total, total));
    if (dur > 0.5) {
      push([{
        op: 'add_clip', trackId,
        clip: { id: uid('clip'), type: 'audio', assetId: music.id, start: 0, duration: dur, in: 0, speed: 1, volume: 0.25, fadeIn: 0.5, fadeOut: Math.min(1.5, dur / 3), duckUnderVoice: true, label: 'Música' },
        explain: 'Música de fundo baixinha, abaixando quando há fala',
      }]);
      said.push('música de fundo');
    }
  }

  // 9) CTA no final
  if (intent.cta) {
    const total = projectDuration(p);
    if (total > 4) {
      push([{ op: 'add_clip', trackId: textTrackId(p), clip: hookClip(intent.cta, total - 2.2, 2.2, 'CTA', 0.42), explain: `Chamada final: "${intent.cta}"` }]);
      said.push(`CTA "${intent.cta}"`);
    }
  }

  const reply = ops.length
    ? `Pronto! Editei no modo demonstração: ${said.join(', ')}.${said.includes('legendas de exemplo nos trechos de fala') ? ' As legendas são de exemplo (a transcrição foi pulada).' : ''} Me diga o que ajustar (ex.: "legenda maior", "tira o zoom", "corta os primeiros 2 s").`
    : 'Não encontrei nada para editar ainda. Envie o material bruto (vídeo) e descreva o que você quer.';
  return { reply, ops };
}

/* ---------- comandos do chat (modo demo) ---------- */

export interface ChatContext {
  project: Project;
  assets: Record<Id, MediaAsset>;
  /** silêncios por asset (mídia), calculados sob demanda quando `demoNeeds` pede */
  silencesByAsset?: Record<Id, Range[]>;
  /** para onde o usuário apontou (clipe, trecho, ponto, legenda) */
  target?: UIChatContext;
}

/** intervalo citado no texto ("nos primeiros 3 s", "nos últimos 2 s", "de 4 a 9 s") */
export function rangeFromText(t: string, total: number): Range | undefined {
  const n = (x: string) => Number(x.replace(',', '.'));
  let m = t.match(/(?:nos|nas|os|as)\s+primeir[oa]s\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos?)\b/);
  if (m) return { start: 0, end: Math.min(total, n(m[1])) };
  m = t.match(/(?:nos|nas|os|as)\s+ultim[oa]s\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos?)\b/);
  if (m) return { start: Math.max(0, total - n(m[1])), end: total };
  m = t.match(/(?:de|entre)\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg)?\s*(?:a|ate|e)\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos?)\b/);
  if (m && n(m[2]) > n(m[1])) return { start: Math.min(total, n(m[1])), end: Math.min(total, n(m[2])) };
  if (/\bno (comeco|inicio)\b/.test(t)) return { start: 0, end: Math.min(total, 3) };
  if (/\bno (final|fim)\b/.test(t)) return { start: Math.max(0, total - 3), end: total };
  return undefined;
}

const EFFECT_WORDS: [RegExp, VisualEffectKind, string][] = [
  [/\bvhs\b|fita|retro tv/, 'vhs', 'VHS'], [/glitch|falha/, 'glitch', 'glitch'], [/rgb|cromatic/, 'rgb-split', 'RGB split'],
  [/trem(or|ido|ida)|shake|terremoto/, 'shake', 'tremor'], [/zoom puls|pulsa/, 'zoom-pulse', 'pulso'], [/granul|grain/, 'film-grain', 'granulado'],
  [/light leak|vazamento de luz|luz vazando/, 'light-leak', 'light leak'], [/pixel/, 'pixelate', 'pixelado'], [/espelh|mirror/, 'mirror', 'espelho'],
  [/caleidosc/, 'kaleidoscope', 'caleidoscópio'], [/desfoque de movimento|motion blur|borrao/, 'blur-motion', 'desfoque de movimento'],
  [/estrobo|strobe|pisca/, 'flash-strobe', 'estroboscópio'], [/filme antigo|old film|antigo/, 'old-film', 'filme antigo'],
  [/brilh|glow/, 'soft-glow', 'brilho suave'], [/neon/, 'neon-edge', 'neon'], [/barras? (de )?cinema|black bars|letterbox/, 'black-bars', 'barras de cinema'],
  [/sparkle|estrelinha|purpurina/, 'sparkle', 'brilhinhos'],
];

const AUDIO_WORDS: [RegExp, AudioEffectKind, string][] = [
  [/robo/, 'robot', 'voz de robô'], [/esquilo|chipmunk|fininha/, 'chipmunk', 'voz de esquilo'], [/voz grave|voz grossa|monstro/, 'deep', 'voz grave'],
  [/eco\b/, 'echo', 'eco'], [/reverb|catedral|igreja/, 'reverb', 'reverb'], [/telefone/, 'telephone', 'voz de telefone'],
  [/megafone|alto-falante/, 'megaphone', 'megafone'], [/ruido|chiado/, 'noise-reduction', 'redução de ruído'],
  [/realc(a|e) a voz|melhora a voz|voz mais clara|voice enhance/, 'voice-enhance', 'voz realçada'], [/normaliz/, 'normalize', 'volume normalizado'],
  [/grave reforcado|mais grave na musica|bass/, 'bass-boost', 'grave reforçado'],
];

const SPEED_WORDS: [RegExp, SpeedPreset, string][] = [
  [/hero|heroi/, 'hero', 'herói'], [/montagem/, 'montage', 'montagem'], [/bala|bullet/, 'bullet', 'bala'],
  [/jump ?cut/, 'jump-cut', 'jump cut'], [/flash ?in/, 'flash-in', 'flash in'], [/flash ?out/, 'flash-out', 'flash out'],
];

const EMOJI_WORDS: [RegExp, string][] = [
  [/fogo|chama/, '🔥'], [/coraca|amor/, '❤️'], [/risada|rindo|kkk|engracad/, '😂'], [/estrela/, '⭐'], [/joinha|like|positivo/, '👍'],
  [/palma|aplaus/, '👏'], [/dinheiro|grana/, '💰'], [/alerta|atencao|cuidado/, '⚠️'], [/olho/, '👀'], [/foguete/, '🚀'], [/\b100\b|cem/, '💯'],
  [/raio/, '⚡'], [/check|certo/, '✅'], [/festa|comemora/, '🎉'], [/susto|choque|chocad/, '😱'], [/pensando|duvida/, '🤔'], [/brilho/, '✨'],
];

/** o comando precisa de análise de áudio antes? */
/**
 * Limiar do corte de silêncio a partir do pedido:
 * "pausas maiores que 1 s" / "acima de 0,8 segundo" -> minSilence; "agressivo/todas/até as curtas" -> 0.3 s;
 * "só as longas/leve/suave" -> 1.0 s; "sem respiro/colado" -> pad menor.
 */
export function silenceOptsFromText(text: string): SilenceOptions | undefined {
  const t = norm(text);
  const out: SilenceOptions = {};
  const m = t.match(/(?:maior(?:es)?|acima|mais|mais longas?|passar(?:em)?|longas?) (?:de |que |do que )?(\d+(?:[.,]\d+)?)\s*(s\b|seg|segundos?|ms|milissegundos?)/)
    ?? t.match(/(\d+(?:[.,]\d+)?)\s*(s\b|seg|segundos?|ms) (?:ou mais|pra cima|para cima)/);
  if (m) {
    const v = parseFloat(m[1].replace(',', '.')) / (/^ms|^mili/.test(m[2]) ? 1000 : 1);
    if (v > 0) out.minSilence = Math.max(0.15, Math.min(5, v));
  } else if (/agressiv|toda(s)? (as )?pausa|ate as (pequenas|curtas)|bem colad|maximo|tudo que (for|e) pausa/.test(t)) out.minSilence = 0.3;
  else if (/so (as )?(pausas? )?(longas|grandes)|leve|suave|so o (que|tempo) morto|pausas? (longas|grandes)/.test(t)) out.minSilence = 1;
  if (/sem respiro|colad|bem justo|apertad/.test(t)) out.pad = 0.05;
  else if (/natural|com respiro|respira/.test(t)) out.pad = 0.2;
  return Object.keys(out).length ? out : undefined;
}

export function demoNeeds(text: string): { silences: boolean } {
  const t = norm(text);
  return { silences: /silenc|pausa|respiro|enrola|tempo morto|parte(s)? parada|dinamic|ritmo/.test(t) || /legenda/.test(t) && /(gera|coloca|adiciona|cria|faz)/.test(t) };
}

function parseNumber(s: string): number | undefined {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const HELP = 'No modo demonstração eu entendo comandos como: "legenda estilo creator", "lower third com meu nome Ana", "whoosh nas transições", "look cinema", "CTA siga no final", "legenda maior/menor/amarela/em cima", "legendas estilo TikTok", "legenda karaokê", "cortar silêncios", "cortar vícios", "melhores momentos em 30 s", "tira o zoom", "corta os primeiros 3 s", "acelera 1.2x", "câmera lenta", "curva herói", "coloca efeito VHS nos primeiros 3 s", "transição de giro", "voz de robô", "remove o fundo", "adiciona emoji de fogo", "sincroniza na batida", "marca as batidas", "cria capítulos", "gancho com zoom e flash", "música mais baixa", "deixa preto e branco", "formato 16:9" e "deixar mais dinâmico".';

export function chatIntent(text: string, ctx: ChatContext): DemoResult {
  const t = norm(text);
  const only = ctx.target?.clipIds?.length ? new Set(ctx.target.clipIds) : undefined;
  const { assets } = ctx;
  let p = ctx.project;
  const ops: EditOp[] = [];
  const said: string[] = [];
  const push = (more: EditOp[], phrase?: string) => {
    if (!more.length) return;
    p = applyOps(p, more).project;
    ops.push(...more);
    if (phrase) said.push(phrase);
  };
  const hasCaps = p.captions.segments.length > 0;
  const mentionsCaption = /legenda|letra/.test(t);
  const negate = /\b(tira|tirar|remove|remover|sem|desliga|esconde|para de|apaga|nao quero)\b/;

  if (/^(desfaz|desfazer|volta|voltar|undo)\b|desfaz (isso|a ultima)/.test(t)) return { reply: 'Desfiz a última edição.', ops: [], undo: true };

  // --- biblioteca profissional: estilos de legenda, looks, modelos (lower third, CTA) e efeitos sonoros
  const libRange = ctx.target?.range ?? (ctx.target?.point ? { start: ctx.target.point.t, end: ctx.target.point.t + 2 } : undefined);
  const lib = demoLibraryOps(text, p, libRange);
  push(lib.ops);
  said.push(...lib.said);
  const macros = lib.macros as unknown as EditOp[];

  // --- legendas: liga/desliga
  if (mentionsCaption && negate.test(t) && !/(maior|menor|cor|zoom)/.test(t)) {
    push([{ op: 'toggle_captions', enabled: false, explain: 'Escondendo as legendas' }], 'escondi as legendas');
  } else if (mentionsCaption && /(coloca|liga|mostra|ativa|volta|gera|adiciona|cria|quero)/.test(t) && !/(maior|menor|estilo|cor\b)/.test(t)) {
    if (hasCaps && !p.captions.enabled) push([{ op: 'toggle_captions', enabled: true, explain: 'Mostrando as legendas' }], 'liguei as legendas');
    else if (!hasCaps && ctx.silencesByAsset) {
      const speech: Record<Id, Range[]> = {};
      for (const [id, sil] of Object.entries(ctx.silencesByAsset)) speech[id] = speechRanges(sil, assets[id]?.duration ?? 0);
      const segs = demoCaptions(p, speech, p.brief);
      if (segs.length) push([{ op: 'set_captions', segments: segs, language: 'pt-BR', explain: `Gerando ${segs.length} legendas de exemplo` }], 'gerei legendas de exemplo (modo demo)');
    }
  }

  // --- legendas: tamanho / estilo / cor / posição
  if ((mentionsCaption || /tiktok|karaok|neon/.test(t)) && !lib.handled.captionPreset) {
    const st = p.captions.style;
    const style: Partial<CaptionStyle> = {};
    const parts: string[] = [];
    if (/(maior|aumenta|grande|grandona)/.test(t)) { style.fontSize = Math.min(200, Math.round(st.fontSize * 1.25)); parts.push('maior'); }
    else if (/(menor|diminui|pequen|menorzinha)/.test(t)) { style.fontSize = Math.max(28, Math.round(st.fontSize * 0.8)); parts.push('menor'); }
    if (/(em cima|no topo|pra cima|para cima|no alto|topo)/.test(t)) { style.position = { ...st.position, y: 0.18 }; parts.push('em cima'); }
    else if (/(no meio|centro|central)/.test(t)) { style.position = { ...st.position, y: 0.5 }; parts.push('no meio'); }
    else if (/(embaixo|em baixo|pra baixo|para baixo|rodape)/.test(t)) { style.position = { ...st.position, y: 0.8 }; parts.push('embaixo'); }
    const look = captionLookFrom(text);
    if (look) { Object.assign(style, look.style); parts.push(look.name); }
    if (/(mais palavras|frase inteira)/.test(t)) { style.maxWords = Math.min(8, st.maxWords + 2); parts.push('com mais palavras'); }
    if (/(menos palavras|uma palavra|palavra por palavra)/.test(t)) { style.maxWords = /uma palavra|palavra por palavra/.test(t) ? 1 : Math.max(1, st.maxWords - 1); parts.push('com menos palavras'); }
    if (/maiuscul|caixa alta/.test(t)) { style.uppercase = !negate.test(t); parts.push(style.uppercase ? 'em maiúsculas' : 'sem maiúsculas'); }
    if (Object.keys(style).length) {
      if (!hasCaps) said.push('ajustei o estilo (as legendas aparecem assim que forem geradas)');
      push([{ op: 'set_caption_style', style, explain: `Legenda ${parts.join(', ')}` }], `legenda ${parts.join(', ')}`);
      if (!p.captions.enabled && hasCaps) push([{ op: 'toggle_captions', enabled: true, explain: 'Mostrando as legendas' }]);
    }
  }

  // --- zoom
  if (/zoom|punch/.test(t) && !/transi/.test(t)) {
    if (negate.test(t)) push(removeZoomOps(p, only), 'tirei o zoom');
    else push(zoomOps(p, /(forte|mais zoom|bastante)/.test(t), only), 'coloquei zoom punch-in');
  }

  // --- cortar começo/fim
  const firstN = t.match(/(?:corta|cortar|tira|tirar|remove|remover|apaga|apagar)\s+(?:os|as)?\s*primeir[oa]s?\s*(\d+(?:[.,]\d+)?)?\s*(s|seg|segundos?)?/);
  const lastN = t.match(/(?:corta|cortar|tira|tirar|remove|remover|apaga|apagar)\s+(?:os|as)?\s*ultim[oa]s?\s*(\d+(?:[.,]\d+)?)?\s*(s|seg|segundos?)?/);
  let total = projectDuration(p);
  if (firstN || /(corta|cortar|tira|tirar) (o )?(comeco|inicio)/.test(t)) {
    const n = Math.min(firstN?.[1] ? parseNumber(firstN[1]) ?? 1 : 1, Math.max(0, total - 0.5));
    if (n > 0.04) push([{ op: 'ripple_delete', start: 0, end: r3(n), explain: `Cortando os primeiros ${n} s` }], `cortei os primeiros ${n} s`);
  }
  if (lastN || /(corta|cortar|tira|tirar) (o )?(final|fim)/.test(t)) {
    const tt = projectDuration(p);
    const n = Math.min(lastN?.[1] ? parseNumber(lastN[1]) ?? 1 : 1, Math.max(0, tt - 0.5));
    if (n > 0.04) push([{ op: 'ripple_delete', start: r3(tt - n), end: r3(tt), explain: `Cortando os últimos ${n} s` }], `cortei os últimos ${n} s`);
  }

  // --- silêncios
  if (/silenc|pausa|respiro|tempo morto|enrolac/.test(t) && !negate.test(t.replace(/tira(r)? (os |as )?(silenc|pausa)/, ''))) {
    if (ctx.silencesByAsset) {
      const { ops: cut, removed } = silenceCutOps(p, ctx.silencesByAsset);
      if (cut.length) push(cut, `cortei ${cut.length} pausa${cut.length > 1 ? 's' : ''} (${removed.toFixed(1)} s)`);
      else said.push('não encontrei pausas para cortar');
    }
  }

  // --- velocidade
  const sp = t.match(/(\d+(?:[.,]\d+)?)\s*x\b/);
  const speedCurve = /curva|heroi|hero\b|montagem|\bbala\b|bullet|flash ?in|flash ?out|jump ?cut/.test(t) && /(curva|velocidade|acelera|efeito|deixa|coloca|aplica)/.test(t);
  if (speedCurve) {
    // tratado abaixo (curvas de velocidade estilo CapCut)
  } else if (/camera lenta|slow ?motion|camera lentinha/.test(t)) {
    push(only ? clipSpeedOps(p, only, 0.5) : speedOps(p, assets, 0.5), only ? 'câmera lenta (0.5x) no clipe apontado' : 'deixei em câmera lenta (0.5x)');
  } else if (/(acelera|mais rapido|velocidade|speed)/.test(t) || (sp && /(acelera|velocidade|deixa)/.test(t))) {
    let f = sp ? parseNumber(sp[1]) ?? 1.2 : 1.2;
    if (f > 3 || f < 0.25) f = 1.2;
    // "velocidade 1.5x" = absoluta em relação ao clipe principal
    const main = videoClipsOf(p)[0];
    const factor = sp && main ? f / (main.speed || 1) : f;
    if (Math.abs(factor - 1) > 0.01) push(only ? clipSpeedOps(p, only, factor) : speedOps(p, assets, factor), `acelerei para ${f}x`);
  } else if (/(desacelera|mais devagar|mais lento|camera lenta|slow)/.test(t)) {
    push(only ? clipSpeedOps(p, only, 0.85) : speedOps(p, assets, 0.85), 'deixei mais devagar (0.85x)');
  }

  // --- música
  if (/musica|trilha|som de fundo/.test(t)) {
    const music = p.tracks.flatMap((tr) => tr.clips).filter((c) => c.type === 'audio' && (assets[c.assetId]?.role === 'music' || true));
    if (!music.length) said.push('não há música na timeline — envie uma trilha pelo clipe de anexo');
    else if (/(tira|remove|sem|apaga)/.test(t)) push(music.map((c) => ({ op: 'remove_clip' as const, clipId: c.id, explain: 'Removendo a música' })), 'tirei a música');
    else {
      const down = /(baix|abaix|diminu|menos|suave)/.test(t);
      const up = /(alta|aument|mais alto|mais forte)/.test(t);
      if (down || up) push(music.filter((c) => c.type === 'audio').map((c) => ({
        op: 'update_clip' as const, clipId: c.id,
        patch: { volume: r3(Math.max(0, Math.min(2, (c.type === 'audio' ? c.volume : 1) * (down ? 0.6 : 1.4)))) },
        explain: down ? 'Abaixando a música' : 'Aumentando a música',
      })), down ? 'abaixei a música' : 'aumentei a música');
    }
  }

  // --- voz
  if (/\bvoz\b|\baudio do video\b/.test(t) && /(alta|aument|baix|diminu)/.test(t)) {
    const up = /(alta|aument)/.test(t);
    push(videoClipsOf(p).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { volume: r3(Math.max(0, Math.min(2, c.volume * (up ? 1.3 : 0.75)))) }, explain: up ? 'Aumentando a voz' : 'Abaixando a voz' })), up ? 'aumentei a voz' : 'abaixei a voz');
  }

  // --- transições ("whoosh nas transições" é só som)
  if (/transi/.test(t) && !lib.handled.sfx) {
    if (/(sem transi|corte seco|tira(r)? (as |a )?transi|remove(r)? (as |a )?transi)/.test(t)) push(transitionOps(p, null, ''), 'deixei cortes secos');
    else {
      let tr = transitionFrom(t.slice(t.indexOf('transi')));
      if (!tr) {
        const cur = videoClipsOf(p)[1]?.transitionIn?.kind;
        const cycle: TransitionKind[] = ['crossfade', 'zoom-in', 'whip', 'fade', 'slide-left', 'flash'];
        const kind = cycle[(cycle.indexOf(cur ?? 'cut') + 1) % cycle.length];
        const names: Partial<Record<TransitionKind, string>> = { crossfade: 'dissolver', 'zoom-in': 'zoom', whip: 'chicote', fade: 'fade', 'slide-left': 'deslizar', flash: 'flash' };
        tr = { kind, name: names[kind] ?? kind };
      }
      const ops2 = transitionOps(p, tr.kind, tr.name, only);
      if (ops2.length) push(ops2, `transições ${tr.name}`);
      else said.push('só há um clipe — transições aparecem entre cortes (experimente "cortar silêncios")');
    }
  }

  // --- cor (sem confundir com cor da legenda)
  const colorText = mentionsCaption ? t.replace(/(legenda|letra|texto)s?( [a-z]+){0,3}/, '') : t;
  const preset = colorPresetFrom(colorText);
  if (preset && !/transi|efeito/.test(t) && !lib.handled.look && !lib.handled.template) push(colorOps(p, preset.preset, preset.name, only), preset.preset === 'none' ? 'voltei as cores originais' : `cores ${preset.name}`);

  // --- título
  if (/gancho/.test(t) && p.captions.segments.length && !negate.test(t)) {
    const hook = hookFromBrief(text) ?? hookFromTranscript(p) ?? hookFromBrief(p.brief) ?? 'Assista até o final!';
    push(hookOps(p, hook), `gancho "${hook}" com zoom e flash`);
  } else if (/(titulo|gancho|chamada|texto na tela|texto no inicio)/.test(t) && !mentionsCaption && !lib.handled.template) {
    const hook = hookFromBrief(text) ?? hookFromBrief(p.brief) ?? 'Assista até o final!';
    const existing = p.tracks.flatMap((tr) => tr.clips).find((c) => c.type === 'text' && c.label === 'gancho');
    if (negate.test(t) && existing) push([{ op: 'remove_clip', clipId: existing.id, explain: 'Removendo o título' }], 'tirei o título');
    else if (existing && existing.type === 'text') push([{ op: 'update_clip', clipId: existing.id, patch: { text: hook }, explain: `Trocando o título para "${hook}"` }], `título "${hook}"`);
    else {
      const d = Math.min(3, Math.max(1.2, projectDuration(p) * 0.3));
      push([{ op: 'add_clip', trackId: textTrackId(p), clip: hookClip(hook, 0, d, 'gancho', 0.2), explain: `Título de gancho: "${hook}"` }], `título "${hook}"`);
    }
  }

  // --- formato
  const asp = t.match(/\b(9:16|16:9|1:1|4:5)\b/);
  const aspect: AspectRatio | undefined = asp ? (asp[1] as AspectRatio) : /formato .*(horizontal|youtube)|deixa horizontal/.test(t) ? '16:9' : /formato .*vertical|deixa vertical/.test(t) ? '9:16' : /quadrad/.test(t) ? '1:1' : undefined;
  if (aspect && aspect !== p.aspect) push([{ op: 'set_aspect', aspect, explain: `Mudando para ${aspect}` }], `formato ${aspect}`);

  // ===== estilo CapCut =====
  total = projectDuration(p);
  const point = ctx.target?.point;
  const rawRange = rangeFromText(t, total) ?? ctx.target?.range;
  // trecho de duração ~zero (comentário num instante) vira uma janela curta em volta do ponto
  const range = rawRange && rawRange.end - rawRange.start < 0.3 ? { start: Math.max(0, rawRange.start - 0.5), end: Math.min(total, rawRange.start + 1.5) } : rawRange;
  const visual = (c: Clip) => (c.type === 'video' || c.type === 'image') && !c.locked && (!only || only.has(c.id));
  const visuals = () => p.tracks.flatMap((tr) => tr.clips).filter(visual);
  const fxTrack = () => p.tracks.find((tr) => tr.kind === 'effect' && !tr.locked)?.id ?? 'track_effect_1';
  const ovTrack = () => p.tracks.find((tr) => tr.kind === 'overlay' && !tr.locked)?.id ?? 'track_overlay_1';

  // --- efeitos visuais (num trecho -> camada de ajuste; senão nos clipes)
  if (/efeito|filtro/.test(t) || EFFECT_WORDS.some(([re]) => re.test(t) && /(coloca|poe|bota|adiciona|aplica|quero|deixa|com)/.test(t))) {
    if (negate.test(t) && /efeito/.test(t)) {
      const adj = p.tracks.flatMap((tr) => tr.clips).filter((c) => c.type === 'adjustment' && (c.effects?.length ?? 0) > 0);
      push([
        ...adj.map((c) => ({ op: 'remove_clip' as const, clipId: c.id, explain: 'Removendo a camada de efeito' })),
        ...visuals().filter((c) => ((c as VideoClip).effects?.length ?? 0) > 0).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { effects: [] }, explain: `Tirando os efeitos do clipe de ${fmt(c.start)}` })),
      ], 'tirei os efeitos');
    } else {
      const found = EFFECT_WORDS.filter(([re]) => re.test(t)).slice(0, 3);
      const intensity = /(forte|bastante|muito)/.test(t) ? 0.85 : /(leve|suave|pouco)/.test(t) ? 0.35 : 0.6;
      if (found.length) {
        const effects = found.map(([, kind]) => ({ kind, intensity }));
        const names = found.map(([, , name]) => name).join(' + ');
        const r = range ?? (point ? { start: Math.max(0, point.t - 1), end: Math.min(total, point.t + 1) } : undefined);
        if (r && r.end - r.start > 0.1) {
          push([{ op: 'add_clip', trackId: fxTrack(), clip: { id: uid('clip'), type: 'adjustment', start: r3(r.start), duration: r3(r.end - r.start), filters: [], effects }, explain: `Efeito ${names} de ${fmt(r.start)} a ${fmt(r.end)}` }], `efeito ${names} de ${fmt(r.start)} a ${fmt(r.end)}`);
        } else {
          push(visuals().map((c, i) => {
            const prev = ((c as VideoClip).effects ?? []).filter((e) => !effects.some((n) => n.kind === e.kind));
            return { op: 'update_clip' as const, clipId: c.id, patch: { effects: [...prev, ...effects].slice(0, 4) }, explain: i === 0 ? `Efeito ${names}` : `Efeito ${names} no clipe de ${fmt(c.start)}` };
          }), `efeito ${names}`);
        }
      }
    }
  }

  // --- curvas de velocidade / reverso
  if (speedCurve) {
    const sw = SPEED_WORDS.find(([re]) => re.test(t));
    if (sw) push(p.tracks.flatMap((tr) => tr.clips).filter((c): c is VideoClip => c.type === 'video' && !c.locked && (!only || only.has(c.id))).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { speedPreset: sw[1] }, explain: `Curva de velocidade ${sw[2]} no clipe de ${fmt(c.start)}` })), `curva de velocidade ${sw[2]}`);
  }
  if (/ao contrario|reverso|reverse|de tras pra frente|rebobina/.test(t)) {
    const rev = !negate.test(t);
    push(p.tracks.flatMap((tr) => tr.clips).filter((c): c is VideoClip => c.type === 'video' && !c.locked && (!only || only.has(c.id))).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { reverse: rev }, explain: rev ? `Invertendo o clipe de ${fmt(c.start)}` : 'Voltando ao normal' })), rev ? 'deixei ao contrário' : 'tirei o reverso');
  }

  // --- efeitos de voz / tom
  const aw = AUDIO_WORDS.filter(([re]) => re.test(t));
  if (aw.length && (/voz|audio|som|ruido|chiado|eco|reverb|normaliz|grave/.test(t))) {
    const voiceClips = p.tracks.flatMap((tr) => tr.clips).filter((c): c is VideoClip | AudioClip => (c.type === 'video' || (c.type === 'audio' && assets[c.assetId]?.role !== 'music')) && !c.locked && (!only || only.has(c.id)));
    if (negate.test(t)) push(voiceClips.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { audioEffects: [], pitch: 0 }, explain: 'Voz ao natural' })), 'voz ao natural');
    else push(voiceClips.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { audioEffects: [...(c.audioEffects ?? []).filter((e) => !aw.some(([, k]) => k === e.kind)), ...aw.map(([, kind]) => ({ kind, amount: 0.8 }))].slice(0, 4) }, explain: `${aw.map(([, , n]) => n).join(' + ')} no clipe de ${fmt(c.start)}` })), aw.map(([, , n]) => n).join(' + '));
  } else if (/\btom\b|pitch/.test(t) && /(agud|grav|alto|baixo|sobe|desce)/.test(t)) {
    const up = /(agud|alto|sobe)/.test(t);
    push(videoClipsOf(p).filter((c) => !only || only.has(c.id)).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { pitch: Math.max(-12, Math.min(12, (c.pitch ?? 0) + (up ? 3 : -3))) }, explain: up ? 'Subindo o tom da voz' : 'Descendo o tom da voz' })), up ? 'tom mais agudo' : 'tom mais grave');
  }

  // --- remover fundo / chroma key / espelhar / fundo da tela
  if (/(remove|tira|recorta|apaga)r? (o )?fundo|sem fundo|remove background/.test(t)) {
    push(visuals().map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { removeBackground: true }, explain: `Recortando a pessoa do fundo em ${fmt(c.start)}` })), 'removi o fundo');
  } else if (/fundo (verde|azul)|chroma|tela verde|green ?screen/.test(t)) {
    const colorHex = /azul/.test(t) ? '#0047FF' : '#00FF00';
    push(visuals().map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: negate.test(t) ? { chromaKey: null } : { chromaKey: { color: colorHex, similarity: 0.4, smoothness: 0.1 } }, explain: negate.test(t) ? 'Tirando o chroma key' : `Chroma key no clipe de ${fmt(c.start)}` })), negate.test(t) ? 'tirei o chroma key' : 'chroma key ligado');
  }
  if (/espelh(a|ar|e)|inverte (a )?imagem|flip/.test(t) && !/efeito/.test(t)) {
    push(visuals().map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { flipH: !(c as VideoClip).flipH }, explain: `Espelhando o clipe de ${fmt(c.start)}` })), 'espelhei a imagem');
  }
  if (/fundo (desfocado|borrado)|tela de fundo/.test(t)) {
    push([{ op: 'set_project', patch: { canvas: { type: 'blur', blur: 0.6 } }, explain: 'Fundo desfocado atrás do vídeo' }], 'fundo desfocado');
  }

  // --- emoji / sticker / forma
  const em = EMOJI_WORDS.find(([re]) => re.test(t));
  if (em && /(emoji|sticker|figurinha|adiciona|coloca|poe|bota)/.test(t) && !negate.test(t)) {
    const seg = ctx.target?.segmentId ? p.captions.segments.find((s) => s.id === ctx.target!.segmentId) : undefined;
    const at = point?.t ?? seg?.start ?? range?.start ?? Math.min(0.5, total / 4);
    const dur = Math.max(0.8, Math.min(2.5, seg ? seg.end - seg.start : range ? range.end - range.start : 2));
    const tf = point ? { x: r3(point.x - 0.5), y: r3(point.y - 0.5) } : { x: 0.3, y: -0.3 };
    push([{ op: 'add_clip', trackId: ovTrack(), clip: { id: uid('clip'), type: 'sticker', emoji: em[1], start: r3(at), duration: r3(dur), transform: { ...DEFAULT_TRANSFORM, scale: 0.3, ...tf }, animationIn: { kind: 'pop', duration: 0.3 }, animationLoop: { kind: 'bounce', duration: 0.8 } }, explain: `Emoji ${em[1]} em ${fmt(at)}` }], `emoji ${em[1]}`);
  } else if (/(seta|circulo|retangulo|estrela|balao)/.test(t) && /(adiciona|coloca|poe|desenha)/.test(t) && !/emoji/.test(t)) {
    const shape = /seta/.test(t) ? 'arrow' : /circulo/.test(t) ? 'circle' : /estrela/.test(t) ? 'star' : /balao/.test(t) ? 'speech-bubble' : 'rounded-rect';
    const at = point?.t ?? range?.start ?? 0;
    const tf = point ? { x: r3(point.x - 0.5), y: r3(point.y - 0.5) } : { x: 0, y: 0 };
    push([{ op: 'add_clip', trackId: ovTrack(), clip: { id: uid('clip'), type: 'shape', shape, fill: '#D9641E', start: r3(at), duration: 2.5, transform: { ...DEFAULT_TRANSFORM, scale: 0.25, ...tf }, animationIn: { kind: 'pop', duration: 0.3 } }, explain: `Forma (${shape}) em ${fmt(at)}` }], 'forma adicionada');
  }

  // --- animações de entrada/saída
  const anim = t.match(/anima(c|ç)(ao|oes) de (entrada|saida)/);
  if (anim) {
    const kindWord: [RegExp, ClipAnimation][] = [[/zoom/, 'zoom-in'], [/desliz|slide/, 'slide-up'], [/gir/, 'spin'], [/pul|bounce/, 'bounce'], [/pop/, 'pop'], [/fade|suave/, 'fade'], [/trem/, 'shake']];
    const kind = kindWord.find(([re]) => re.test(t))?.[1] ?? 'fade';
    const key = anim[3] === 'entrada' ? 'animationIn' : 'animationOut';
    push(visuals().map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { [key]: { kind, duration: 0.4 } }, explain: `Animação de ${anim[3]} (${kind}) em ${fmt(c.start)}` })), `animação de ${anim[3]}`);
  }

  // --- vícios de linguagem (palavras do Whisper)
  if (/vicio|\bne\b.*\btipo\b|muleta|hesita|\bhum+\b|\behh?\b|\btipo\b.*\bne\b/.test(t)) {
    if (!p.captions.segments.some((s) => s.words?.some((w) => w.id))) said.push('preciso das legendas com as palavras primeiro — gere as legendas e peça de novo');
    else {
      const { ops: f, count } = fillerOps(p);
      if (f.length) push(f, `cortei ${count} vício${count > 1 ? 's' : ''} de linguagem`);
      else said.push('não encontrei vícios de linguagem');
    }
  }

  // --- destaques
  const hl = t.match(/(destaque|melhores (partes|momentos|trechos)|resumo|highlight)/);
  if (hl) {
    const sec = Number((t.match(/(\d+)\s*(s|seg|segundos)\b/) ?? [])[1]) || (/(\d+)\s*min/.test(t) ? Number(t.match(/(\d+)\s*min/)![1]) * 60 : 30);
    if (!p.captions.segments.length) said.push('preciso das legendas para achar os melhores trechos — gere as legendas primeiro');
    else {
      const h = highlightOps(p, sec);
      if (h.ops.length) push(h.ops, `deixei só os melhores momentos (${h.kept.toFixed(0)} s)`);
      else said.push(`o vídeo já tem menos de ${sec} s`);
    }
  }

  // --- batidas
  if (/batida|ritmo da musica|\bbeat/.test(t)) {
    const beats = timelineBeats(p, assets);
    if (!beats.length) said.push('não achei batidas: coloque uma música (com batidas detectadas) na timeline');
    else if (/(marca|mostra|marcador)/.test(t)) push(beatMarkerOps(p, assets), `marquei ${beats.length} batidas`);
    else {
      const b = beatSyncOps(p, assets, /(rapid|frenet|toda batida)/.test(t) ? 0.45 : 0.8);
      if (b.ops.length) push(b.ops, `sincronizei ${b.cuts} cortes com a batida`);
      else said.push('as batidas não caem dentro do vídeo');
    }
  }

  // --- capítulos
  if (/capitulo|chapter|secoes|partes do video/.test(t)) {
    if (!p.captions.segments.length) said.push('preciso das legendas para dividir em capítulos');
    else {
      const old = (p.markers ?? []).filter((m) => m.kind === 'chapter').map((m) => ({ op: 'remove_marker' as const, markerId: m.id, explain: 'Trocando os capítulos' }));
      const ch = chapterOps(p, Number((t.match(/(\d+)\s*capitulo/) ?? [])[1]) || undefined);
      push([...old, ...ch], `marquei ${ch.length} capítulos`);
    }
  }

  // --- tradução (precisa do Claude)
  if (/tradu[zc]|traduc|em ingles|em espanhol|para o ingles|to english/.test(t) && /legenda/.test(t)) {
    said.push('traduzir legendas precisa da IA (Claude) — configure a ANTHROPIC_API_KEY no servidor');
  }

  // --- mais dinâmico (combo)
  if (/dinamic|mais energia|mais ritmo|mais rapido e|prender (a )?atencao/.test(t) && !ops.some((o) => o.op === 'ripple_delete')) {
    if (ctx.silencesByAsset) {
      const tight: Record<Id, Range[]> = ctx.silencesByAsset;
      const { ops: cut, removed } = silenceCutOps(p, tight);
      if (cut.length) push(cut, `cortei ${cut.length} pausas (${removed.toFixed(1)} s)`);
    }
    if (!ops.some((o) => o.op === 'update_clip' && 'keyframes' in (o.patch ?? {}))) push(zoomOps(p, true), 'zoom punch-in');
    if (p.captions.segments.length) push([{ op: 'set_caption_style', style: captionLookFrom('tiktok')!.style, explain: 'Legendas rápidas estilo TikTok' }], 'legendas rápidas');
  }

  if (!ops.length && !said.length) return { reply: `Não entendi esse pedido no modo demonstração. ${HELP}`, ops: [] };
  const msg = said.length ? said.join(', ') : 'pronto';
  const all = [...ops, ...macros];
  return { reply: all.length ? `Feito: ${msg}.` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`, ops: all };
}

export { HELP as DEMO_HELP };
