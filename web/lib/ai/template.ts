/* =====================================================================
   Vídeo modelo como MOLDE DEFINITIVO (puro, testado):
   - rhythmSplitOps: corta o material no ritmo das tomadas do modelo, sempre
     num respiro entre palavras (nunca no meio de uma palavra)
   - motionKeyframes / shotMotionOps: o movimento de câmera de cada tomada
     (aproximação lenta suave por padrão; pancada só se o modelo/pedido tiver)
   - templateOps: réplica estrita do modelo medido (ritmo, movimento, transições,
     legenda), usada pelo planejador demo e pelo "reedite seguindo o modelo"
   ===================================================================== */
import type { CaptionStyle, Easing, Id, Keyframe, MotionMode, Project, ReferenceTemplate, Seconds, StyleProfile, TransitionKind, VideoClip } from '../types';
import { allWords, applyOps, type EditOp } from '../ops';
import { kfWithout, mergeKfProps } from './features';
import { isObj, r3, sanitizeStyleMotion, smoothKeyframes } from './sanitize';
import { uid } from '../util';

/** limites do movimento "suave" (padrão): zoom ≥0,6 s e no máx. 8% por tomada */
export const MIN_ZOOM_RAMP = 0.6;
export const MAX_SMOOTH_SCALE_DELTA = 0.08;
/** deslocamento máximo da borda por quadro (30 fps, 1080 de largura) no movimento suave */
export const MAX_EDGE_PX_PER_FRAME = 8;
/** aproximação padrão por tomada quando o modelo não diz quanto */
export const DEFAULT_PUSH = 1.06;

const fmt = (t: number) => `${t.toFixed(1).replace('.', ',')} s`;

function mainClips(p: Project): VideoClip[] {
  const track = p.tracks.find((t) => t.kind === 'video');
  if (!track) return [];
  return track.clips.filter((c): c is VideoClip => c.type === 'video').sort((a, b) => a.start - b.start);
}

/* ---------- ritmo: onde cortar ---------- */

/** respiros entre palavras (timeline): meio do vão + tamanho do vão. Sem palavras: [] */
export function wordGaps(p: Project): { t: Seconds; gap: Seconds }[] {
  const words = allWords(p).filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const out: { t: Seconds; gap: Seconds }[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    out.push({ t: r3(words[i - 1].end + Math.max(0, gap) / 2), gap: Math.max(0, gap) });
  }
  return out;
}

/** a palavra que contém `t` (para nunca cortar no meio dela) */
function wordAt(p: Project, t: Seconds) {
  return allWords(p).find((w) => t > w.start + 0.02 && t < w.end - 0.02);
}

/**
 * Pontos de corte no ritmo do modelo: percorre o vídeo pedindo a próxima duração de `lengths`
 * (em ciclo) e encaixa cada corte no respiro entre palavras mais perto do alvo (vãos maiores
 * ganham preferência). Sem palavras, corta no alvo. Devolve tempos de timeline.
 */
export function rhythmCutTimes(p: Project, lengths: Seconds[], opts: { start: Seconds; end: Seconds; maxCuts?: number }): Seconds[] {
  const lens = lengths.filter((x) => x > 0.2);
  if (!lens.length) return [];
  const gaps = wordGaps(p);
  const maxCuts = opts.maxCuts ?? 60;
  const out: Seconds[] = [];
  let t = opts.start;
  for (let i = 0; out.length < maxCuts; i++) {
    const want = lens[i % lens.length];
    const target = t + want;
    if (opts.end - target < want * 0.6) break;
    const lo = t + want * 0.6, hi = Math.min(opts.end - 0.3, t + want * 1.45);
    let best: number | undefined;
    let bestCost = Infinity;
    for (const g of gaps) {
      if (g.t < lo || g.t > hi) continue;
      // distância relativa ao alvo, com bônus para respiros longos (pausa natural)
      const cost = Math.abs(g.t - target) / want - Math.min(0.35, g.gap * 1.2);
      if (cost < bestCost) { bestCost = cost; best = g.t; }
    }
    let at = best ?? target;
    if (best === undefined) {
      const w = wordAt(p, at);
      if (w) at = w.end - at < at - w.start ? w.end : w.start; // fora da palavra
      if (at <= t + 0.3) at = target;
    }
    if (at >= opts.end - 0.3) break;
    out.push(r3(at));
    t = at;
  }
  return out;
}

/** split_clip na trilha principal nos cortes de `rhythmCutTimes` (só clipes longos o bastante) */
export function rhythmSplitOps(p: Project, lengths: Seconds[], maxCuts = 60): EditOp[] {
  const ops: EditOp[] = [];
  let budget = maxCuts;
  const min = Math.min(...lengths.filter((x) => x > 0.2), Infinity);
  if (!Number.isFinite(min)) return ops;
  for (const c of mainClips(p)) {
    if (c.locked || c.duration < min * 1.5 || budget <= 0) continue;
    const cuts = rhythmCutTimes(p, lengths, { start: c.start, end: c.start + c.duration, maxCuts: budget });
    let cur = c.id;
    for (const at of cuts) {
      const newId = uid('clip');
      ops.push({ op: 'split_clip', clipId: cur, at, newId, explain: `Corte no ritmo do modelo em ${fmt(at)}` } as EditOp);
      cur = newId;
      budget--;
    }
  }
  return ops;
}

/* ---------- movimento ---------- */

/** maior variação de escala segura para uma rampa de `dur` s com `easing` (borda ≤ 8 px/quadro a 30 fps/1080) */
export function maxSafeDelta(dur: Seconds, easing: Easing = 'easeInOut', fps = 30, width = 1080, px = MAX_EDGE_PX_PER_FRAME): number {
  // velocidade de pico / média: cúbicas easeIn/easeOut/easeInOut = 3×, linear = 1×
  const peak = easing === 'linear' ? 1 : 3;
  return (px * fps * dur) / ((width / 2) * peak);
}

export interface MotionSpec {
  mode: MotionMode;
  /** escala alvo no fim da tomada (1.06 = aproxima 6%; <1 afasta) */
  zoom: number;
  easing: Easing;
  direction: 'in' | 'out' | 'alternate';
  /** só modo punch: pancadas por tomada (0..1 = fração das tomadas) */
  punchFrequency?: number;
  /** só modo punch: intervalo médio entre pancadas DENTRO de uma tomada (s), medido no modelo */
  punchEvery?: number;
}

/** movimento a usar: o MEDIDO no modelo; sem medição, aproximação lenta suave (padrão) */
export function motionSpecOf(style?: StyleProfile, wantsPunch = false): MotionSpec {
  if (wantsPunch) return { mode: 'punch', zoom: 1.12, easing: 'easeOut', direction: 'alternate', punchFrequency: 1 };
  const tm = style?.template?.motion;
  if (tm) {
    const punches = tm.perShot.reduce((n, s) => n + s.punches, 0);
    const span = tm.perShot.filter((s) => s.punches > 0).reduce((n, s) => n + (s.end - s.start), 0);
    return {
      ...(punches > 1 && span > 0 ? { punchEvery: Math.max(0.5, span / punches) } : {}),
      mode: tm.mode,
      zoom: tm.avgZoomPerShot,
      easing: tm.easing === 'linear' ? 'easeInOut' : tm.easing,
      direction: tm.direction ?? (tm.mode === 'push-pull' ? 'alternate' : tm.avgZoomPerShot < 1 ? 'out' : 'in'),
      ...(tm.punchFrequency !== undefined ? { punchFrequency: tm.punchFrequency } : {}),
    };
  }
  const m = style?.motion;
  if (m) {
    return {
      mode: m.kind,
      zoom: m.zoomPerShot ?? DEFAULT_PUSH,
      easing: m.easing && m.easing !== 'linear' ? m.easing : 'easeInOut',
      direction: m.kind === 'push-pull' ? 'alternate' : (m.zoomPerShot ?? DEFAULT_PUSH) < 1 ? 'out' : 'in',
    };
  }
  return { mode: 'push-pull', zoom: DEFAULT_PUSH, easing: 'easeInOut', direction: 'alternate' };
}

/** o modo pede movimento? (parado = não mexe na câmera) */
export function hasMotion(spec: MotionSpec): boolean {
  if (spec.mode === 'static' || spec.mode === 'handheld') return false;
  return spec.mode === 'punch' || spec.mode === 'pan' || Math.abs(spec.zoom - 1) > 0.008;
}

/**
 * Keyframes de UMA tomada (tempo relativo ao clipe). `i` = índice da tomada (alternância).
 * - smooth-push/push-pull/mixed: rampa contínua 1 → zoom (ou zoom → 1) na tomada inteira, com easing,
 *   e deriva lateral de ±1% (só enquanto há zoom, para não mostrar borda)
 * - pan: deriva lateral com zoom leve
 * - punch: pancada (≥1.12 em <0,25 s) no começo da tomada e volta suave
 */
export function motionKeyframes(dur: Seconds, spec: MotionSpec, i: number): Keyframe[] {
  if (dur <= 0.05 || !hasMotion(spec)) return [];
  const end = r3(dur);
  if (spec.mode === 'punch') {
    const freq = spec.punchFrequency ?? 1;
    // pancada em ~freq das tomadas (determinístico pelo índice)
    if (Math.floor((i + 1) * freq) === Math.floor(i * freq)) return [{ t: 0, transform: { scale: 1 } }];
    const z = Math.max(1.12, Math.min(1.25, spec.zoom > 1.1 ? spec.zoom : 1.12));
    // várias pancadas por tomada (como no modelo): alterna 1 ↔ z a cada `punchEvery` s, rampa de 0,18 s
    if (spec.punchEvery && dur >= spec.punchEvery * 1.5) {
      const kf: Keyframe[] = [{ t: 0, transform: { scale: 1 } }];
      for (let a = 0.05, k = 0; a < dur - 0.3; a += spec.punchEvery, k++) {
        const from = k % 2 === 0 ? 1 : z, to = k % 2 === 0 ? z : 1;
        if (a > 0.05) kf.push({ t: r3(a), transform: { scale: from } });
        kf.push({ t: r3(Math.min(dur, a + 0.18)), transform: { scale: to }, easing: 'easeOut' });
      }
      return kf;
    }
    const hit = r3(Math.min(0.18, dur / 3));
    const kf: Keyframe[] = [{ t: 0, transform: { scale: 1 } }, { t: hit, transform: { scale: z }, easing: 'easeOut' }];
    if (dur > 1.2) kf.push({ t: r3(Math.max(hit + 0.1, dur - 0.6)), transform: { scale: z } }, { t: end, transform: { scale: 1 }, easing: 'easeInOut' });
    return kf;
  }
  // 7 px de orçamento para o zoom (o resto fica para a deriva lateral)
  const smoothCap = Math.min(MAX_SMOOTH_SCALE_DELTA * 2.5, maxSafeDelta(dur, spec.easing, 30, 1080, 7));
  if (spec.mode === 'pan') {
    const side = i % 2 === 0 ? 1 : -1;
    const z = 1 + Math.min(0.06, smoothCap);
    const dx = r3(Math.min((z - 1) / 2 - 0.004, 0.025) * side);
    return [{ t: 0, transform: { scale: z, x: -dx } }, { t: end, transform: { scale: z, x: dx }, easing: spec.easing }];
  }
  const raw = Math.abs(spec.zoom - 1);
  // sem medição: até 8%; medido: copia o modelo, limitado a ≤8 px/quadro
  const delta = Math.max(0.01, Math.min(raw, smoothCap));
  const inward = spec.direction === 'alternate' ? i % 2 === 0 : spec.direction === 'in';
  const big = r3(1 + delta);
  // deriva lateral ±1% (≤0,8 px/quadro e sem mostrar borda)
  const drift = r3(Math.max(0, Math.min(0.01, delta / 2 - 0.002, maxSafeDelta(dur, spec.easing, 30, 1080, 0.8) / 2)) * (i % 4 < 2 ? 1 : -1));
  return inward
    ? [{ t: 0, transform: { scale: 1, x: 0 } }, { t: end, transform: { scale: big, x: drift }, easing: spec.easing }]
    : [{ t: 0, transform: { scale: big, x: drift } }, { t: end, transform: { scale: 1, x: 0 }, easing: spec.easing }];
}

/** update_clip com o movimento de cada tomada da trilha principal */
export function shotMotionOps(p: Project, spec: MotionSpec, only?: Set<Id>): EditOp[] {
  if (!hasMotion(spec)) return [];
  const ops: EditOp[] = [];
  mainClips(p).forEach((c, i) => {
    if (c.locked || (only && !only.has(c.id))) return;
    const kf = motionKeyframes(c.duration, spec, i);
    if (!kf.length) return;
    ops.push({
      op: 'update_clip', clipId: c.id,
      patch: { transform: { ...c.transform, scale: 1, x: 0 }, keyframes: mergeKfProps(c.keyframes, kf, ['scale', 'x']) },
      explain: spec.mode === 'punch' ? `Zoom em pancada na tomada de ${fmt(c.start)}` : spec.mode === 'pan' ? `Movimento lateral suave em ${fmt(c.start)}` : `Aproximação suave na tomada de ${fmt(c.start)}`,
    });
  });
  return ops;
}

/* ---------- réplica estrita do modelo ---------- */

/** durações das tomadas do modelo (em ordem), para cortar no mesmo ritmo */
export function templateLengths(style: StyleProfile): Seconds[] {
  const t = style.template;
  // modelo medido SEM cortes (uma tomada só): a "tomada" é só o tamanho do arquivo, não um ritmo —
  // copiar é não cortar (antes um modelo de 0,4 s picotava o material em pedaços de 0,4 s)
  if (t && t.shots.length <= 1) return [];
  if (t?.shots.length) {
    // a 1ª e a última tomada costumam ser parciais: só entram se houver poucas
    const all = t.shots.map((s) => r3(s.end - s.start));
    const inner = all.length > 4 ? all.slice(1, -1) : all;
    return inner.filter((d) => d >= 0.3 && d <= 30);
  }
  return style.avgShotLength > 0 ? [style.avgShotLength] : [];
}

/** transição do modelo (só as medidas/descritas; corte seco = nenhuma) */
export function templateTransition(style: StyleProfile): { kind: TransitionKind; duration: Seconds; frequency: number } | undefined {
  const tr = style.template?.transitions.filter((x) => x.kind !== 'cut' && x.frequency > 0.05).sort((a, b) => b.frequency - a.frequency)[0];
  if (tr) return { kind: tr.kind, duration: Math.max(0.15, Math.min(0.8, tr.duration || 0.4)), frequency: tr.frequency };
  if (style.template) return undefined; // medido: só cortes secos
  const k = style.transitions.find((x) => x !== 'cut');
  return k ? { kind: k, duration: k === 'whip' || k === 'flash' || k === 'glitch' ? 0.25 : 0.4, frequency: 1 } : undefined;
}

/** estilo de legenda a partir da faixa medida no modelo (cor, caixa, altura, posição, palavras por vez) */
export function templateCaptionStyle(t: ReferenceTemplate): Partial<CaptionStyle> | undefined {
  const c = t.captions;
  if (!c) return undefined;
  const y = r3((c.region.y0 + c.region.y1) / 2);
  // altura medida = altura das letras (maiúsculas ≈ 0,72 do corpo); fontSize é px numa altura de 1920
  const fontSize = Math.round(Math.max(36, Math.min(180, c.heightPx1920 / (c.uppercase === false ? 0.6 : 0.72))));
  const style: Partial<CaptionStyle> = {
    color: c.textColor,
    position: { x: 0.5, y },
    fontSize,
    fontWeight: 800,
    ...(c.uppercase !== undefined ? { uppercase: c.uppercase } : {}),
    maxWords: c.wordsPerChunk ?? 2,
  };
  if (c.boxColor) {
    style.background = c.boxColor;
    style.backgroundPadding = Math.round(fontSize * 0.22);
    style.backgroundRadius = Math.round(fontSize * 0.12);
    style.strokeWidth = 0;
  }
  return style;
}

/** quantos cortes no máximo (cabe no limite de ops e mantém o ritmo sentido) */
const MAX_TEMPLATE_CUTS = 60;

/**
 * Réplica estrita do modelo no projeto (modo demo e "reedite seguindo o modelo"):
 * ritmo (cortes nos respiros), movimento por tomada, transições só as medidas e legenda da faixa medida.
 * A cor NÃO entra aqui (vem do colorGrade casado com o modelo).
 */
export function templateOps(p: Project, style: StyleProfile, opts: { wantsPunch?: boolean; cut?: boolean; motion?: boolean; transitions?: boolean; captions?: boolean } = {}): { ops: EditOp[]; said: string[] } {
  const ops: EditOp[] = [];
  const said: string[] = [];
  let sim = p;
  const push = (more: EditOp[], phrase?: string) => {
    if (!more.length) return;
    sim = applyOps(sim, more).project;
    ops.push(...more);
    if (phrase) said.push(phrase);
  };
  if (opts.cut !== false) {
    const lens = templateLengths(style);
    const splits = rhythmSplitOps(sim, lens, MAX_TEMPLATE_CUTS);
    const med = lens.length ? [...lens].sort((a, b) => a - b)[Math.floor(lens.length / 2)] : 0;
    push(splits, splits.length ? `${splits.length} corte${splits.length > 1 ? "s" : ""} no ritmo do modelo (tomadas de ~${med.toFixed(1).replace('.', ',')} s, nos respiros da fala)` : undefined);
  }
  if (opts.motion !== false) {
    const spec = motionSpecOf(style, opts.wantsPunch);
    if (!hasMotion(spec) && (spec.mode === 'static' || spec.mode === 'handheld')) {
      // modelo de câmera parada: tira zoom animado que já esteja nas tomadas (edição antiga/IA)
      const zoomed = mainClips(sim).filter((c) => !c.locked && (c.keyframes ?? []).some((k) => typeof k.transform.scale === 'number'));
      push(zoomed.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { keyframes: kfWithout(c.keyframes, ['scale'], { scale: c.transform.scale ?? 1 }) }, explain: `Câmera parada em ${fmt(c.start)} (como no modelo)` })), zoomed.length ? 'câmera parada como no modelo' : undefined);
    }
    const m = shotMotionOps(sim, spec);
    const name = spec.mode === 'punch' ? 'zoom em pancada' : spec.mode === 'pan' ? 'movimento lateral suave' : 'aproximação lenta e suave em cada tomada';
    push(m, m.length ? name : undefined);
  }
  if (opts.transitions !== false) {
    const tr = templateTransition(style);
    const clips = mainClips(sim).filter((c) => !c.locked).slice(1);
    if (tr && clips.length) {
      const every = Math.max(1, Math.round(1 / Math.max(0.05, tr.frequency)));
      const trOps: EditOp[] = clips.filter((_, i) => (i + 1) % every === 0).map((c) => ({
        op: 'update_clip' as const, clipId: c.id, patch: { transitionIn: { kind: tr.kind, duration: r3(Math.min(tr.duration, c.duration / 2)) } }, explain: `Transição do modelo em ${fmt(c.start)}`,
      }));
      push(trOps, trOps.length ? 'transições iguais às do modelo' : undefined);
    } else if (clips.some((c) => c.transitionIn)) {
      // o modelo só tem corte seco: tira transições inventadas
      push(clips.filter((c) => c.transitionIn).map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { transitionIn: undefined }, explain: `Corte seco em ${fmt(c.start)} (como no modelo)` })), 'cortes secos como no modelo');
    }
  }
  if (opts.captions !== false && style.template?.captions) {
    const cs = templateCaptionStyle(style.template);
    if (cs) push([{ op: 'set_caption_style', style: cs, explain: 'Legenda com a mesma cor, caixa e posição do modelo' }], 'legenda igual à do modelo');
  }
  return { ops, said };
}

/**
 * Caminho Claude, vídeo com modelo NÃO-pancada: estica rampas de escala abruptas das ops da IA
 * (smoothKeyframes) e garante easing. Clipes desconhecidos ficam como vieram.
 */
export function smoothMotionOps(p: Project, ops: EditOp[]): EditOp[] {
  let sim = p;
  const out: EditOp[] = [];
  for (const op of ops) {
    let o = op;
    if (op.op === 'update_clip' && Array.isArray((op.patch as { keyframes?: Keyframe[] }).keyframes)) {
      const clip = sim.tracks.flatMap((t) => t.clips).find((c) => c.id === op.clipId);
      const dur = (op.patch as { duration?: number }).duration ?? clip?.duration;
      const kf = (op.patch as { keyframes: Keyframe[] }).keyframes;
      if (dur && kf.length) o = { ...op, patch: { ...op.patch, keyframes: smoothKeyframes(kf, dur) } } as EditOp;
    } else if (op.op === 'add_clip' && Array.isArray((op.clip as { keyframes?: Keyframe[] }).keyframes)) {
      const kf = (op.clip as { keyframes: Keyframe[] }).keyframes;
      if (kf.length) o = { ...op, clip: { ...op.clip, keyframes: smoothKeyframes(kf, op.clip.duration) } } as EditOp;
    }
    out.push(o);
    try { sim = applyOps(sim, [o]).project; } catch { /* op inválida: o validador já tratou */ }
  }
  return out;
}

/** o pedido/modelo quer zoom em pancada? (aí não suaviza) */
export function wantsPunchMotion(text: string, style?: StyleProfile): boolean {
  const k = style?.template?.motion.mode ?? style?.motion?.kind;
  return k === 'punch' || k === 'handheld' || /punch|pancada|tranco|zoom (rapido|seco)|tremid|shake/i.test(text.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/**
 * Junta o que o Claude descreveu com o MEDIDO (o medido ganha): movimento de câmera, transições, faixa de
 * legenda (cor, caixa, posição, maiúsculas) e o molde inteiro guardado em style.template.
 */
export function mergeMeasured(style: StyleProfile, raw: unknown, template?: ReferenceTemplate): StyleProfile {
  const r = isObj(raw) ? raw : {};
  const cam = isObj(r.camera) ? r.camera : undefined;
  const claudeMotion = cam ? sanitizeStyleMotion({ kind: cam.mode, zoomPerShot: cam.avgZoomPerShot, easing: cam.easing }) : undefined;
  if (template) {
    style.template = template;
    const tm = template.motion;
    style.motion = { kind: tm.mode, zoomPerShot: tm.avgZoomPerShot, easing: tm.easing };
    style.zoomPunchIns = tm.mode === 'punch';
    style.transitions = [...new Set<TransitionKind>(['cut', ...template.transitions.filter((t) => t.frequency > 0.05).map((t) => t.kind)])];
    if (template.captions) {
      const c = template.captions;
      style.captions = {
        ...(style.captions ?? {}),
        present: true,
        color: c.textColor,
        ...(c.boxColor ? { background: c.boxColor } : {}),
        position: { x: 0.5, y: r3((c.region.y0 + c.region.y1) / 2) },
        ...(c.uppercase !== undefined && style.captions?.uppercase === undefined ? { uppercase: c.uppercase } : {}),
      };
    }
  } else if (claudeMotion) {
    style.motion = claudeMotion;
  }
  return style;
}

