/* =====================================================================
   Recursos de IA "estilo CapCut" — funções PURAS (testadas), usadas no
   modo demo e também com o Claude quando o resultado é determinístico:
   - cortar vícios de linguagem (né/tipo/é/hum…) ancorado nas palavras (remove_words)
   - destaques automáticos (melhores trechos pela transcrição até N s)
   - sincronizar cortes na batida (asset.beats da música) e marcar batidas
   - capítulos como marcadores; gancho a partir da fala
   - auto-reframe: keyframes de x seguindo o assunto
   ===================================================================== */
import type { CaptionSegment, CaptionWord, Clip, Id, Keyframe, MediaAsset, Project, Seconds, VideoClip } from '../types';
import { ASPECT_SIZES } from '../types';
import { allWords, applyOps, clipEnd, projectDuration, type EditOp } from '../ops';
import { DEFAULT_TEXT_STYLE } from '../defaults';
import { formatTime } from '../util';
import { r3 } from './sanitize';

const fmt = (t: number) => formatTime(t, { decimals: true });
const normWord = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** ids estáveis e sequenciais nas palavras ("w00001"...) */
export function assignWordIds(segs: CaptionSegment[]): CaptionSegment[] {
  let n = 0;
  return segs.map((s) => ({
    ...s,
    words: s.words?.map((w) => ({ ...w, id: `w${String(++n).padStart(5, '0')}` })),
  }));
}

/* ---------- vícios de linguagem ---------- */

const ALWAYS = /^(ne|hum+|hm+|uhm+|uh+|ah+|aham|ahn|uhn|han|ha+|hein|eh+|ehh+|ee+|aa+h*|ehn)$/;

/** a palavra é um vício (com contexto: "é" e "tipo" só quando soltos/alongados) */
export function isFiller(words: CaptionWord[], i: number): boolean {
  const w = words[i];
  const n = normWord(w.text);
  if (!n) return false;
  const dur = w.end - w.start;
  const gapBefore = i > 0 ? w.start - words[i - 1].end : 1;
  const gapAfter = i < words.length - 1 ? words[i + 1].start - w.end : 1;
  const comma = /[,…]$/.test(w.text.trim()) || /\.\.\.$/.test(w.text.trim());
  if (n === 'e' && /^[ée]{2,}|^é[.…]/i.test(w.text.trim())) return true; // "éé", "é..."
  if (ALWAYS.test(n) && n !== 'e') return true;
  if (n === 'e') return (dur >= 0.3 && (gapBefore > 0.15 || gapAfter > 0.15)) || (comma && dur >= 0.2);
  if (n === 'tipo') {
    const next = words[i + 1] ? normWord(words[i + 1].text) : '';
    return comma || gapAfter > 0.2 || next === 'assim';
  }
  if (n === 'assim' && i > 0 && normWord(words[i - 1].text) === 'tipo') return true;
  return false;
}

/** ops remove_words para cada sequência de vícios (do fim para o começo: ids não mudam, tempos também não) */
export function fillerOps(p: Project): { ops: EditOp[]; count: number } {
  const words = allWords(p).filter((w) => w.id);
  const runs: { from: CaptionWord; to: CaptionWord; text: string[] }[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!isFiller(words, i)) continue;
    const last = runs[runs.length - 1];
    if (last && words[i - 1] === last.to) { last.to = words[i]; last.text.push(words[i].text); }
    else runs.push({ from: words[i], to: words[i], text: [words[i].text] });
  }
  const ops: EditOp[] = runs.reverse().map((r) => ({
    op: 'remove_words', fromWordId: r.from.id!, toWordId: r.to.id!, padding: 0.03,
    explain: `Cortando "${r.text.join(' ').replace(/[,.…]+$/, '')}" em ${fmt(r.from.start)}`,
  }));
  return { ops, count: runs.reduce((n, r) => n + r.text.length, 0) };
}

/* ---------- destaques automáticos ---------- */

function segScore(s: CaptionSegment, i: number, total: number, keywords: Set<string>): number {
  const dur = Math.max(0.3, s.end - s.start);
  const words = s.words?.length ?? s.text.split(/\s+/).length;
  let score = Math.min(4, words / dur) * 0.5; // fala densa
  if (/[!?]/.test(s.text)) score += 1;
  score += (s.emphasis?.length ?? 0) * 0.5;
  const toks = s.text.split(/\s+/).map(normWord);
  score += toks.filter((t) => t.length > 3 && keywords.has(t)).length * 0.8;
  if (/\d/.test(s.text)) score += 0.4; // números/listas prendem atenção
  if (i === 0) score += 0.6; // começo costuma apresentar o assunto
  if (i === total - 1) score += 0.3;
  const fillers = toks.filter((t) => ALWAYS.test(t) || t === 'tipo').length;
  score -= fillers * 0.6;
  return score;
}

/** mantém os melhores trechos (pela transcrição) até ~maxSec e corta o resto */
export function highlightOps(p: Project, maxSec: number): { ops: EditOp[]; kept: number; removed: number } {
  const segs = p.captions.segments;
  const total = projectDuration(p);
  if (!segs.length || total <= maxSec + 0.5) return { ops: [], kept: total, removed: 0 };
  const keywords = new Set(p.brief.split(/\s+/).map(normWord).filter((t) => t.length > 3));
  const ranked = segs.map((s, i) => ({ s, score: segScore(s, i, segs.length, keywords) })).sort((a, b) => b.score - a.score);
  const chosen: CaptionSegment[] = [];
  let acc = 0;
  for (const { s } of ranked) {
    const d = s.end - s.start;
    if (acc + d > maxSec * 1.1 && chosen.length) continue;
    chosen.push(s);
    acc += d;
    if (acc >= maxSec) break;
  }
  chosen.sort((a, b) => a.start - b.start);
  // intervalos a manter (com respiro de 0,12 s), unindo vizinhos próximos
  const keep: { start: number; end: number }[] = [];
  for (const s of chosen) {
    const a = Math.max(0, s.start - 0.12), b = Math.min(total, s.end + 0.12);
    const last = keep[keep.length - 1];
    if (last && a - last.end < 0.4) last.end = Math.max(last.end, b);
    else keep.push({ start: a, end: b });
  }
  // cortes = complemento, do fim para o começo
  const cuts: { start: number; end: number }[] = [];
  let t = 0;
  for (const k of keep) { if (k.start - t > 0.05) cuts.push({ start: t, end: k.start }); t = k.end; }
  if (total - t > 0.05) cuts.push({ start: t, end: total });
  const ops: EditOp[] = cuts.reverse().map((c) => ({ op: 'ripple_delete', start: r3(c.start), end: r3(c.end), explain: `Tirando o trecho fraco ${fmt(c.start)}–${fmt(c.end)}` }));
  const removed = cuts.reduce((n, c) => n + c.end - c.start, 0);
  return { ops, kept: r3(total - removed), removed: r3(removed) };
}

/* ---------- batidas ---------- */

/** batidas da música na TIMELINE (pela trilha de áudio com asset.beats) */
export function timelineBeats(p: Project, assets: Record<Id, MediaAsset>): Seconds[] {
  const out: Seconds[] = [];
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.type !== 'audio' && c.type !== 'video') continue;
      const beats = assets[c.assetId]?.beats;
      if (!beats?.length || (c.type === 'video' && assets[c.assetId]?.role !== 'music')) continue;
      const sp = c.speed > 0 ? c.speed : 1;
      for (const b of beats) {
        const tt = c.start + (b - c.in) / sp;
        if (tt > c.start + 0.05 && tt < clipEnd(c) - 0.05) out.push(r3(tt));
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** espaça batidas para no mínimo `minGap` s */
export function thinBeats(beats: Seconds[], minGap: number): Seconds[] {
  const out: Seconds[] = [];
  for (const b of beats) if (!out.length || b - out[out.length - 1] >= minGap - 1e-6) out.push(b);
  return out;
}

export function beatMarkerOps(p: Project, assets: Record<Id, MediaAsset>): EditOp[] {
  const beats = timelineBeats(p, assets).slice(0, 300);
  const existing = new Set((p.markers ?? []).filter((m) => m.kind === 'beat').map((m) => m.t.toFixed(2)));
  return beats
    .filter((b) => !existing.has(b.toFixed(2)))
    .map((b, i) => ({ op: 'add_marker' as const, marker: { id: `beat_${Math.round(b * 1000)}`, t: b, kind: 'beat' as const, color: '#E0A32E' }, explain: i === 0 ? 'Marcando as batidas da música' : `Batida em ${fmt(b)}` }));
}

function mainVideoClips(p: Project): VideoClip[] {
  const t = p.tracks.find((x) => x.kind === 'video' && !x.locked);
  return (t?.clips.filter((c): c is VideoClip => c.type === 'video' && !c.locked) ?? []).sort((a, b) => a.start - b.start);
}

/** corta o vídeo principal nas batidas (com zoom alternado e flash a cada 4 cortes) */
export function beatSyncOps(p: Project, assets: Record<Id, MediaAsset>, minGap = 0.8): { ops: EditOp[]; cuts: number } {
  const beats = thinBeats(timelineBeats(p, assets), minGap).slice(0, 60);
  if (!beats.length) return { ops: [], cuts: 0 };
  const ops: EditOp[] = [];
  const pieces: { id: Id; start: number }[] = [];
  for (const c of mainVideoClips(p)) {
    let curId = c.id;
    pieces.push({ id: c.id, start: c.start });
    for (const b of beats) {
      if (b <= c.start + 0.3 || b >= clipEnd(c) - 0.3) continue;
      const newId = `${c.id}_b${Math.round(b * 1000)}`;
      ops.push({ op: 'split_clip', clipId: curId, at: b, newId, explain: `Corte na batida em ${fmt(b)}` });
      pieces.push({ id: newId, start: b });
      curId = newId;
    }
  }
  const cuts = ops.length;
  // zoom alternado (jump cut) e flash nas batidas fortes
  const sim = applyOps(p, ops).project;
  const byId = new Map<Id, Clip>();
  for (const t of sim.tracks) for (const c of t.clips) byId.set(c.id, c);
  pieces.sort((a, b) => a.start - b.start).forEach((pc, i) => {
    const c = byId.get(pc.id);
    if (!c || c.type !== 'video' || i === 0) return;
    ops.push({
      op: 'update_clip', clipId: pc.id,
      patch: { transform: { ...c.transform, scale: i % 2 ? 1.12 : 1 }, ...(i % 4 === 0 ? { transitionIn: { kind: 'flash', duration: 0.15 } } : {}) },
      explain: i % 4 === 0 ? `Flash na batida forte em ${fmt(pc.start)}` : `Zoom no corte em ${fmt(pc.start)}`,
    });
  });
  return { ops, cuts };
}

/* ---------- capítulos e gancho ---------- */

/** capítulos (marcadores kind 'chapter') nas maiores pausas da fala */
export function chapterOps(p: Project, count?: number): EditOp[] {
  const segs = p.captions.segments;
  const total = projectDuration(p);
  if (segs.length < 2) return [];
  const n = Math.max(2, Math.min(8, count ?? Math.round(total / 30)));
  // candidatos: início de cada segmento, pontuados pela pausa antes dele
  const cand = segs.slice(1).map((s, i) => ({ s, gap: s.start - segs[i].end }));
  const minSpacing = total / (n * 1.6);
  const starts: CaptionSegment[] = [segs[0]];
  for (const c of [...cand].sort((a, b) => b.gap - a.gap)) {
    if (starts.length >= n) break;
    if (starts.every((x) => Math.abs(x.start - c.s.start) >= minSpacing)) starts.push(c.s);
  }
  starts.sort((a, b) => a.start - b.start);
  return starts.map((s, i) => {
    const label = s.text.split(/\s+/).slice(0, 5).join(' ').replace(/[,.;:!?…]+$/, '');
    return { op: 'add_marker' as const, marker: { id: `chap_${i + 1}`, t: r3(i === 0 ? 0 : s.start), kind: 'chapter' as const, label: `${i + 1}. ${label}`, color: '#D9641E' }, explain: `Capítulo ${i + 1}: "${label}"` };
  });
}

/** frase de gancho a partir da fala: a mais forte entre os primeiros 70% (curta) */
export function hookFromTranscript(p: Project): string | undefined {
  const segs = p.captions.segments;
  if (!segs.length) return undefined;
  const total = projectDuration(p);
  const keywords = new Set(p.brief.split(/\s+/).map(normWord).filter((t) => t.length > 3));
  const pool = segs.filter((s) => s.start <= total * 0.7 && s.text.split(/\s+/).length >= 3);
  const best = (pool.length ? pool : segs).map((s, i) => ({ s, sc: segScore(s, i, segs.length, keywords) })).sort((a, b) => b.sc - a.sc)[0]?.s;
  if (!best) return undefined;
  return best.text.split(/\s+/).slice(0, 7).join(' ').replace(/[,;:…]+$/, '');
}

/** gancho: título forte + zoom rápido + flash nos primeiros segundos */
export function hookOps(p: Project, text: string): EditOp[] {
  const trackId = p.tracks.find((t) => t.kind === 'text' && !t.locked)?.id ?? 'track_text_1';
  const fxTrack = p.tracks.find((t) => t.kind === 'effect' && !t.locked)?.id ?? 'track_effect_1';
  const d = Math.min(2.8, Math.max(1.2, projectDuration(p) * 0.3));
  const ops: EditOp[] = [
    {
      op: 'add_clip', trackId,
      clip: {
        id: 'hook_title', type: 'text', text, start: 0, duration: r3(d), label: 'gancho', position: { x: 0.5, y: 0.22 }, animation: 'pop', animationOut: 'fade',
        style: { ...DEFAULT_TEXT_STYLE, fontSize: 96, fontWeight: 900, uppercase: true, color: '#FFFFFF', highlightColor: '#FFD23F', strokeWidth: 8 },
      },
      explain: `Gancho: "${text}"`,
    },
    { op: 'add_clip', trackId: fxTrack, clip: { id: 'hook_flash', type: 'adjustment', start: 0, duration: 0.35, filters: [], effects: [{ kind: 'flash-strobe', intensity: 0.8 }] }, explain: 'Flash de abertura' },
  ];
  const first = mainVideoClips(p)[0];
  if (first) ops.push({ op: 'update_clip', clipId: first.id, patch: { keyframes: [{ t: 0, transform: { scale: 1.25 } }, { t: 0.5, transform: { scale: 1 }, easing: 'easeOut' }] }, explain: 'Zoom rápido de abertura' });
  return ops.filter((o) => !(o.op === 'add_clip' && (p.tracks.some((t) => t.clips.some((c) => c.id === o.clip.id)))));
}

/* ---------- auto-reframe ---------- */

/**
 * transform.x (fração da LARGURA do quadro de saída; engine: cx = W/2 + x*W) que centraliza o assunto
 * em `sx` (0..1 da largura da mídia), com encaixe "cover" e escala `scale`.
 */
export function reframeX(sx: number, srcAspect: number, outAspect: number, scale = 1): number {
  // largura desenhada / largura do quadro (cover: altura preenche quando a mídia é mais larga)
  const wd = (srcAspect >= outAspect ? srcAspect / outAspect : 1) * scale;
  const maxShift = Math.max(0, (wd - 1) / 2);
  const x = wd * (0.5 - sx);
  return r3(Math.max(-maxShift, Math.min(maxShift, x)));
}

/** suaviza a trajetória do assunto (média móvel + zona morta p/ não "tremer") */
export function smoothTrack(points: { t: number; x: number }[], window = 2, deadZone = 0.04): { t: number; x: number }[] {
  const sm = points.map((p, i) => {
    const sl = points.slice(Math.max(0, i - window), i + window + 1);
    return { t: p.t, x: sl.reduce((n, q) => n + q.x, 0) / sl.length };
  });
  const out: { t: number; x: number }[] = [];
  for (const p of sm) if (!out.length || Math.abs(p.x - out[out.length - 1].x) >= deadZone) out.push(p);
  return out;
}

/** keyframes de reenquadramento p/ um clipe a partir de pontos (t na MÍDIA, x do assunto 0..1) */
export function reframeKeyframes(clip: VideoClip, subject: { t: number; x: number }[], srcAspect: number, outAspect: number): Keyframe[] {
  const sp = clip.speed > 0 ? clip.speed : 1;
  const pts = smoothTrack(subject.filter((s) => s.t >= clip.in - 0.5 && s.t <= clip.in + clip.duration * sp + 0.5));
  const kf: Keyframe[] = pts
    .map((s) => ({ t: r3(Math.max(0, Math.min(clip.duration, (s.t - clip.in) / sp))), transform: { x: reframeX(s.x, srcAspect, outAspect, clip.transform.scale) }, easing: 'easeInOut' as const }))
    .filter((k, i, a) => i === 0 || k.t - a[i - 1].t > 0.2);
  return kf.length ? kf : [{ t: 0, transform: { x: 0 } }];
}

export function reframeOps(p: Project, assets: Record<Id, MediaAsset>, subjects: Record<Id, { t: number; x: number }[]>, clipIds?: Id[]): EditOp[] {
  const outAspect = ASPECT_SIZES[p.aspect].width / ASPECT_SIZES[p.aspect].height;
  const ops: EditOp[] = [];
  for (const t of p.tracks) for (const c of t.clips) {
    if (c.type !== 'video' || c.locked || (clipIds && !clipIds.includes(c.id))) continue;
    const a = assets[c.assetId];
    const sub = subjects[c.assetId];
    if (!a?.width || !a.height || !sub?.length) continue;
    const src = a.width / a.height;
    if (src <= outAspect + 0.01) continue; // mídia não é mais larga: nada a reenquadrar
    ops.push({ op: 'update_clip', clipId: c.id, patch: { fit: 'cover', keyframes: reframeKeyframes(c, sub, src, outAspect) }, explain: `Reenquadrando ${c.label ? `"${c.label}"` : 'o clipe'} para ${p.aspect} seguindo o assunto` });
  }
  return ops;
}

/* ---------- detecção de batidas (fallback quando a música não traz asset.beats) ---------- */

/**
 * batidas por fluxo de energia: envelope RMS (janelas de ~23 ms), diferença positiva,
 * limiar adaptativo (média móvel) e picos com intervalo mínimo. Tempos em segundos da mídia.
 */
export function detectBeats(samples: Float32Array, sampleRate: number, minInterval = 0.28): Seconds[] {
  const hop = Math.max(1, Math.round(sampleRate * 0.0232));
  const env: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += samples[k] * samples[k];
    env.push(Math.sqrt(s / hop));
  }
  if (env.length < 8) return [];
  const flux = env.map((v, i) => (i === 0 ? 0 : Math.max(0, v - env[i - 1])));
  const W = Math.round(0.5 / 0.0232); // ~0,5 s de janela
  const out: Seconds[] = [];
  const maxF = Math.max(...flux);
  if (maxF <= 1e-6) return [];
  for (let i = 1; i < flux.length - 1; i++) {
    const a = Math.max(0, i - W), b = Math.min(flux.length, i + W);
    let mean = 0;
    for (let k = a; k < b; k++) mean += flux[k];
    mean /= b - a;
    const isPeak = flux[i] >= flux[i - 1] && flux[i] > flux[i + 1];
    if (isPeak && flux[i] > mean * 1.6 && flux[i] > maxF * 0.12) {
      const t = (i * hop) / sampleRate;
      if (!out.length || t - out[out.length - 1] >= minInterval) out.push(r3(t));
    }
  }
  return out;
}
