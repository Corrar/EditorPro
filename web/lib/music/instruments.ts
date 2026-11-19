/* =====================================================================
   Música · instrumentos sintetizados (bateria, baixo, pads, teclas,
   cordas dedilhadas por Karplus-Strong, leads). Puro / determinístico.
   Cada instrumento escreve no barramento (drums ou music) com pan e
   envios de reverb/delay.
   ===================================================================== */
import { adsr, Biquad, blep, ftanh, mtof, onePoleCoef, panGains, pulse, saw, sin1, SVF } from './dsp';

export interface Bus { L: Float32Array; R: Float32Array }

export interface Mix {
  sr: number;
  /** comprimento dos barramentos (amostras) */
  n: number;
  drums: Bus;
  /** barramento que sofre sidechain (baixo, harmonia, melodia) */
  music: Bus;
  rev: Float32Array;
  dly: Float32Array;
  /** índices (amostra) dos bumbos — usados no sidechain */
  kicks: number[];
  /** ruído branco [-1, 1) com semente */
  noise: () => number;
  /** aleatório [0, 1) com semente */
  rand: () => number;
  /** modo loop: amostras antes de 0 dão a volta para o fim (período, em amostras) */
  wrap?: number;
}

export interface Send {
  pan?: number;
  gain?: number;
  rev?: number;
  dly?: number;
  bus?: 'drums' | 'music';
}

/* ---------- buffers de rascunho reaproveitados (evita lixo por nota) ---------- */

const pool: Float32Array[] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
function scratch(k: 0 | 1 | 2, n: number): Float32Array {
  if (pool[k].length < n) pool[k] = new Float32Array(Math.ceil(n * 1.25));
  pool[k].fill(0, 0, n);
  return pool[k];
}

function emitMono(mx: Mix, buf: Float32Array, len: number, i0: number, s: Send): void {
  const bus = s.bus === 'drums' ? mx.drums : mx.music;
  const g = s.gain ?? 1;
  const [gl, gr] = panGains(s.pan ?? 0);
  const rv = (s.rev ?? 0) * g, dl = (s.dly ?? 0) * g;
  const a = mx.wrap ? 0 : Math.max(0, -i0), b = Math.min(len, mx.n - i0);
  for (let i = a; i < b; i++) {
    const v = buf[i] * g;
    let j = i0 + i;
    if (j < 0) j += mx.wrap ?? 0;
    bus.L[j] += v * gl;
    bus.R[j] += v * gr;
    if (rv) mx.rev[j] += buf[i] * rv;
    if (dl) mx.dly[j] += buf[i] * dl;
  }
}

function emitStereo(mx: Mix, l: Float32Array, r: Float32Array, len: number, i0: number, s: Send): void {
  const bus = s.bus === 'drums' ? mx.drums : mx.music;
  const g = s.gain ?? 1;
  const rv = (s.rev ?? 0) * g * 0.5, dl = (s.dly ?? 0) * g * 0.5;
  const a = mx.wrap ? 0 : Math.max(0, -i0), b = Math.min(len, mx.n - i0);
  for (let i = a; i < b; i++) {
    let j = i0 + i;
    if (j < 0) j += mx.wrap ?? 0;
    bus.L[j] += l[i] * g;
    bus.R[j] += r[i] * g;
    const m = l[i] + r[i];
    if (rv) mx.rev[j] += m * rv;
    if (dl) mx.dly[j] += m * dl;
  }
}

const at = (mx: Mix, t: number) => Math.round(t * mx.sr);

/* ---------- tabelas de onda (soma de harmônicos pré-calculada: 1 leitura por amostra) ---------- */
const WT_N = 2048;
function makeTable(h: number[]): Float32Array {
  const tb = new Float32Array(WT_N + 1);
  for (let i = 0; i <= WT_N; i++) {
    let v = 0;
    for (let k = 0; k < h.length; k++) v += h[k] * Math.sin(((i / WT_N) * (k + 1)) * Math.PI * 2);
    tb[i] = v;
  }
  return tb;
}
const WT_WARM = makeTable([1, 0.08, 0.22]);
const WT_AIR = makeTable([1, 0.08, 0.22, 0.12]);
const WT_ORGAN = makeTable([1, 0.5, 0.3, 0.15]);
function wt(tb: Float32Array, ph: number): number {
  const f = ph * WT_N;
  const i = f | 0;
  return tb[i] + (tb[i + 1] - tb[i]) * (f - i);
}

/* =====================================================================
   BATERIA
   ===================================================================== */

export type KickType = 'punch' | 'soft' | '808' | 'boom' | 'deep';

export function kick(mx: Mix, t: number, vel: number, type: KickType, s: Send = {}, tuneHz = 50): void {
  const { sr } = mx;
  const dur = type === '808' ? 1.1 : type === 'boom' ? 1.2 : 0.5;
  const n = Math.round(dur * sr);
  const out = scratch(0, n);
  const p = {
    punch: { f0: 175, f1: 48, pt: 0.032, tau: 0.2, click: 0.35, drive: 1.6 },
    deep: { f0: 150, f1: 44, pt: 0.04, tau: 0.3, click: 0.2, drive: 1.4 },
    soft: { f0: 120, f1: 52, pt: 0.04, tau: 0.16, click: 0.05, drive: 1.1 },
    '808': { f0: tuneHz * 3, f1: tuneHz, pt: 0.025, tau: 0.55, click: 0.15, drive: 2.2 },
    boom: { f0: 95, f1: 38, pt: 0.09, tau: 0.55, click: 0, drive: 1.3 },
  }[type];
  let ph = 0, amp = 1;
  const k = Math.exp(-1 / (p.tau * sr));
  const kp = Math.exp(-1 / (p.pt * sr));
  let pe = 1, cl = 1;
  const kc = Math.exp(-1 / (0.0025 * sr));
  const lp = new SVF(sr); lp.set(type === 'soft' ? 2500 : 5000, 0.7);
  for (let i = 0; i < n; i++) {
    const f = p.f1 + (p.f0 - p.f1) * pe;
    pe *= kp;
    ph += f / sr;
    const atk = i < 24 ? i / 24 : 1;
    let v = sin1(ph) * amp;
    if (p.click) { v += lp.tick(mx.noise()) * cl * p.click; cl *= kc; }
    if (type === 'boom') v += lp.tick(mx.noise()) * 0.08 * amp * amp;
    out[i] = (ftanh(v * p.drive) / ftanh(p.drive)) * atk;
    amp *= k;
  }
  // rampa final
  const tail = Math.round(sr * 0.01);
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  const i0 = at(mx, t);
  if (type !== 'boom') mx.kicks.push(i0);
  emitMono(mx, out, n, i0, { bus: 'drums', ...s, gain: (s.gain ?? 1) * vel });
}

export type SnareType = 'snare' | 'clap' | 'rim' | 'brush' | 'snap';

export function snare(mx: Mix, t: number, vel: number, type: SnareType, s: Send = {}): void {
  const { sr } = mx;
  const n = Math.round((type === 'rim' ? 0.12 : 0.45) * sr);
  const out = scratch(0, n);
  const f = new SVF(sr);
  if (type === 'snare') {
    f.set(2400, 0.8);
    let ph1 = 0, ph2 = 0;
    const kt = Math.exp(-1 / (0.05 * sr)), kn = Math.exp(-1 / (0.13 * sr));
    let et = 1, en = 1;
    const hp = Biquad.highpass(900, sr);
    for (let i = 0; i < n; i++) {
      ph1 += 188 / sr; ph2 += 332 / sr;
      f.tick(mx.noise());
      const nz = hp.tick(f.band * 1.2 + f.high * 0.35);
      out[i] = ((sin1(ph1) * 0.55 + sin1(ph2) * 0.25) * et + nz * en) * (i < 20 ? i / 20 : 1);
      et *= kt; en *= kn;
    }
  } else if (type === 'clap') {
    f.set(1250, 1.3);
    const sr1 = 1 / sr;
    for (let i = 0; i < n; i++) {
      const tt = i * sr1;
      let e = 0;
      for (const o of [0, 0.011, 0.022]) { const d = tt - o; if (d >= 0) e += Math.exp(-d / 0.0042); }
      if (tt > 0.03) e += 0.75 * Math.exp(-(tt - 0.03) / 0.12);
      f.tick(mx.noise());
      out[i] = f.band * e * 1.8;
    }
  } else if (type === 'rim') {
    f.set(3400, 2);
    let ph = 0;
    const k = Math.exp(-1 / (0.012 * sr));
    let e = 1;
    for (let i = 0; i < n; i++) {
      ph += 1720 / sr;
      f.tick(mx.noise());
      out[i] = (sin1(ph) * 0.6 + f.band * 1.2) * e;
      e *= k;
    }
  } else if (type === 'brush') {
    f.set(3200, 0.7);
    const k = Math.exp(-1 / (0.16 * sr));
    let e = 1;
    const na = Math.round(0.012 * sr);
    for (let i = 0; i < n; i++) {
      f.tick(mx.noise());
      out[i] = f.band * e * (i < na ? i / na : 1) * 1.1;
      e *= k;
    }
  } else {
    f.set(2300, 1.8);
    let ph = 0;
    const k = Math.exp(-1 / (0.035 * sr));
    let e = 1;
    for (let i = 0; i < n; i++) {
      ph += 1150 / sr;
      f.tick(mx.noise());
      out[i] = (f.band * 1.6 + sin1(ph) * 0.2) * e;
      e *= k;
    }
  }
  emitMono(mx, out, n, at(mx, t), { bus: 'drums', rev: 0.25, ...s, gain: (s.gain ?? 1) * vel });
}

export function hat(mx: Mix, t: number, vel: number, open: boolean, s: Send = {}): void {
  const { sr } = mx;
  const tau = open ? 0.22 : 0.028;
  const n = Math.round((open ? 0.7 : 0.13) * sr);
  const out = scratch(0, n);
  const f = new SVF(sr); f.set(8200, 0.9);
  const f2 = new SVF(sr); f2.set(11000, 1.4);
  const k = Math.exp(-1 / (tau * sr));
  let e = 1;
  for (let i = 0; i < n; i++) {
    const x = mx.noise();
    f.tick(x); f2.tick(x);
    out[i] = (f.high * 0.8 + f2.band * 0.5) * e * (i < 10 ? i / 10 : 1);
    e *= k;
  }
  emitMono(mx, out, n, at(mx, t), { bus: 'drums', pan: 0.25, rev: 0.1, ...s, gain: (s.gain ?? 1) * vel * 0.55 });
}

export function shaker(mx: Mix, t: number, vel: number, s: Send = {}): void {
  const { sr } = mx;
  const n = Math.round(0.14 * sr);
  const out = scratch(0, n);
  const f = new SVF(sr); f.set(6200, 1.1);
  const na = Math.round(0.012 * sr);
  const k = Math.exp(-1 / (0.035 * sr));
  let e = 1;
  for (let i = 0; i < n; i++) {
    f.tick(mx.noise());
    out[i] = f.band * (i < na ? i / na : e);
    if (i >= na) e *= k;
  }
  emitMono(mx, out, n, at(mx, t), { bus: 'drums', pan: -0.3, rev: 0.12, ...s, gain: (s.gain ?? 1) * vel * 0.7 });
}

export type PercType = 'conga' | 'wood' | 'tom' | 'taiko' | 'tick' | 'tamb' | 'cowbell';

export function perc(mx: Mix, t: number, vel: number, type: PercType, s: Send = {}): void {
  const { sr } = mx;
  const cfg = {
    conga: { f0: 240, f1: 196, pt: 0.02, tau: 0.16, len: 0.4, noise: 0.08 },
    wood: { f0: 1180, f1: 1150, pt: 0.01, tau: 0.035, len: 0.12, noise: 0.05 },
    tom: { f0: 150, f1: 96, pt: 0.05, tau: 0.28, len: 0.7, noise: 0.06 },
    taiko: { f0: 92, f1: 58, pt: 0.06, tau: 0.55, len: 1.4, noise: 0.3 },
    tick: { f0: 2900, f1: 2900, pt: 0.01, tau: 0.008, len: 0.05, noise: 0.15 },
    tamb: { f0: 0, f1: 0, pt: 0.01, tau: 0.09, len: 0.3, noise: 1 },
    cowbell: { f0: 562, f1: 562, pt: 0.01, tau: 0.13, len: 0.4, noise: 0 },
  }[type];
  const n = Math.round(cfg.len * sr);
  const out = scratch(0, n);
  const f = new SVF(sr);
  f.set(type === 'tamb' ? 8500 : type === 'taiko' ? 260 : 1800, type === 'tamb' ? 1.5 : 0.7);
  let ph = 0, ph2 = 0, pe = 1, e = 1;
  const kp = Math.exp(-1 / (cfg.pt * sr)), k = Math.exp(-1 / (cfg.tau * sr));
  const kn = Math.exp(-1 / (Math.min(cfg.tau, 0.05) * sr));
  let en = 1;
  for (let i = 0; i < n; i++) {
    const fr = cfg.f1 + (cfg.f0 - cfg.f1) * pe;
    pe *= kp;
    ph += fr / sr;
    let v = 0;
    if (type === 'cowbell') {
      ph2 += 845 / sr;
      v = (pulse(ph - Math.floor(ph), 562 / sr) + pulse(ph2 - Math.floor(ph2), 845 / sr)) * 0.3;
      f.tick(v); v = f.band * 1.5;
    } else if (type === 'wood') {
      ph2 += 1900 / sr;
      v = sin1(ph) * 0.8 + sin1(ph2) * 0.25;
    } else if (type !== 'tamb') {
      v = sin1(ph);
    }
    if (cfg.noise) {
      f.tick(mx.noise());
      v += (type === 'taiko' ? f.low * 2 : type === 'tamb' ? f.band : f.band) * cfg.noise * (type === 'tamb' ? 1 : en);
    }
    const atk = i < 16 ? i / 16 : 1;
    out[i] = (type === 'taiko' ? ftanh(v * 1.6) : v) * e * atk;
    e *= k; en *= kn;
  }
  emitMono(mx, out, n, at(mx, t), { bus: 'drums', rev: type === 'taiko' ? 0.5 : 0.2, ...s, gain: (s.gain ?? 1) * vel });
}

export function crash(mx: Mix, t: number, vel: number, s: Send = {}): void {
  const { sr } = mx;
  const n = Math.round(2.6 * sr);
  const l = scratch(0, n), r = scratch(1, n);
  const fl = new SVF(sr), fr = new SVF(sr);
  fl.set(5200, 0.8); fr.set(5600, 0.8);
  const k = Math.exp(-1 / (0.75 * sr));
  let e = 1;
  for (let i = 0; i < n; i++) {
    fl.tick(mx.noise()); fr.tick(mx.noise());
    const a = i < 30 ? i / 30 : 1;
    l[i] = fl.high * e * a; r[i] = fr.high * e * a;
    e *= k;
  }
  emitStereo(mx, l, r, n, at(mx, t), { bus: 'drums', rev: 0.3, ...s, gain: (s.gain ?? 1) * vel * 0.32 });
}

/** subida de ruído filtrado que termina em t + dur (antes de uma virada) */
export function riser(mx: Mix, t: number, dur: number, vel: number, s: Send = {}): void {
  const { sr } = mx;
  const n = Math.round(dur * sr);
  const out = scratch(0, n);
  const f = new SVF(sr);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if ((i & 15) === 0) f.set(350 + 7000 * p * p, 1.6);
    f.tick(mx.noise());
    out[i] = f.band * p * p * (p > 0.97 ? (1 - p) / 0.03 : 1);
  }
  emitMono(mx, out, n, at(mx, t), { bus: 'drums', rev: 0.5, ...s, gain: (s.gain ?? 1) * vel * 0.5 });
}

/* =====================================================================
   BAIXO
   ===================================================================== */

export type BassType = 'sub' | 'synth' | 'pluck' | '808' | 'finger' | 'funk' | 'pulse';

export function bass(mx: Mix, t: number, dur: number, midi: number, vel: number, type: BassType, s: Send = {}, glideFrom?: number): void {
  const { sr } = mx;
  const cfg = {
    sub: { a: 0.005, d: 0.3, s: 0.85, r: 0.07 },
    synth: { a: 0.004, d: 0.25, s: 0.7, r: 0.06 },
    pluck: { a: 0.002, d: 0.22, s: 0.15, r: 0.05 },
    '808': { a: 0.003, d: 1.2, s: 0.6, r: 0.08 },
    finger: { a: 0.006, d: 0.5, s: 0.5, r: 0.07 },
    funk: { a: 0.002, d: 0.18, s: 0.45, r: 0.05 },
    pulse: { a: 0.003, d: 0.14, s: 0.3, r: 0.05 },
  }[type];
  const len = Math.round((dur + cfg.r + 0.01) * sr);
  const env = scratch(1, len);
  const total = adsr(env, len, sr, cfg.a, cfg.d, cfg.s, cfg.r, dur);
  const out = scratch(0, total);
  const f = mtof(midi);
  const fFrom = glideFrom !== undefined ? mtof(glideFrom) : f;
  const lp = new SVF(sr);
  let ph = 0, ph2 = 0.37, ph3 = 0.11;
  const kg = Math.exp(-1 / (0.05 * sr));
  let gl = 1;
  let fe = 1;
  const kfe = Math.exp(-1 / ((type === 'funk' ? 0.07 : type === 'pluck' ? 0.09 : 0.22) * sr));
  for (let i = 0; i < total; i++) {
    const fr = f + (fFrom - f) * gl;
    gl *= kg;
    const dt = fr / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    let v: number;
    switch (type) {
      case 'sub':
        v = sin1(ph) + 0.18 * sin1(ph * 2);
        break;
      case '808':
        v = ftanh((sin1(ph) + 0.1 * sin1(ph * 2)) * 2.4) * 0.85;
        break;
      case 'finger': {
        v = sin1(ph) + 0.38 * sin1(ph * 2) + 0.12 * sin1(ph * 3);
        if ((i & 15) === 0) lp.set(700 + 900 * fe * vel, 0.7);
        v = lp.tick(v);
        break;
      }
      case 'synth': {
        ph2 += dt * 1.0035; if (ph2 >= 1) ph2 -= 1;
        v = 0.5 * (saw(ph, dt) + saw(ph2, dt * 1.0035)) * 0.6 + sin1(ph) * 0.7;
        if ((i & 15) === 0) lp.set(220 + 1300 * fe * vel, 0.9);
        v = ftanh(lp.tick(v) * 1.5);
        break;
      }
      case 'pluck': {
        v = saw(ph, dt) * 0.7 + sin1(ph) * 0.6;
        if ((i & 15) === 0) lp.set(160 + 2200 * fe * vel, 1.0);
        v = lp.tick(v);
        break;
      }
      case 'funk': {
        ph3 += dt; if (ph3 >= 1) ph3 -= 1;
        v = pulse(ph3, dt, 0.32) * 0.5 + saw(ph, dt) * 0.4 + sin1(ph) * 0.5;
        if ((i & 15) === 0) lp.set(280 + 2400 * fe * vel, 2.2);
        v = ftanh(lp.tick(v) * 1.3);
        break;
      }
      default: {
        v = saw(ph, dt) * 0.6 + sin1(ph) * 0.6;
        if ((i & 15) === 0) lp.set(250 + 700 * fe, 0.8);
        v = lp.tick(v);
      }
    }
    fe *= kfe;
    out[i] = v * env[i];
  }
  emitMono(mx, out, total, at(mx, t), { rev: 0.02, ...s, gain: (s.gain ?? 1) * vel });
}

/* =====================================================================
   PADS / CORDAS (estéreo, vozes desafinadas)
   ===================================================================== */

export type PadType = 'saw' | 'strings' | 'warm' | 'air' | 'organ';

export function pad(mx: Mix, t: number, dur: number, notes: number[], vel: number, type: PadType, s: Send = {}): void {
  const { sr } = mx;
  const cfg = {
    saw: { a: 0.45, d: 1.2, s: 0.85, r: 0.9, cut: 1700 },
    strings: { a: 0.32, d: 1, s: 0.9, r: 0.7, cut: 2800 },
    warm: { a: 0.22, d: 1.5, s: 0.75, r: 0.8, cut: 2200 },
    air: { a: 1.1, d: 2, s: 0.9, r: 1.6, cut: 3000 },
    organ: { a: 0.012, d: 0.4, s: 0.9, r: 0.12, cut: 5000 },
  }[type];
  const len = Math.round((dur + cfg.r + 0.02) * sr);
  const env = scratch(2, len);
  const total = adsr(env, len, sr, Math.min(cfg.a, dur * 0.6), cfg.d, cfg.s, cfg.r, dur);
  const l = scratch(0, total), r = scratch(1, total);
  const table = type === 'organ' ? WT_ORGAN : type === 'air' ? WT_AIR : WT_WARM;
  const voices = type === 'saw' ? [-9, 0, 9] : type === 'strings' ? [-6, 6] : type === 'organ' ? [0] : [-4, 4];
  const pans = type === 'saw' ? [-0.7, 0, 0.7] : voices.length === 2 ? [-0.6, 0.6] : [0];
  for (let ni = 0; ni < notes.length; ni++) {
    const base = mtof(notes[ni]);
    for (let v = 0; v < voices.length; v++) {
      const cents = voices[v] + (mx.rand() - 0.5) * 4;
      const fr = base * Math.pow(2, cents / 1200);
      const dt = fr / sr;
      const [gl, gr] = panGains(pans[v] * 0.9);
      let ph = mx.rand();
      const vibRate = 4.8 + mx.rand() * 0.8;
      const amp = 1 / Math.sqrt(voices.length);
      for (let i = 0; i < total; i++) {
        let d = dt;
        if (type === 'strings') d *= 1 + 0.0022 * sin1((i / sr) * vibRate);
        ph += d; if (ph >= 1) ph -= 1;
        let x: number;
        if (type === 'saw' || type === 'strings') x = saw(ph, d);
        else x = wt(table, ph);
        x *= amp;
        l[i] += x * gl; r[i] += x * gr;
      }
    }
  }
  const fl = new SVF(sr), fr = new SVF(sr);
  const norm = 0.55 / Math.sqrt(Math.max(1, notes.length));
  for (let i = 0; i < total; i++) {
    if ((i & 31) === 0) {
      const lfo = sin1((t + i / sr) * 0.13);
      const c = cfg.cut * (0.8 + 0.25 * lfo) * (0.7 + 0.4 * vel);
      fl.set(c, 0.6); fr.set(c, 0.6);
    }
    l[i] = fl.tick(l[i]) * env[i] * norm;
    r[i] = fr.tick(r[i]) * env[i] * norm;
  }
  emitStereo(mx, l, r, total, at(mx, t), { rev: 0.45, ...s, gain: (s.gain ?? 1) * vel });
}

/* =====================================================================
   TECLAS / PERCUSSÃO MELÓDICA / CORDAS DEDILHADAS
   ===================================================================== */

export type KeysType = 'epiano' | 'piano' | 'mallet' | 'bell' | 'glock' | 'kalimba' | 'pluck' | 'guitar' | 'uke' | 'harp' | 'stab';

/** Karplus-Strong com afinação fracionária (allpass) */
function karplus(mx: Mix, out: Float32Array, total: number, f: number, gate: number, bright: number, decay: number): void {
  const { sr } = mx;
  const period = sr / f;
  const N = Math.max(2, Math.floor(period - 0.5));
  const frac = period - 0.5 - N;
  const C = (1 - frac) / (1 + frac);
  const buf = new Float32Array(N);
  // excitação: ruído filtrado (palheta), mais escuro com bright baixo
  let lpz = 0;
  const kb = onePoleCoef(800 + 9000 * bright, sr);
  for (let i = 0; i < N; i++) { lpz += (mx.noise() - lpz) * kb; buf[i] = lpz; }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;
  let idx = 0, prev = 0, apx = 0, apy = 0;
  const gateN = Math.round(gate * sr);
  // perda por ciclo → T60 ~ decay segundos
  const loss = Math.pow(0.001, 1 / (decay * f));
  const lossOff = Math.pow(0.001, 1 / (0.12 * f));
  for (let i = 0; i < total; i++) {
    const cur = buf[idx];
    const avg = 0.5 * (cur + prev);
    prev = cur;
    const ap = C * avg + apx - C * apy;
    apx = avg; apy = ap;
    buf[idx] = ap * (i < gateN ? loss : lossOff);
    if (++idx >= N) idx = 0;
    out[i] = cur;
  }
}

export function keys(mx: Mix, t: number, dur: number, midi: number, vel: number, type: KeysType, s: Send = {}): void {
  const { sr } = mx;
  const f = mtof(midi);
  const ring = {
    epiano: 2.2, piano: 3, mallet: 0.9, bell: 1.5, glock: 1.2, kalimba: 1.2, pluck: 0.5, guitar: 2.2, uke: 1.1, harp: 2.6, stab: 0.2,
  }[type];
  const rel = type === 'stab' ? 0.09 : type === 'pluck' ? 0.12 : 0.25;
  const gate = type === 'bell' || type === 'glock' || type === 'kalimba' || type === 'mallet' || type === 'harp' ? dur + ring : dur;
  const len = Math.round((Math.min(gate, dur + ring) + rel + 0.02) * sr);
  const out = scratch(0, len);
  const env = scratch(1, len);
  let total: number;
  switch (type) {
    case 'epiano': {
      total = adsr(env, len, sr, 0.002, ring, 0, rel, dur);
      let pc = 0, pm = 0, pt = 0;
      const idx0 = 1 + 2 * vel;
      const ki = Math.exp(-1 / (0.3 * sr)), kt = Math.exp(-1 / (0.03 * sr));
      let ie = 1, te = 1;
      for (let i = 0; i < total; i++) {
        pc += f / sr; pm += f / sr; pt += (f * 13.9) / sr;
        const I = 0.25 + idx0 * ie;
        out[i] = (sin1(pc + I * sin1(pm) * 0.16) + 0.12 * sin1(pt) * te) * env[i];
        ie *= ki; te *= kt;
      }
      // trêmolo estéreo
      const l = scratch(2, total);
      const r = new Float32Array(total);
      let gl = 0.7, gr = 0.7;
      for (let i = 0; i < total; i++) {
        if ((i & 31) === 0) [gl, gr] = panGains(0.3 * sin1((t + i / sr) * 4.2) + (s.pan ?? 0));
        l[i] = out[i] * gl; r[i] = out[i] * gr;
      }
      emitStereo(mx, l, r, total, at(mx, t), { rev: 0.3, ...s, gain: (s.gain ?? 1) * vel * 0.8 });
      return;
    }
    case 'piano': {
      total = adsr(env, len, sr, 0.002, ring * 1.4, 0, 0.18, dur);
      const parts = 5;
      const B = 0.00035;
      const base = Math.max(0.6, 2.2 * Math.pow(220 / f, 0.35));
      for (let k = 1; k <= parts; k++) {
        const fk = f * k * Math.sqrt(1 + B * k * k);
        if (fk > sr * 0.45) break;
        const amp = Math.pow(k, -1.15) * (k === 1 ? 1 : 0.35 + 0.65 * vel);
        const kd = Math.exp(-1 / ((base / (1 + 0.55 * (k - 1))) * sr));
        let ph = mx.rand(), ph2 = mx.rand(), e = 1;
        const det = 1.0006;
        for (let i = 0; i < total; i++) {
          ph += fk / sr;
          let v = sin1(ph);
          if (k === 1) { ph2 += (fk * det) / sr; v = 0.5 * (v + sin1(ph2)); }
          out[i] += v * amp * e;
          e *= kd;
        }
      }
      // martelo
      const hf = new SVF(sr); hf.set(2200, 0.7);
      const nh = Math.min(total, Math.round(0.012 * sr));
      for (let i = 0; i < nh; i++) { hf.tick(mx.noise()); out[i] += hf.band * 0.12 * (1 - i / nh) * vel; }
      for (let i = 0; i < total; i++) out[i] *= env[i] * 0.55;
      break;
    }
    case 'mallet': {
      total = adsr(env, len, sr, 0.001, 0.1, 1, ring, 0.001);
      let p1 = 0, p2 = 0, p3 = 0;
      const k1 = Math.exp(-1 / (0.38 * sr)), k2 = Math.exp(-1 / (0.06 * sr)), k3 = Math.exp(-1 / (0.02 * sr));
      let e1 = 1, e2 = 1, e3 = 1;
      for (let i = 0; i < total; i++) {
        p1 += f / sr; p2 += (f * 3.93) / sr; p3 += (f * 9.8) / sr;
        out[i] = sin1(p1) * e1 + 0.35 * sin1(p2) * e2 + 0.12 * sin1(p3) * e3;
        e1 *= k1; e2 *= k2; e3 *= k3;
      }
      const tl = Math.min(total, Math.round(sr * 0.005));
      for (let i = 0; i < tl; i++) out[total - 1 - i] *= i / tl;
      break;
    }
    case 'bell':
    case 'glock': {
      total = len;
      let pc = 0, pm = 0, p2 = 0, p3 = 0;
      const kd = Math.exp(-1 / ((type === 'bell' ? 0.5 : 0.4) * sr));
      const ki = Math.exp(-1 / (0.25 * sr));
      let e = 1, ie = 1;
      for (let i = 0; i < total; i++) {
        const a = i < 40 ? i / 40 : 1;
        if (type === 'bell') {
          pc += f / sr; pm += (f * 3.5) / sr;
          out[i] = sin1(pc + (0.4 + 0.9 * ie) * sin1(pm) * 0.16) * e * a;
        } else {
          pc += f / sr; p2 += (f * 2.76) / sr; p3 += (f * 5.4) / sr;
          out[i] = (sin1(pc) + 0.35 * sin1(p2) * ie + 0.15 * sin1(p3) * ie * ie) * e * a;
        }
        e *= kd; ie *= ki;
      }
      const tl = Math.min(total, Math.round(sr * 0.01));
      for (let i = 0; i < tl; i++) out[total - 1 - i] *= i / tl;
      break;
    }
    case 'kalimba': {
      total = len;
      let p1 = 0, p2 = 0;
      const k1 = Math.exp(-1 / (0.42 * sr)), k2 = Math.exp(-1 / (0.03 * sr));
      let e1 = 1, e2 = 1;
      for (let i = 0; i < total; i++) {
        p1 += f / sr; p2 += (f * 5.95) / sr;
        out[i] = (sin1(p1) * e1 + 0.25 * sin1(p2) * e2) * (i < 30 ? i / 30 : 1);
        e1 *= k1; e2 *= k2;
      }
      const tl = Math.min(total, Math.round(sr * 0.01));
      for (let i = 0; i < tl; i++) out[total - 1 - i] *= i / tl;
      break;
    }
    case 'guitar':
    case 'uke':
    case 'harp': {
      total = len;
      const bright = type === 'guitar' ? 0.75 : type === 'uke' ? 0.6 : 0.35;
      karplus(mx, out, total, f, type === 'harp' ? dur + ring : dur, bright * (0.6 + 0.4 * vel), ring);
      // corpo do violão
      const body = Biquad.peak(type === 'uke' ? 380 : 210, sr, 4, 1.2);
      const hp = Biquad.highpass(80, sr);
      const na = Math.round(0.001 * sr);
      for (let i = 0; i < total; i++) out[i] = hp.tick(body.tick(out[i])) * 0.9 * (i < na ? i / na : 1);
      const tl = Math.min(total, Math.round(sr * 0.01));
      for (let i = 0; i < tl; i++) out[total - 1 - i] *= i / tl;
      break;
    }
    case 'pluck':
    case 'stab': {
      total = adsr(env, len, sr, type === 'stab' ? 0.004 : 0.002, type === 'stab' ? 0.15 : 0.35, type === 'stab' ? 0.55 : 0, rel, dur);
      let p1 = mx.rand(), p2 = mx.rand();
      const lp = new SVF(sr);
      let fe = 1;
      const kf = Math.exp(-1 / ((type === 'stab' ? 0.1 : 0.12) * sr));
      for (let i = 0; i < total; i++) {
        const dt = f / sr;
        p1 += dt; if (p1 >= 1) p1 -= 1;
        p2 += dt * 1.004; if (p2 >= 1) p2 -= 1;
        const x = 0.5 * (saw(p1, dt) + saw(p2, dt * 1.004));
        if ((i & 15) === 0) lp.set(type === 'stab' ? 500 + 3200 * fe : 350 + 4200 * fe * vel, 0.9);
        out[i] = lp.tick(x) * env[i];
        fe *= kf;
      }
      break;
    }
  }
  emitMono(mx, out, total, at(mx, t), { rev: 0.3, ...s, gain: (s.gain ?? 1) * vel });
}

/* =====================================================================
   LEADS
   ===================================================================== */

export type LeadType = 'saw' | 'super' | 'square' | 'soft' | 'whistle';

export function lead(mx: Mix, t: number, dur: number, midi: number, vel: number, type: LeadType, s: Send = {}): void {
  const { sr } = mx;
  const cfg = {
    saw: { a: 0.008, d: 0.25, s: 0.7, r: 0.14, cut: 3200 },
    super: { a: 0.006, d: 0.3, s: 0.8, r: 0.18, cut: 5200 },
    square: { a: 0.005, d: 0.2, s: 0.6, r: 0.08, cut: 3000 },
    soft: { a: 0.05, d: 0.4, s: 0.75, r: 0.18, cut: 4000 },
    whistle: { a: 0.04, d: 0.3, s: 0.8, r: 0.12, cut: 6000 },
  }[type];
  const len = Math.round((dur + cfg.r + 0.02) * sr);
  const env = scratch(2, len);
  const total = adsr(env, len, sr, cfg.a, cfg.d, cfg.s, cfg.r, dur);
  const l = scratch(0, total), r = scratch(1, total);
  const f = mtof(midi);
  const det = type === 'super' ? [-14, -6, 0, 6, 14] : type === 'saw' ? [-5, 5] : [0];
  const pans = type === 'super' ? [-0.8, -0.4, 0, 0.4, 0.8] : type === 'saw' ? [-0.3, 0.3] : [0];
  const vibDelay = Math.round(0.22 * sr);
  const breath = new SVF(sr); breath.set(Math.min(f * 2, 8000), 2);
  for (let v = 0; v < det.length; v++) {
    const fr = f * Math.pow(2, det[v] / 1200);
    const [gl, gr] = panGains(pans[v]);
    let ph = mx.rand();
    const amp = 1 / Math.sqrt(det.length);
    for (let i = 0; i < total; i++) {
      const vib = i > vibDelay ? 1 + 0.0045 * Math.min(1, (i - vibDelay) / sr / 0.3) * sin1((i / sr) * 5.4) : 1;
      const dt = (fr * vib) / sr;
      ph += dt; if (ph >= 1) ph -= 1;
      let x: number;
      if (type === 'saw' || type === 'super') x = saw(ph, dt);
      else if (type === 'square') x = pulse(ph, dt, 0.5) * 0.7;
      else if (type === 'soft') {
        breath.tick(mx.noise());
        x = sin1(ph) + 0.18 * sin1(ph * 2) + 0.05 * sin1(ph * 3) + breath.band * 0.08;
      } else {
        x = sin1(ph) + mx.noise() * 0.015;
      }
      x *= amp;
      l[i] += x * gl; r[i] += x * gr;
    }
  }
  const fl = new SVF(sr), fr2 = new SVF(sr);
  fl.set(cfg.cut, 0.7); fr2.set(cfg.cut, 0.7);
  for (let i = 0; i < total; i++) {
    l[i] = fl.tick(l[i]) * env[i] * 0.5;
    r[i] = fr2.tick(r[i]) * env[i] * 0.5;
  }
  emitStereo(mx, l, r, total, at(mx, t), { rev: 0.3, dly: 0.2, ...s, gain: (s.gain ?? 1) * vel });
}

/** chiado e estalos de vinil (lo-fi), direto no barramento de bateria */
export function vinyl(mx: Mix, level: number): void {
  const { sr, n } = mx;
  const f = new SVF(sr); f.set(3500, 0.5);
  for (let i = 0; i < n; i++) {
    f.tick(mx.noise());
    let v = f.band * 0.04;
    if (mx.rand() < 1.2 / sr * 6) v += (mx.rand() - 0.5) * 0.8;
    mx.drums.L[i] += v * level;
    mx.drums.R[i] += v * level;
  }
}

/* não usado diretamente, reexportado para quem quiser compor timbres */
export { blep };
