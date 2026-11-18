/* =====================================================================
   MODO DEMO (sem chave de IA): planejador heurístico local.
   Tudo aqui é PURO (testado em vitest). A parte que depende do navegador
   (decodificar áudio, amostrar quadros) fica em analysis.ts.
   Sempre devolve EditOp[] com `explain` em PT-BR.
   ===================================================================== */
import type {
  AspectRatio, CaptionSegment, CaptionStyle, ColorPreset, Id, Keyframe, MediaAsset, Project, Seconds, StyleProfile,
  TransitionKind, VideoClip,
} from '../types';
import { applyOps, clipEnd, projectDuration, type EditOp } from '../ops';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { formatTime, uid } from '../util';
import { distributeWords, r3, splitSegment } from './sanitize';
import { captionsMediaToTimeline, clipsOfAsset, mediaRangeToTimeline, mergeRanges } from './timemap';

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
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
  const th = Math.max(0.18, mean + 2.2 * sd);
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
export function styleFromCuts(cuts: Seconds[], duration: Seconds, size: { width?: number; height?: number } = {}): StyleProfile {
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
export function zoomOps(p: Project, strong = false): EditOp[] {
  const clips = videoClipsOf(p).filter((c) => !c.locked);
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

export function removeZoomOps(p: Project): EditOp[] {
  return videoClipsOf(p)
    .filter((c) => !c.locked && (c.keyframes?.length || c.transform.scale !== 1))
    .map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { keyframes: [], transform: { ...c.transform, scale: 1 } }, explain: `Tirando o zoom do clipe de ${fmt(c.start)}` }));
}

export function colorOps(p: Project, preset: ColorPreset, name: string): EditOp[] {
  return videoClipsOf(p)
    .filter((c) => !c.locked)
    .map((c, i) => ({ op: 'update_clip' as const, clipId: c.id, patch: { colorPreset: preset }, explain: i === 0 ? `Aplicando cores ${name}` : `Cores ${name} no clipe de ${fmt(c.start)}` }));
}

export function transitionOps(p: Project, kind: TransitionKind | null, name: string): EditOp[] {
  const clips = videoClipsOf(p).filter((c) => !c.locked);
  return clips.slice(1).map((c) => ({
    op: 'update_clip' as const,
    clipId: c.id,
    patch: kind ? { transitionIn: { kind, duration: kind === 'whip' || kind === 'flash' || kind === 'glitch' ? 0.25 : 0.4 } } : { transitionIn: undefined },
    explain: kind ? `Transição ${name} em ${fmt(c.start)}` : `Corte seco em ${fmt(c.start)}`,
  }));
}

/** muda a velocidade global: vídeo/voz aceleram; textos e legendas acompanham; música mantém */
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

  // 1) legendas de exemplo nos trechos de fala (antes dos cortes: o ripple leva junto)
  const durations: Record<Id, number> = {};
  for (const id of Object.keys(silencesByAsset)) durations[id] = assets[id]?.duration ?? 0;
  if (intent.captions && !p.captions.segments.length) {
    const speech: Record<Id, Range[]> = {};
    for (const [id, sil] of Object.entries(silencesByAsset)) speech[id] = speechRanges(sil, durations[id]);
    const segs = demoCaptions(p, speech, brief);
    if (segs.length) {
      push([{ op: 'set_captions', segments: segs, language: 'pt-BR', explain: `Colocando ${segs.length} legendas de exemplo nos trechos de fala` }]);
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
  const hook = intent.hook ?? style?.textOverlays?.examples?.[0];
  if (hook) {
    const d = Math.min(3, Math.max(1.2, projectDuration(p) * 0.3));
    push([{ op: 'add_clip', trackId: textTrackId(p), clip: hookClip(hook, 0, d, 'gancho', 0.2), explain: `Título de gancho: "${hook}"` }]);
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
    ? `Pronto! Editei no modo demonstração: ${said.join(', ')}. As legendas são de exemplo — conecte o Gemini para transcrição real. Me diga o que ajustar (ex.: "legenda maior", "tira o zoom", "corta os primeiros 2 s").`
    : 'Não encontrei nada para editar ainda. Envie o material bruto (vídeo) e descreva o que você quer.';
  return { reply, ops };
}

/* ---------- comandos do chat (modo demo) ---------- */

export interface ChatContext {
  project: Project;
  assets: Record<Id, MediaAsset>;
  /** silêncios por asset (mídia), calculados sob demanda quando `demoNeeds` pede */
  silencesByAsset?: Record<Id, Range[]>;
}

/** o comando precisa de análise de áudio antes? */
export function demoNeeds(text: string): { silences: boolean } {
  const t = norm(text);
  return { silences: /silenc|pausa|respiro|enrola|tempo morto|parte(s)? parada|dinamic|ritmo/.test(t) || /legenda/.test(t) && /(gera|coloca|adiciona|cria|faz)/.test(t) };
}

function parseNumber(s: string): number | undefined {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const HELP = 'No modo demonstração eu entendo comandos como: "legenda maior/menor", "legenda amarela", "legenda em cima", "legendas estilo TikTok", "tira o zoom", "coloca zoom", "corta os primeiros 3 s", "corta os últimos 2 s", "cortar silêncios", "acelera 1.2x", "música mais baixa", "troca a transição para fade", "deixa preto e branco", "cores cinematográficas", "adicionar título “Seu texto”", "formato 16:9" e "deixar mais dinâmico".';

export function chatIntent(text: string, ctx: ChatContext): DemoResult {
  const t = norm(text);
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
  if (mentionsCaption || /tiktok|karaok|neon/.test(t)) {
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
    if (negate.test(t)) push(removeZoomOps(p), 'tirei o zoom');
    else push(zoomOps(p, /(forte|mais zoom|bastante)/.test(t)), 'coloquei zoom punch-in');
  }

  // --- cortar começo/fim
  const firstN = t.match(/(?:corta|cortar|tira|tirar|remove|remover|apaga|apagar)\s+(?:os|as)?\s*primeir[oa]s?\s*(\d+(?:[.,]\d+)?)?\s*(s|seg|segundos?)?/);
  const lastN = t.match(/(?:corta|cortar|tira|tirar|remove|remover|apaga|apagar)\s+(?:os|as)?\s*ultim[oa]s?\s*(\d+(?:[.,]\d+)?)?\s*(s|seg|segundos?)?/);
  const total = projectDuration(p);
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
  if (/(acelera|mais rapido|velocidade|speed)/.test(t) || (sp && /(acelera|velocidade|deixa)/.test(t))) {
    let f = sp ? parseNumber(sp[1]) ?? 1.2 : 1.2;
    if (f > 3 || f < 0.25) f = 1.2;
    // "velocidade 1.5x" = absoluta em relação ao clipe principal
    const main = videoClipsOf(p)[0];
    const factor = sp && main ? f / (main.speed || 1) : f;
    if (Math.abs(factor - 1) > 0.01) push(speedOps(p, assets, factor), `acelerei para ${f}x`);
  } else if (/(desacelera|mais devagar|mais lento|camera lenta|slow)/.test(t)) {
    push(speedOps(p, assets, 0.85), 'deixei mais devagar (0.85x)');
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

  // --- transições
  if (/transi/.test(t)) {
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
      const ops2 = transitionOps(p, tr.kind, tr.name);
      if (ops2.length) push(ops2, `transições ${tr.name}`);
      else said.push('só há um clipe — transições aparecem entre cortes (experimente "cortar silêncios")');
    }
  }

  // --- cor (sem confundir com cor da legenda)
  const colorText = mentionsCaption ? t.replace(/(legenda|letra|texto)s?( [a-z]+){0,3}/, '') : t;
  const preset = colorPresetFrom(colorText);
  if (preset && !/transi/.test(t)) push(colorOps(p, preset.preset, preset.name), preset.preset === 'none' ? 'voltei as cores originais' : `cores ${preset.name}`);

  // --- título
  if (/(titulo|gancho|chamada|texto na tela|texto no inicio)/.test(t) && !mentionsCaption) {
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
  return { reply: ops.length ? `Feito: ${msg}.` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`, ops };
}

export { HELP as DEMO_HELP };
