/* =====================================================================
   Música · ARRANJADOR + RENDER. Transforma uma faixa do catálogo em PCM
   estéreo: escolhe compassos/BPM para caber exatamente na duração, monta
   seções (intro, A, B, final), toca bateria/baixo/harmonia/melodia,
   aplica sidechain, reverb, delay e masterização (saturação suave,
   loudness ~−14 LUFS e limitador com teto < −1 dBFS).
   Modo loop: sem intro/final e com as caudas dobradas no começo
   (emenda sem estalo). Puro e determinístico (semente da faixa).
   ===================================================================== */
import { Biquad, dbToGain, freeverb, ftanh, limit, lufs, pingPong, rng, upsample2 } from './dsp';
import {
  bass, crash, hat, keys, kick, lead, pad, perc, riser, shaker, snare, vinyl,
  type Mix, type Send,
} from './instruments';
import { musicTrack, trackStyle, type MusicTrack } from './catalog';
import type { DrumPat, Inst, Style } from './styles';
import { chordOf, stepScale, voiceChord, type ChordSpec } from './theory';

/** muda quando o som muda (invalida caches persistidos) */
export const ENGINE_VERSION = 3;

export const TARGET_LUFS = -14;
/** teto do limitador (≈ −1,2 dBFS: abaixo de −1 dBFS mesmo após quantizar em 16 bits) */
export const CEILING = dbToGain(-1.2);
export const MIN_DURATION = 2;
export const MAX_DURATION = 600;

export type Section = 'intro' | 'A' | 'B' | 'end';

export interface MusicTiming {
  bpm: number;
  bars: number;
  barLen: number;
  beatLen: number;
  sections: Section[];
}

export interface RenderOptions {
  duration: number;
  sampleRate?: number;
  /** trecho que emenda com ele mesmo (sem intro nem final) */
  loop?: boolean;
}

function resolve(t: string | MusicTrack): MusicTrack {
  const tr = typeof t === 'string' ? musicTrack(t) : t;
  if (!tr) throw new Error(`música desconhecida: ${String(t)}`);
  return tr;
}

export function clampDuration(d: number): number {
  if (!isFinite(d)) return 30;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, d));
}

/* ---------- tempo e forma ---------- */

/**
 * Compassos inteiros que cabem EXATAMENTE em `duration`: o BPM é ajustado
 * levemente (normalmente < 6%) para o último compasso terminar no fim.
 */
export function musicTiming(track: string | MusicTrack, duration: number, opts: { loop?: boolean } = {}): MusicTiming {
  const t = resolve(track);
  const style = trackStyle(t);
  const d = clampDuration(duration);
  const ideal = (d * t.bpm) / 240;
  const pick = (unit: number) => Math.max(unit, Math.round(ideal / unit) * unit);
  let bars = pick(1);
  if (opts.loop) {
    for (const unit of [4, 2]) {
      const b = pick(unit);
      if (Math.abs(b / ideal - 1) <= 0.12) { bars = b; break; }
    }
  }
  bars = Math.max(1, bars);
  const barLen = d / bars;
  const bpm = 240 / barLen;
  return { bpm, bars, barLen, beatLen: barLen / 4, sections: planSections(bars, !!opts.loop, style.intro ?? 1) };
}

export function planSections(bars: number, loop: boolean, introPref: number): Section[] {
  const out: Section[] = [];
  if (loop) {
    const phrase = bars >= 16 ? 8 : bars >= 4 ? Math.max(2, Math.floor(bars / 2)) : bars;
    for (let b = 0; b < bars; b++) out.push(Math.floor(b / phrase) % 2 === 0 ? 'A' : 'B');
    return out;
  }
  if (bars <= 1) return ['end'];
  if (bars === 2) return ['A', 'end'];
  const intro = Math.min(introPref, bars >= 12 ? 2 : bars >= 6 ? 1 : 0);
  const middle = bars - intro - 1;
  const phrase = middle >= 16 ? 8 : 4;
  // monta de trás para frente: termina sempre numa seção B (clímax) quando cabe
  const mid: Section[] = [];
  let k = 0;
  while (mid.length < middle) {
    const sec: Section = middle >= 6 ? (k % 2 === 0 ? 'B' : 'A') : 'A';
    for (let i = 0; i < phrase && mid.length < middle; i++) mid.unshift(sec);
    k++;
  }
  for (let i = 0; i < intro; i++) out.push('intro');
  out.push(...mid, 'end');
  return out;
}

/** tempos (s) de todas as batidas da faixa na duração pedida */
export function beatMarkers(track: string | MusicTrack, duration: number, opts: { loop?: boolean } = {}): number[] {
  const tm = musicTiming(track, duration, opts);
  const out: number[] = [];
  const n = tm.bars * 4;
  for (let i = 0; i < n; i++) out.push(Math.round(i * tm.beatLen * 10000) / 10000);
  return out;
}

/** tempos dos tempos fortes (início de cada compasso) */
export function barMarkers(track: string | MusicTrack, duration: number, opts: { loop?: boolean } = {}): number[] {
  const tm = musicTiming(track, duration, opts);
  return Array.from({ length: tm.bars }, (_, i) => Math.round(i * tm.barLen * 10000) / 10000);
}

/* ---------- melodia (motivo de 2 compassos, repetido com variação) ---------- */

/** ritmos em colcheias ao longo de 2 compassos: [posição, duração] */
const RHYTHMS: { d: number; n: [number, number][] }[] = [
  { d: 0.3, n: [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]] },
  { d: 0.4, n: [[0, 3], [3, 1], [4, 4], [8, 3], [11, 1], [12, 4]] },
  { d: 0.6, n: [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 3], [11, 1], [12, 4]] },
  { d: 0.7, n: [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 2], [10, 2], [12, 4]] },
  { d: 0.8, n: [[0, 3], [3, 1], [4, 2], [6, 1], [7, 1], [8, 1], [9, 1], [10, 2], [12, 2], [14, 2]] },
  { d: 0.9, n: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [6, 2], [8, 1], [9, 1], [10, 1], [11, 1], [12, 4]] },
];

interface Motif { notes: [number, number][]; steps: number[] }

function makeMotif(r: () => number, density: number): Motif {
  const cands = RHYTHMS.filter((x) => Math.abs(x.d - density) <= 0.25);
  const pool = cands.length ? cands : RHYTHMS;
  const rh = pool[Math.floor(r() * pool.length)];
  const steps = rh.n.map((_, i) => {
    if (i === 0) return 0;
    const x = r();
    return x < 0.3 ? 1 : x < 0.55 ? -1 : x < 0.7 ? 2 : x < 0.82 ? -2 : x < 0.9 ? 0 : 3;
  });
  return { notes: rh.n, steps };
}

/* ---------- arranjo ---------- */

const mod = (a: number, n: number) => ((a % n) + n) % n;

interface Ctx {
  /** bateria (taxa cheia) */
  mx: Mix;
  /** baixo/harmonia/melodia (meia taxa quando sr ≥ 32 kHz — conteúdo já filtrado) */
  mm: Mix;
  t: MusicTrack;
  st: Style;
  tm: MusicTiming;
  keyMidi: number;
  stepLen: number;
  r: () => number;
  loop: boolean;
}

function chordAtBar(c: Ctx, b: number, half: number, lb: number): ChordSpec {
  const sec = c.tm.sections[b];
  const { st } = c;
  if (sec === 'end') return chordOf(st.scale, 0, st.chordSize, { add9: st.add9 });
  const prog = sec === 'B' ? st.progB : st.progA;
  const deg = prog[mod(lb * st.chordsPerBar + half, prog.length)];
  return chordOf(st.scale, deg, st.chordSize, { sus: st.sus, add9: st.add9 });
}

function play(c: Ctx, inst: Inst, t: number, dur: number, notes: number[], vel: number, s: Send = {}): void {
  if ('pad' in inst) pad(c.mm, t, dur, notes, vel, inst.pad, s);
  else if ('keys' in inst) for (const m of notes) keys(c.mm, t, dur, m, vel, inst.keys, s);
  else for (const m of notes) lead(c.mm, t, dur, m, vel, inst.lead, s);
}

function nearestChordTone(m: number, ch: ChordSpec, key: number): number {
  const pcs = ch.semis.map((x) => mod(key + x, 12));
  for (let d = 0; d < 7; d++) {
    for (const cnd of d === 0 ? [m] : [m + d, m - d]) if (pcs.includes(mod(cnd, 12))) return cnd;
  }
  return m;
}

function bassRoot(c: Ctx, ch: ChordSpec): number {
  let m = 36 + mod(c.keyMidi + ch.root, 12);
  if (m > 43) m -= 12;
  return m + 12 * (c.st.bass.oct ?? 0);
}

function arrange(c: Ctx): void {
  const { mx, st, tm, t, stepLen } = c;
  const { sections, bars, barLen } = tm;
  const energy = t.energy;
  const human = () => (c.r() - 0.5) * 0.006;
  const vh = () => 0.92 + c.r() * 0.16;
  const stepT = (b: number, s: number) => b * barLen + s * stepLen + (s % 2 === 1 ? st.swing * stepLen : 0);
  const hasKick = !!(st.drumsA?.k || st.drumsB?.k);
  const secStart: number[] = [];
  for (let b = 0; b < bars; b++) secStart.push(b > 0 && sections[b] === sections[b - 1] ? secStart[b - 1] : b);

  const motifR = rng(t.seed * 7 + 1);
  const motifA = makeMotif(motifR, st.lead.density ?? 0.6);
  const motifB = makeMotif(motifR, Math.min(1, (st.lead.density ?? 0.6) + 0.1));
  const stabR = rng(t.seed * 13 + 5);
  const STABS = ['..x...x...x...x.', '...x..x...x..x..', 'x..x..x...x.x...'];
  const stabPat = t.genre === 'eletronica' || t.genre === 'vlog' ? STABS[0] : STABS[Math.floor(stabR() * STABS.length)];
  const FUNK = ['x..x..o.x.g..x..', 'x.gx..x.o..x.f..', 'x..g.xo...x.gf.x'];
  const funkPat = FUNK[Math.floor(stabR() * FUNK.length)];
  const COMP = [[0, 10], [0, 7], [0, 6, 12], [2, 10]];
  const arpUp = stabR() < 0.6;

  let prevHarm: number[] | undefined;
  let prevHarm2: number[] | undefined;
  let prevLead: number | undefined;
  let prevBass: number | undefined;

  for (let b = 0; b < bars; b++) {
    const sec = sections[b];
    const lb = b - secStart[b];
    const t0 = b * barLen;
    const next = sections[b + 1];
    const cpb = st.chordsPerBar;
    const chords = Array.from({ length: cpb }, (_, h) => chordAtBar(c, b, h, lb));
    const chordAt = (s: number) => chords[Math.min(cpb - 1, Math.floor((s / 16) * cpb))];
    const chordDur = barLen / cpb;
    const nextChord = b + 1 < bars ? chordAtBar(c, b + 1, 0, sections[b + 1] === sec ? lb + 1 : 0) : chords[0];

    /* ---------- bateria ---------- */
    const pat: DrumPat | undefined = sec === 'intro' ? (st.drumsIntro ?? { h: st.drumsA?.h, x: st.drumsA?.x })
      : sec === 'A' ? st.drumsA : sec === 'B' ? (st.drumsB ?? st.drumsA) : undefined;
    const lowE = energy === 'baixa';
    const kickHits: number[] = [];
    if (pat) {
      const line = (s: string | undefined, fn: (time: number, vel: number, ch: string) => void) => {
        if (!s) return;
        for (let i = 0; i < 16; i++) {
          const ch = s[i];
          if (!ch || ch === '.') continue;
          if (lowE && ch === 'g') continue;
          const vel = ch === 'X' ? 1 : ch === 'x' ? 0.8 : ch === 'g' ? 0.35 : 0.7;
          const tt = stepT(b, i) + human();
          if (ch === 'r' || ch === 'R') {
            const k = ch === 'r' ? 3 : 4;
            for (let j = 0; j < k; j++) fn(tt + (j * stepLen) / k, 0.45 + 0.1 * j, 'x');
          } else fn(tt, vel * vh(), ch);
        }
      };
      const kg = 0.95 * (st.kit.kickGain ?? 1);
      line(pat.k, (tt, v, ch) => { kickHits.push(Math.round((tt - t0) / stepLen)); kick(mx, tt, v * kg, st.kit.kick, {}, 55); void ch; });
      if (st.kit.snare !== 'none') {
        const sg = 0.6 * (st.kit.snareGain ?? 1);
        const sn = st.kit.snare;
        line(pat.s, (tt, v) => snare(mx, tt, v * sg, sn, { pan: sn === 'rim' ? -0.15 : 0 }));
      }
      const hg = 0.75 * (st.kit.hatGain ?? 1) * (lowE ? 0.8 : 1);
      line(pat.h, (tt, v, ch) => hat(mx, tt, v * hg, ch === 'o'));
      if (!lowE) line(pat.o, (tt, v) => hat(mx, tt, v * hg * 0.8, true));
      line(pat.x, (tt, v) => shaker(mx, tt, v * hg));
      if (st.kit.perc) { const pt = st.kit.perc; line(pat.p, (tt, v) => perc(mx, tt, v * 0.5, pt, { pan: pt === 'conga' ? 0.35 : 0 })); }
      if (st.kit.perc2 && !lowE) { const pt = st.kit.perc2; line(pat.t, (tt, v) => perc(mx, tt, v * 0.55, pt, { pan: -0.2 })); }
      // virada no fim da frase (antes de mudar de seção)
      if (next && next !== sec && next !== 'end' && sec !== 'intro' && !lowE) {
        if (st.kit.snare !== 'none' && st.kit.snare !== 'rim') for (const s of [13, 14, 15]) snare(mx, stepT(b, s), (0.3 + 0.12 * (s - 12)) * 0.6, st.kit.snare);
        else if (st.kit.perc === 'taiko' || st.kit.perc2 === 'tom') for (const s of [12, 14]) perc(mx, stepT(b, s), 0.45, 'tom');
      }
    }
    if (sec === 'B' && lb === 0 && st.fx.crash && energy !== 'baixa') crash(mx, t0, 0.8);
    if (st.fx.riser && next === 'B' && sec !== 'B' && energy !== 'baixa' && b + 1 < bars) riser(mx, t0, barLen, 0.6);
    if (sec === 'end') {
      if (hasKick) kick(mx, t0, 0.9 * (st.kit.kickGain ?? 1), st.kit.kick === '808' ? 'punch' : st.kit.kick);
      if (st.fx.crash) crash(mx, t0, 0.6);
    }

    /* ---------- baixo ---------- */
    const bg = (st.bass.gain ?? 0.75) * 0.85;
    const bt = st.bass.type;
    const bnote = (tt: number, dur: number, m: number, v: number, glide?: number) => { bass(c.mm, tt, dur, m, v * bg, bt, {}, glide); prevBass = m; };
    if (sec === 'end') {
      bnote(t0, barLen * 0.7, bassRoot(c, chords[0]), 0.9);
    } else if (sec !== 'intro' || st.bass.pattern === 'sustain') {
      const iv = sec === 'intro' ? 0.6 : 1;
      const root = (s: number) => bassRoot(c, chordAt(s));
      const nr = bassRoot(c, nextChord);
      switch (st.bass.pattern) {
        case 'root8':
          for (let s = 0; s < 16; s += 2) {
            let m = root(s);
            if ((s === 6 || s === 14) && c.r() < 0.35) m += 12;
            if (s === 14 && c.r() < 0.3) m = nr + (nr > m ? -2 : 2);
            bnote(stepT(b, s), stepLen * 1.7, m, (s % 4 === 0 ? 0.95 : 0.75) * iv);
          }
          break;
        case 'offbeat':
          for (const s of [2, 6, 10, 14]) bnote(stepT(b, s), stepLen * 1.6, root(s), 0.9 * iv);
          if (c.r() < 0.25) bnote(stepT(b, 15), stepLen * 0.8, root(15) + 12, 0.6 * iv);
          break;
        case 'root4':
          for (const s of [0, 4, 8, 12]) bnote(stepT(b, s), stepLen * 3.4, s === 8 && c.r() < 0.3 ? root(s) + 7 : root(s), (s === 0 ? 0.95 : 0.8) * iv);
          break;
        case 'sustain':
          for (let h = 0; h < cpb; h++) bnote(t0 + h * chordDur, chordDur * 0.98, bassRoot(c, chords[h]), 0.85 * iv);
          break;
        case 'walking': {
          for (let q = 0; q < 4; q++) {
            const ch = chordAt(q * 4);
            const r0 = bassRoot(c, ch);
            const third = ch.semis[1] - ch.semis[0];
            const m = q === 0 ? r0 : q === 1 ? r0 + third : q === 2 ? r0 + 7 : nr + (c.r() < 0.5 ? -1 : 1);
            bnote(stepT(b, q * 4), stepLen * 3.6, m, (q === 0 ? 0.95 : 0.8) * iv);
          }
          break;
        }
        case 'funk': {
          const r0 = root(0);
          for (let s = 0; s < 16; s++) {
            const ch = funkPat[s];
            if (ch === '.') continue;
            let len = 1;
            while (s + len < 16 && funkPat[s + len] === '.' && len < 2) len++;
            const m = ch === 'o' ? r0 + 12 : ch === 'f' ? r0 + 7 : ch === 's' ? r0 + 10 : root(s);
            bnote(stepT(b, s), stepLen * len * 0.8, m, (ch === 'g' ? 0.4 : s % 4 === 0 ? 0.95 : 0.8) * iv);
          }
          break;
        }
        case '808': {
          const hits = kickHits.length ? [...new Set(kickHits)].filter((s) => s >= 0 && s < 16).sort((a, x) => a - x) : [0, 8];
          for (let i = 0; i < hits.length; i++) {
            const s = hits[i];
            const e = hits[i + 1] ?? 16;
            let m = root(s);
            if (i === hits.length - 1 && hits.length > 1 && c.r() < 0.3) m += 12;
            const glide = prevBass !== undefined && prevBass !== m && Math.abs(prevBass - m) <= 12 ? prevBass : undefined;
            bnote(stepT(b, s), (e - s) * stepLen * 0.95, m, 0.95 * iv, glide);
          }
          break;
        }
        case 'folk':
          for (const s of [0, 4, 8, 12]) {
            const r0 = root(s);
            const m = s === 4 || s === 12 ? (c.r() < 0.5 ? r0 + 7 : r0 - 5) : r0;
            bnote(stepT(b, s), stepLen * 3, s === 4 || s === 12 ? Math.max(28, m) : m, (s % 8 === 0 ? 0.95 : 0.7) * iv);
          }
          break;
        case 'pulse':
          for (let s = 0; s < 16; s += 2) bnote(stepT(b, s), stepLen * 1.5, root(s), (s % 4 === 0 ? 0.9 : 0.7) * iv);
          break;
        default:
          break;
      }
    }

    /* ---------- harmonia ---------- */
    const harmPart = (part: NonNullable<Style['harm2']> | Style['harm'], prev: number[] | undefined, gain: number): number[] | undefined => {
      const lo = part.lo ?? 53, hi = part.hi ?? 74;
      const voicings = chords.map((ch) => { const v = voiceChord(ch, c.keyMidi, lo, hi, prev); prev = v; return v; });
      const vAt = (s: number) => voicings[Math.min(cpb - 1, Math.floor((s / 16) * cpb))];
      const inst = part.inst;
      const g = gain * (sec === 'intro' ? 0.8 : 1);
      const isKeys = 'keys' in inst;
      if (sec === 'end') {
        play(c, inst, t0, isKeys ? barLen * 0.25 : barLen * 0.8, voicings[0], 0.85 * g);
        return prev;
      }
      switch (part.rhythm) {
        case 'sustain':
          for (let h = 0; h < cpb; h++) play(c, inst, t0 + h * chordDur, chordDur, voicings[h], 0.85 * g);
          break;
        case 'stab':
          for (let s = 0; s < 16; s++) if (stabPat[s] === 'x') play(c, inst, stepT(b, s) + human(), stepLen * 1.2, vAt(s), 0.8 * g * vh());
          break;
        case 'comp': {
          const hits = COMP[Math.floor(c.r() * COMP.length)];
          hits.forEach((s, i) => {
            const e = hits[i + 1] ?? 16;
            const v = vAt(s);
            v.forEach((m, k) => play(c, inst, stepT(b, s) + k * 0.012 + human(), (e - s) * stepLen * 0.95, [m], (i === 0 ? 0.8 : 0.68) * g * vh()));
          });
          break;
        }
        case 'strum': {
          const STR = 'D.DU.UDU';
          for (let e = 0; e < 8; e++) {
            const kind = STR[e];
            if (kind === '.') continue;
            const s = e * 2;
            let ee = e + 1;
            while (ee < 8 && STR[ee] === '.') ee++;
            const v = vAt(s);
            const low = 40 + mod(c.keyMidi + chordAt(s).root - 40, 12);
            const strings = kind === 'D' ? [low, ...v] : [...v].reverse().slice(0, 3);
            const tt = stepT(b, s) + human();
            strings.forEach((m, k) => play(c, inst, tt + k * (kind === 'D' ? 0.011 : 0.008), (ee - e) * stepLen * 2 * 0.95, [m], (kind === 'D' ? 0.8 : 0.5) * g * vh()));
          }
          break;
        }
        case 'pick': {
          for (let e = 0; e < 8; e++) {
            const s = e * 2;
            const v = vAt(s);
            const low = 40 + mod(c.keyMidi + chordAt(s).root - 40, 12);
            const top = v[v.length - 1], mid = v[Math.min(1, v.length - 1)];
            const seq = [low, top, mid, top, low + 7, top, mid, v[Math.min(2, v.length - 1)]];
            play(c, inst, stepT(b, s) + human(), stepLen * 6, [seq[e]], (e % 4 === 0 ? 0.8 : 0.6) * g * vh());
          }
          break;
        }
        case 'arp': {
          for (let e = 0; e < 8; e++) {
            const s = e * 2;
            const v = vAt(s);
            const seq = arpUp ? [...v, v[0] + 12] : [...v, v[0] + 12, ...v.slice(1).reverse()];
            play(c, inst, stepT(b, s) + human(), stepLen * 5, [seq[e % seq.length]], (e % 4 === 0 ? 0.75 : 0.6) * g * vh());
          }
          break;
        }
        case 'block':
          for (const s of [0, 4, 8, 12]) play(c, inst, stepT(b, s) + human(), stepLen * 3.5, vAt(s), (s === 0 ? 0.85 : 0.68) * g * vh());
          break;
        case 'pianoarp': {
          for (let e = 0; e < 8; e++) {
            const s = e * 2;
            const v = vAt(s);
            const low = 36 + mod(c.keyMidi + chordAt(s).root - 36, 12) + 12;
            const seq = [low, low + 7, v[0], v[1], v[2] ?? v[0] + 12, v[1], v[0], low + 7];
            play(c, inst, stepT(b, s) + human(), stepLen * 6, [seq[e]], (e === 0 ? 0.75 : 0.55) * g * vh());
          }
          break;
        }
        case 'halfs':
          for (const s of [0, 8]) play(c, inst, stepT(b, s) + human(), stepLen * 7.6, vAt(s), 0.75 * g * vh());
          break;
      }
      return prev;
    };
    prevHarm = harmPart(st.harm, prevHarm, st.harm.gain ?? 0.55);
    if (st.harm2 && (st.harm2.always || sec === 'B' || (sec === 'end' && st.harm2.always !== false))) {
      prevHarm2 = harmPart(st.harm2, prevHarm2, st.harm2.gain ?? 0.35);
    }

    /* ---------- melodia / lead ---------- */
    const L = st.lead;
    const leadOn = L.kind !== 'none' && (sec === 'B' || (L.sections === 'all' && sec === 'A'));
    const lg = (L.gain ?? 0.4) * (sec === 'A' ? 0.85 : 1);
    const ls: Send = { dly: L.dly ?? 0.2 };
    if (sec === 'end' && L.kind === 'melody') {
      const m = nearestChordTone(prevLead ?? L.center, chords[0], c.keyMidi);
      const root = L.center - 6 + mod(c.keyMidi + chords[0].root - (L.center - 6), 12);
      play(c, L.inst, t0, barLen * 0.5, [Math.abs(root - m) <= 5 ? root : m], 0.7 * (L.gain ?? 0.4), ls);
    }
    if (leadOn) {
      switch (L.kind) {
        case 'melody': {
          const motif = sec === 'B' ? motifB : motifA;
          const pb = lb % 4;
          const half = pb % 2;
          const center = L.center + (sec === 'B' ? 2 : 0);
          let p = prevLead ?? center;
          const notes = motif.notes.map((n, i) => ({ slot: n[0], dur: n[1], step: motif.steps[i], i })).filter((n) => Math.floor(n.slot / 8) === half);
          notes.forEach((n, k) => {
            const s = (n.slot % 8) * 2;
            const ch = chordAt(s);
            if (n.i === 0) p = nearestChordTone(center, ch, c.keyMidi);
            else p = stepScale(p, n.step, c.st.scale, c.keyMidi);
            if (p > center + 9) p = stepScale(p, -4, c.st.scale, c.keyMidi);
            if (p < center - 7) p = stepScale(p, 4, c.st.scale, c.keyMidi);
            if (s % 8 === 0) p = nearestChordTone(p, ch, c.keyMidi);
            const lastOfPhrase = pb === 3 && k === notes.length - 1;
            if (lastOfPhrase) {
              const r0 = p - mod(p - (c.keyMidi + ch.root), 12);
              p = Math.abs(r0 + 12 - p) < Math.abs(r0 - p) ? r0 + 12 : r0;
            }
            play(c, L.inst, stepT(b, s) + human(), n.dur * stepLen * 2 * 0.92, [p], (s % 8 === 0 ? 0.85 : 0.7) * lg * vh(), ls);
          });
          prevLead = p;
          break;
        }
        case 'arp':
        case 'ostinato': {
          const rate = L.rate ?? 16;
          const inc = rate === 16 ? 1 : 2;
          for (let s = 0; s < 16; s += inc) {
            const ch = chordAt(s);
            let m: number;
            if (L.kind === 'arp') {
              const v = voiceChord(ch, c.keyMidi, L.center - 5, L.center + 9);
              const seq = arpUp ? [...v, v[0] + 12] : [...v, v[0] + 12, ...v.slice(1).reverse()];
              m = seq[(s / inc) % seq.length];
            } else {
              const r0 = L.center - 6 + mod(c.keyMidi + ch.root - (L.center - 6), 12);
              const third = ch.semis[1] - ch.semis[0];
              const seq = [0, 0, 7, 0, third, 0, 7, 12];
              m = r0 + seq[(s / inc) % seq.length];
            }
            const v = (s % 4 === 0 ? 0.85 : 0.62) * lg * vh() * (sec === 'A' && L.kind === 'ostinato' ? 0.8 : 1);
            play(c, L.inst, stepT(b, s) + human(), stepLen * inc * 0.85, [m], v, ls);
          }
          break;
        }
        case 'sparse': {
          let any = false;
          for (let q = 0; q < 4; q++) {
            if (c.r() > (L.density ?? 0.3) && !(q === 3 && !any && lb % 2 === 1)) continue;
            any = true;
            const ch = chordAt(q * 4);
            const v = voiceChord(ch, c.keyMidi, L.center - 5, L.center + 7);
            const m = v[Math.floor(c.r() * v.length)];
            play(c, L.inst, stepT(b, q * 4) + human(), stepLen * (4 + Math.floor(c.r() * 8)), [m], (0.55 + c.r() * 0.25) * lg, ls);
          }
          break;
        }
      }
    }
  }
}

/* ---------- render ---------- */

/** aplica `fn` com contexto circular (para o modo loop não ter emenda nos filtros/limitador) */
function withWrap(ch: Float32Array[], loop: boolean, pre: number, post: number, fn: (x: Float32Array[]) => void): void {
  if (!loop) { fn(ch); return; }
  const n = ch[0].length;
  pre = Math.min(pre, n); post = Math.min(post, n);
  const ext = ch.map((c) => {
    const e = new Float32Array(pre + n + post);
    e.set(c.subarray(n - pre), 0);
    e.set(c, pre);
    e.set(c.subarray(0, post), pre + n);
    return e;
  });
  fn(ext);
  ext.forEach((e, k) => ch[k].set(e.subarray(pre, pre + n)));
}

/** PCM estéreo [L, R] com exatamente round(duration·sr) amostras */
export function renderMusicPCM(track: string | MusicTrack, opts: RenderOptions): Float32Array[] {
  const t = resolve(track);
  const st = trackStyle(t);
  const sr = opts.sampleRate ?? 44100;
  const loop = !!opts.loop;
  const duration = clampDuration(opts.duration);
  const N = Math.round(duration * sr);
  const tail = Math.round((loop ? 4 : 0.6) * sr);
  const n = N + tail;
  const tm = musicTiming(t, duration, { loop });
  const R0 = rng(t.seed);
  const R1 = rng(t.seed ^ 0x9e3779b9);
  const mkMix = (rate: number, len: number): Mix => ({
    sr: rate, n: len,
    drums: { L: new Float32Array(len), R: new Float32Array(len) },
    music: { L: new Float32Array(len), R: new Float32Array(len) },
    rev: new Float32Array(len),
    dly: new Float32Array(len),
    kicks: [],
    noise: () => R0() * 2 - 1,
    rand: R1,
  });
  const F = sr >= 32000 ? 2 : 1;
  const hsr = sr / F;
  const hn = Math.ceil(n / F) + 4;
  const mx = mkMix(sr, n);
  const mm = mkMix(hsr, hn);
  if (loop) { mx.wrap = N; mm.wrap = Math.round(N / F); }
  const c: Ctx = { mx, mm, t, st, tm, keyMidi: 48 + t.key, stepLen: tm.beatLen / 4, r: rng(t.seed * 31 + 7), loop };
  arrange(c);
  if (st.fx.lofi) vinyl(mx, st.fx.lofi);

  /* envios da bateria → meia taxa (passa-baixa antes de dizimar) */
  if (F > 1) {
    const lr = Biquad.lowpass(hsr * 0.42, sr, 0.7), ld = Biquad.lowpass(hsr * 0.42, sr, 0.7);
    for (let i = 0; i < n; i++) {
      const r = lr.tick(mx.rev[i]), d = ld.tick(mx.dly[i]);
      if (i % F === 0) { mm.rev[i / F] += r; mm.dly[i / F] += d; }
    }
  } else {
    for (let i = 0; i < n; i++) { mm.rev[i] += mx.rev[i]; mm.dly[i] += mx.dly[i]; }
  }

  /* sidechain (bumbo abaixa baixo/harmonia/melodia) */
  const depth = st.fx.sidechain;
  if (depth > 0 && mx.kicks.length) {
    const g = new Float32Array(hn).fill(1);
    const att = Math.round(0.004 * hsr), W = Math.round(0.32 * hsr), relS = 0.11 * hsr;
    const NH = N / F;
    const k0s = mx.kicks.map((k) => Math.round(k / F));
    const ks = loop ? [...k0s, ...k0s.map((k) => Math.round(k + NH)), ...k0s.map((k) => Math.round(k - NH))] : k0s;
    for (const k0 of ks) {
      const a = Math.max(0, k0), e = Math.min(hn, k0 + W);
      for (let j = a; j < e; j++) {
        const d = j - k0;
        const shape = d < att ? d / att : Math.exp(-(d - att) / relS);
        const v = 1 - depth * shape;
        if (v < g[j]) g[j] = v;
      }
    }
    for (let i = 0; i < hn; i++) { mm.music.L[i] *= g[i]; mm.music.R[i] *= g[i]; }
  }

  /* efeitos em meia taxa (conteúdo do reverb/delay é filtrado < 9 kHz) */
  const HL = mm.music.L, HR = mm.music.R;
  freeverb(mm.rev, hn, hsr, HL, HR, st.fx.room, 0.45, st.fx.reverb * 2.2);
  if (st.fx.delay > 0) pingPong(mm.dly, hn, hsr, HL, HR, tm.beatLen * 0.75, 0.38, st.fx.delay * 0.9);

  const L = mx.drums.L, R = mx.drums.R;
  const UL = F > 1 ? upsample2(HL, n) : HL, UR = F > 1 ? upsample2(HR, n) : HR;
  for (let i = 0; i < n; i++) { L[i] += UL[i]; R[i] += UR[i]; }

  /* dobra a cauda (loop) ou descarta (final com fade) */
  if (loop) for (let i = 0; i < tail && i < N; i++) { L[i] += L[N + i]; R[i] += R[N + i]; }
  const ch = [L.slice(0, N), R.slice(0, N)];

  /* masterização */
  withWrap(ch, loop, Math.round(1.5 * sr), 0, (x) => {
    for (const c2 of x) {
      const hp = Biquad.highpass(28, sr, 0.7);
      const lp = st.fx.bright ? Biquad.lowpass(st.fx.bright, sr, 0.6) : null;
      const tilt = Biquad.peak(3200, sr, -1.5, 0.6); // suaviza a região que cansa o ouvido
      for (let i = 0; i < c2.length; i++) {
        let v = hp.tick(c2[i]);
        v = tilt.tick(v);
        if (lp) v = lp.tick(v);
        c2[i] = v;
      }
    }
  });
  // saturação suave (arredonda picos de bateria antes da loudness)
  let pk = 0;
  for (const c2 of ch) for (let i = 0; i < N; i++) { const a = Math.abs(c2[i]); if (a > pk) pk = a; }
  if (pk > 1e-6) {
    const drive = st.fx.drive ?? 1.3;
    const k = 1 / pk, norm = 1 / ftanh(drive);
    for (const c2 of ch) for (let i = 0; i < N; i++) c2[i] = ftanh(c2[i] * k * drive) * norm;
    // loudness ~ −14 LUFS
    const l0 = lufs(ch, sr);
    const gain = dbToGain(Math.min(24, TARGET_LUFS - l0));
    for (const c2 of ch) for (let i = 0; i < N; i++) c2[i] *= gain;
  }
  withWrap(ch, loop, Math.round(0.3 * sr), Math.round(0.05 * sr), (x) => limit(x, sr, CEILING));

  if (!loop) {
    const fin = Math.min(N, Math.round(sr * 0.006));
    for (const c2 of ch) for (let i = 0; i < fin; i++) c2[i] *= i / fin;
    // final: o último compasso soa e some (cosseno até zero)
    const endStart = tm.sections[tm.bars - 1] === 'end' ? (tm.bars - 1) * tm.barLen + tm.barLen * 0.3 : duration - Math.min(2, duration * 0.3);
    const fs = Math.max(0, Math.min(N - 1, Math.round(endStart * sr)));
    const fl = N - fs;
    for (const c2 of ch) for (let i = fs; i < N; i++) {
      const p = (i - fs) / Math.max(1, fl - 1);
      c2[i] *= 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, p));
    }
    for (const c2 of ch) c2[N - 1] = 0;
  }
  return ch;
}
