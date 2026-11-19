/* =====================================================================
   Música · blocos de DSP puros (dono: sessão "musica").
   Tudo em Float32Array, sem WebAudio: roda igual no navegador, num Web
   Worker e nos testes (vitest/node). Determinístico (ruído com semente).
   ===================================================================== */

export const TAU = Math.PI * 2;

/** gerador pseudoaleatório com semente (mulberry32) → [0, 1) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hash de texto → semente de 32 bits (FNV-1a) */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ---------- osciladores ---------- */

const SIN_N = 4096;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin((i / SIN_N) * TAU);

/** seno por tabela (fase em ciclos, qualquer valor) */
export function sin1(phase: number): number {
  const x = phase - Math.floor(phase);
  const f = x * SIN_N;
  const i = f | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (f - i);
}

/** correção polyBLEP (anti-aliasing de dente-de-serra/quadrada) */
export function blep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** dente-de-serra limitada em banda; `ph` em [0,1) */
export function saw(ph: number, dt: number): number {
  return 2 * ph - 1 - blep(ph, dt);
}

/** quadrada/pulso limitada em banda */
export function pulse(ph: number, dt: number, width = 0.5): number {
  let v = ph < width ? 1 : -1;
  v += blep(ph, dt);
  const p2 = ph - width + (ph < width ? 1 : 0);
  v -= blep(p2, dt);
  return v;
}

/* ---------- filtros ---------- */

/** filtro de estado variável TPT (estável), com saídas low/band/high */
export class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private lastCut = -1;
  private lastQ = -1;
  low = 0;
  band = 0;
  high = 0;
  constructor(private sr: number) {}
  set(cutoff: number, q = 0.707): void {
    if (cutoff === this.lastCut && q === this.lastQ) return;
    this.lastCut = cutoff; this.lastQ = q;
    const c = Math.min(Math.max(16, cutoff), this.sr * 0.45);
    this.g = Math.tan((Math.PI * c) / this.sr);
    this.k = 1 / Math.max(0.25, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  tick(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2; this.band = v1; this.high = x - this.k * v1 - v2;
    return v2;
  }
}

/** passa-baixa de 1 polo */
export function onePoleCoef(cutoff: number, sr: number): number {
  return 1 - Math.exp((-TAU * cutoff) / sr);
}

/** biquad (forma direta II transposta) */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(public b0: number, public b1: number, public b2: number, public a1: number, public a2: number) {}
  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  static highpass(f: number, sr: number, q = 0.707): Biquad {
    const w = (TAU * f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }
  static lowpass(f: number, sr: number, q = 0.707): Biquad {
    const w = (TAU * f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }
  static peak(f: number, sr: number, gainDb: number, q = 1): Biquad {
    const A = Math.pow(10, gainDb / 40), w = (TAU * f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    const a0 = 1 + al / A;
    return new Biquad((1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0);
  }
}

/* ---------- envelope ADSR (preenche um buffer, incremental: sem exp por amostra) ---------- */

/**
 * Preenche `out[0..n)` com um ADSR: ataque linear `a`, decaimento exponencial até `s`
 * em ~`d`, sustenta até `gate` e solta exponencialmente em ~`r` (segundos).
 * Devolve o comprimento útil (gate + release).
 */
export function adsr(out: Float32Array, n: number, sr: number, a: number, d: number, s: number, r: number, gate: number): number {
  const na = Math.max(1, Math.round(a * sr));
  const ng = Math.max(1, Math.round(gate * sr));
  const total = Math.min(n, ng + Math.round(r * sr));
  // coeficientes: chega a ~0,1% do alvo em d/r segundos
  const kd = Math.exp(-6.9 / Math.max(1, d * sr));
  const kr = Math.exp(-6.9 / Math.max(1, r * sr));
  let v = 0;
  for (let i = 0; i < total; i++) {
    if (i < ng) {
      if (i < na) v = (i + 1) / na;
      else v = s + (v - s) * kd;
    } else {
      v *= kr;
    }
    out[i] = v;
  }
  // rampa final curtinha para chegar exatamente a zero (sem estalo)
  const tail = Math.min(total, Math.round(sr * 0.004));
  for (let i = 0; i < tail; i++) out[total - 1 - i] *= i / tail;
  for (let i = total; i < n; i++) out[i] = 0;
  return total;
}

/* ---------- reverb (Freeverb: 8 combs + 4 allpass por canal) ---------- */

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];

/**
 * Reverb estéreo a partir de um envio mono. Soma o resultado em `outL/outR`
 * com ganho `wet`. `room` 0..1 (tamanho), `damp` 0..1 (abafamento dos agudos).
 */
export function freeverb(send: Float32Array, n: number, sr: number, outL: Float32Array, outR: Float32Array, room: number, damp: number, wet: number, preDelay = 0.02): void {
  const scale = sr / 44100;
  const fb = 0.7 + 0.28 * Math.min(1, Math.max(0, room));
  const d1 = 0.05 + 0.4 * Math.min(1, Math.max(0, damp));
  const d2 = 1 - d1;
  const pre = Math.max(0, Math.round(preDelay * sr));
  const mk = (spread: number) => ({
    combs: COMBS.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0, f: 0 })),
    aps: ALLPASS.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0 })),
  });
  const chans = [mk(0), mk(23)];
  const outs = [outL, outR];
  // passa-alta no envio (tira o grave que embola o reverb)
  const hp = Biquad.highpass(180, sr, 0.6);
  const lp = Biquad.lowpass(9000, sr, 0.6);
  const inp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - pre;
    inp[i] = j >= 0 ? lp.tick(hp.tick(send[j])) * 0.015 : 0;
  }
  for (let c = 0; c < 2; c++) {
    const { combs, aps } = chans[c];
    const out = outs[c];
    for (let i = 0; i < n; i++) {
      const x = inp[i];
      let acc = 0;
      for (let k = 0; k < 8; k++) {
        const cb = combs[k];
        const y = cb.buf[cb.i];
        cb.f = y * d2 + cb.f * d1;
        cb.buf[cb.i] = x + cb.f * fb;
        if (++cb.i >= cb.buf.length) cb.i = 0;
        acc += y;
      }
      for (let k = 0; k < 4; k++) {
        const ap = aps[k];
        const b = ap.buf[ap.i];
        ap.buf[ap.i] = acc + b * 0.5;
        if (++ap.i >= ap.buf.length) ap.i = 0;
        acc = b - acc;
      }
      out[i] += acc * wet;
    }
  }
}

/** delay pingue-pongue sincronizado (envio mono → estéreo) */
export function pingPong(send: Float32Array, n: number, sr: number, outL: Float32Array, outR: Float32Array, time: number, feedback: number, wet: number): void {
  const len = Math.max(1, Math.round(time * sr));
  const bl = new Float32Array(len), br = new Float32Array(len);
  let i = 0;
  let fl = 0, fr = 0;
  const k = onePoleCoef(4500, sr);
  const hk = onePoleCoef(250, sr);
  let hpL = 0;
  for (let s = 0; s < n; s++) {
    const yl = bl[i], yr = br[i];
    // L recebe o envio; o eco atravessa para R e volta (pingue-pongue), filtrado
    fl += (yr - fl) * k;
    fr += (yl - fr) * k;
    hpL += (send[s] - hpL) * hk;
    bl[i] = send[s] - hpL + fl * feedback;
    br[i] = fr * feedback;
    outL[s] += yl * wet;
    outR[s] += yr * wet;
    if (++i >= len) i = 0;
  }
}

/* ---------- reamostragem 2× (sinc janelado, polifásico) ---------- */

const UP_TAPS = 12;
const UP_K: Float32Array = (() => {
  const k = new Float32Array(UP_TAPS * 2);
  for (let j = 0; j < UP_TAPS * 2; j++) {
    const x = j - UP_TAPS + 0.5; // posições meio-amostra
    const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / (UP_TAPS + 0.5)) + 0.08 * Math.cos((2 * Math.PI * x) / (UP_TAPS + 0.5));
    k[j] = (Math.sin(Math.PI * x) / (Math.PI * x)) * w;
  }
  let sum = 0;
  for (let j = 0; j < k.length; j++) sum += k[j];
  for (let j = 0; j < k.length; j++) k[j] /= sum;
  return k;
})();

/** dobra a taxa de amostragem (`outLen` amostras); amostras pares = originais */
export function upsample2(x: Float32Array, outLen: number): Float32Array {
  const out = new Float32Array(outLen);
  const n = x.length;
  for (let i = 0; i < outLen; i++) {
    const h = i >> 1;
    if ((i & 1) === 0) { out[i] = h < n ? x[h] : 0; continue; }
    let acc = 0;
    const base = h - UP_TAPS + 1;
    for (let j = 0; j < UP_TAPS * 2; j++) {
      const idx = base + j;
      if (idx >= 0 && idx < n) acc += x[idx] * UP_K[j];
    }
    out[i] = acc;
  }
  return out;
}

/* ---------- loudness (LUFS aproximado, ITU-R BS.1770: ponderação K + gates) ---------- */

function kFilters(sr: number): [Biquad, Biquad] {
  // estágio 1: prateleira alta (+4 dB ~1,7 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // estágio 2: passa-alta (~38 Hz)
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const s2 = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [s1, s2];
}

/** loudness integrada (LUFS) de um sinal estéreo */
export function lufs(ch: Float32Array[], sr: number): number {
  const n = ch[0].length;
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  if (n < block) {
    // trecho curto: média simples ponderada
    let z = 0;
    for (const c of ch) {
      const [a, b] = kFilters(sr);
      for (let i = 0; i < n; i++) { const y = b.tick(a.tick(c[i])); z += y * y; }
    }
    return -0.691 + 10 * Math.log10(z / Math.max(1, n) + 1e-12);
  }
  const nHops = Math.floor(n / hop);
  const hopZ = new Float64Array(nHops);
  for (const c of ch) {
    const [a, b] = kFilters(sr);
    for (let h = 0; h < nHops; h++) {
      let z = 0;
      const e = (h + 1) * hop;
      for (let i = h * hop; i < e; i++) { const y = b.tick(a.tick(c[i])); z += y * y; }
      hopZ[h] += z;
    }
  }
  const per = block / hop;
  const zs: number[] = [];
  for (let h = 0; h + per <= nHops; h++) {
    let z = 0;
    for (let k = 0; k < per; k++) z += hopZ[h + k];
    zs.push(z / block);
  }
  const L = (z: number) => -0.691 + 10 * Math.log10(z + 1e-12);
  const abs = zs.filter((z) => L(z) > -70);
  if (!abs.length) return -70;
  const rel = L(abs.reduce((s, z) => s + z, 0) / abs.length) - 10;
  const gated = abs.filter((z) => L(z) > rel);
  return L(gated.reduce((s, z) => s + z, 0) / Math.max(1, gated.length));
}

/* ---------- dinâmica ---------- */

/**
 * Limitador com antecipação: garante |x| ≤ ceiling sem cortar a onda
 * (o ganho desce em rampa antes do pico e sobe devagar depois).
 */
export function limit(ch: Float32Array[], sr: number, ceiling: number, attack = 0.002, release = 0.12): void {
  const n = ch[0].length;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of ch) { const a = Math.abs(c[i]); if (a > m) m = a; }
    g[i] = m > ceiling ? ceiling / m : 1;
  }
  const up = 1 / Math.max(1, attack * sr);
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + up);
  const rel = 1 / Math.max(1, release * sr);
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + rel);
  for (const c of ch) for (let i = 0; i < n; i++) {
    const v = c[i] * g[i];
    c[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
  }
}

/** pico absoluto */
export function peakOf(ch: Float32Array[]): number {
  let m = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
  return m;
}

/** pan de potência constante: -1 (esq.) .. 1 (dir.) → [gL, gR] */
export function panGains(pan: number): [number, number] {
  const p = (Math.min(1, Math.max(-1, pan)) + 1) * (Math.PI / 4);
  return [Math.cos(p), Math.sin(p)];
}

/** tanh rápida (aproximação racional de Padé, erro < 0,3% e saturação suave em ±1) */
export function ftanh(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
