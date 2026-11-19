/* =====================================================================
   Biblioteca · efeitos sonoros SINTETIZADOS (dono: sessão "biblioteca").
   Nada de arquivo de áudio: cada efeito é gerado por DSP puro em JS
   (osciladores, ruído determinístico, envelopes e filtros) -> PCM -> WAV.
   Funciona igual no navegador, em worker e nos testes (sem WebAudio).
   ===================================================================== */
import type { AudioClip, Id, MediaAsset, Project, Seconds } from '../types';
import { clipEnd, type EditOp } from '../ops';
import { makeAudioClip } from '../defaults';
import { encodeWav } from '../media/wav';
import { uid } from '../util';

export type SfxCategory = 'transicao' | 'interface' | 'impacto' | 'efeito';

export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = {
  transicao: 'Transição', interface: 'Interface', impacto: 'Impacto', efeito: 'Efeito',
};

export interface SfxDef {
  id: string;
  name: string;
  category: SfxCategory;
  /** duração em segundos */
  duration: Seconds;
  description: string;
  /** volume sugerido do AudioClip */
  volume?: number;
}

export const SFX_CATALOG: SfxDef[] = [
  { id: 'whoosh', name: 'Whoosh', category: 'transicao', duration: 0.9, description: 'Passagem de ar com filtro varrendo.' },
  { id: 'swoosh', name: 'Swoosh curto', category: 'transicao', duration: 0.4, description: 'Passada rápida para cortes.' },
  { id: 'riser', name: 'Subida (riser)', category: 'transicao', duration: 2.2, description: 'Tensão crescendo antes da virada.' },
  { id: 'drop', name: 'Queda (drop)', category: 'transicao', duration: 1.2, description: 'Descida grave depois da tensão.' },
  { id: 'pop', name: 'Pop', category: 'interface', duration: 0.18, description: 'Estalo curto para textos e stickers.' },
  { id: 'click', name: 'Clique', category: 'interface', duration: 0.08, description: 'Clique seco de botão.' },
  { id: 'ding', name: 'Ding', category: 'interface', duration: 1.1, description: 'Sininho agudo de acerto.' },
  { id: 'notificacao', name: 'Notificação', category: 'interface', duration: 0.6, description: 'Dois toques de aviso.' },
  { id: 'teclado', name: 'Digitação', category: 'interface', duration: 1.4, description: 'Teclas sendo digitadas.' },
  { id: 'erro', name: 'Erro (buzzer)', category: 'interface', duration: 0.6, description: 'Zumbido de resposta errada.' },
  { id: 'impacto', name: 'Impacto grave', category: 'impacto', duration: 1.4, description: 'Boom grave para revelações.' },
  { id: 'sino', name: 'Sino', category: 'impacto', duration: 2.4, description: 'Badalada metálica longa.' },
  { id: 'glitch', name: 'Glitch', category: 'efeito', duration: 0.5, description: 'Falha digital picotada.' },
  { id: 'caixa-registradora', name: 'Caixa registradora', category: 'efeito', duration: 1, description: 'Ding de venda com mecânica.' },
  { id: 'aplausos', name: 'Aplausos', category: 'efeito', duration: 2.5, description: 'Plateia aplaudindo.', volume: 0.8 },
  { id: 'obturador', name: 'Obturador de câmera', category: 'efeito', duration: 0.3, description: 'Clique de foto.' },
  { id: 'riser-longo', name: 'Subida longa', category: 'transicao', duration: 4.5, description: 'Tensão lenta crescendo por vários segundos.' },
  { id: 'boom-grave', name: 'Boom de impacto', category: 'impacto', duration: 2.4, description: 'Impacto grave e longo, com cauda.' },
  { id: 'swipe', name: 'Swipe', category: 'transicao', duration: 0.3, description: 'Deslizar de dedo na tela.' },
  { id: 'tick-tock', name: 'Tique-taque', category: 'efeito', duration: 2, description: 'Relógio marcando os segundos.' },
  { id: 'notificacao-suave', name: 'Notificação suave', category: 'interface', duration: 0.9, description: 'Aviso delicado e redondo.' },
  { id: 'ding-duplo', name: 'Ding duplo', category: 'interface', duration: 1.2, description: 'Dois dings de acerto.' },
  { id: 'glitch-curto', name: 'Glitch curto', category: 'efeito', duration: 0.2, description: 'Falha digital rapidinha.' },
  { id: 'sino-loja', name: 'Sino de loja', category: 'efeito', duration: 1.6, description: 'Sininho de porta de loja.' },
];

const BY_ID = new Map(SFX_CATALOG.map((s) => [s.id, s]));

export function sfxDef(id: string): SfxDef | undefined {
  return BY_ID.get(id);
}

/* ---------- blocos de DSP ---------- */

const TAU = Math.PI * 2;

/** ruído branco determinístico (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** filtro de estado variável TPT (estável em qualquer frequência), cutoff variável por amostra */
function svf(sr: number) {
  let ic1 = 0, ic2 = 0;
  return (x: number, cutoff: number, q = 0.7) => {
    const g = Math.tan((Math.PI * Math.min(Math.max(20, cutoff), sr * 0.45)) / sr);
    const k = 1 / Math.max(0.3, q);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return { low: v2, band: v1, high: x - k * v1 - v2 };
  };
}

const expDecay = (t: number, tau: number) => Math.exp(-t / tau);
const attack = (t: number, a: number) => (a <= 0 ? 1 : Math.min(1, t / a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Synth = (n: number, sr: number) => Float32Array;

function buf(n: number) { return new Float32Array(n); }

const SYNTHS: Record<string, Synth> = {
  whoosh: (n, sr) => {
    const out = buf(n), noise = rng(11), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const env = Math.sin(Math.PI * Math.pow(p, 0.8)) ** 2;
      const cut = 300 * Math.pow(18, Math.sin(Math.PI * p));
      out[i] = f(noise(), cut, 1.6).band * env * 1.6;
    }
    return out;
  },
  swoosh: (n, sr) => {
    const out = buf(n), noise = rng(23), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.25)), 3);
      out[i] = f(noise(), 600 + 7000 * p, 2.2).band * env * 1.8;
    }
    return out;
  },
  riser: (n, sr) => {
    const out = buf(n), noise = rng(5), f = svf(sr);
    let ph1 = 0, ph2 = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const fr = 180 * Math.pow(8, p);
      ph1 += (TAU * fr) / sr; ph2 += (TAU * fr * 1.007) / sr;
      const saw = ((ph1 / TAU) % 1) * 2 - 1;
      const saw2 = ((ph2 / TAU) % 1) * 2 - 1;
      const nz = f(noise(), 400 + 9000 * p * p, 1.2).band;
      const env = Math.pow(p, 1.6) * (1 - Math.pow(Math.max(0, p - 0.97) / 0.03, 2));
      out[i] = (0.28 * (saw + saw2) + 0.7 * nz) * env;
    }
    return out;
  },
  drop: (n, sr) => {
    const out = buf(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, p = i / n;
      const fr = lerp(900, 38, Math.pow(p, 0.35));
      ph += (TAU * fr) / sr;
      out[i] = Math.sin(ph) * expDecay(t, 0.55) * attack(t, 0.005) * (1 - p * 0.2);
    }
    return out;
  },
  pop: (n, sr) => {
    const out = buf(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fr = 260 + 900 * expDecay(t, 0.012);
      ph += (TAU * fr) / sr;
      out[i] = Math.sin(ph) * expDecay(t, 0.035) * attack(t, 0.001);
    }
    return out;
  },
  click: (n, sr) => {
    const out = buf(n), noise = rng(7), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr - 0.002;
      const nz = f(noise(), 3800, 3).band;
      out[i] = t < 0 ? 0 : nz * expDecay(t, 0.006) * 2.4 + Math.sin(TAU * 1800 * t) * expDecay(t, 0.004) * 0.5;
    }
    return out;
  },
  ding: (n, sr) => {
    const out = buf(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = (Math.sin(TAU * 1760 * t) * 0.6 + Math.sin(TAU * 3520 * t) * 0.25 * expDecay(t, 0.12) + Math.sin(TAU * 5280 * t) * 0.1 * expDecay(t, 0.06))
        * expDecay(t, 0.32) * attack(t, 0.002);
    }
    return out;
  },
  notificacao: (n, sr) => {
    const out = buf(n);
    const tone = (t: number, fr: number) => (t < 0 ? 0 : (Math.sin(TAU * fr * t) + 0.3 * Math.sin(TAU * fr * 2 * t)) * expDecay(t, 0.09) * attack(t, 0.003));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = 0.6 * (tone(t, 988) + tone(t - 0.14, 1319));
    }
    return out;
  },
  teclado: (n, sr) => {
    const out = buf(n), noise = rng(31), f = svf(sr), jitter = rng(77);
    const hits: number[] = [];
    for (let t = 0.02; t < n / sr - 0.08; t += 0.075 + Math.abs(jitter()) * 0.09) hits.push(t);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (const h of hits) {
        const d = t - h;
        if (d >= 0 && d < 0.05) s += expDecay(d, 0.007) * (0.7 + 0.3 * Math.sin(h * 999));
      }
      out[i] = f(noise(), 2600, 1.5).band * s * 2.2;
    }
    return out;
  },
  erro: (n, sr) => {
    const out = buf(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr, p = i / n;
      const sq = Math.sign(Math.sin(TAU * 110 * t)) * 0.5 + Math.sign(Math.sin(TAU * 116.5 * t)) * 0.5;
      out[i] = sq * 0.45 * attack(t, 0.01) * (p > 0.85 ? (1 - p) / 0.15 : 1);
    }
    return out;
  },
  impacto: (n, sr) => {
    const out = buf(n), noise = rng(41), f = svf(sr);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fr = 42 + 110 * expDecay(t, 0.05);
      ph += (TAU * fr) / sr;
      const body = Math.sin(ph) * expDecay(t, 0.45);
      const hit = f(noise(), 900, 0.8).low * expDecay(t, 0.06) * 2.5;
      out[i] = Math.tanh((body + hit) * 1.6) * attack(t, 0.001);
    }
    return out;
  },
  sino: (n, sr) => {
    const out = buf(n);
    // parciais inarmônicos típicos de sino
    const parts = [[1, 1, 1.4], [2.0, 0.6, 1], [2.76, 0.45, 0.7], [5.4, 0.3, 0.45], [8.93, 0.18, 0.3]];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (const [r, a, d] of parts) s += Math.sin(TAU * 440 * r * t) * a * expDecay(t, d);
      out[i] = s * 0.45 * attack(t, 0.002);
    }
    return out;
  },
  glitch: (n, sr) => {
    const out = buf(n), noise = rng(99), pick = rng(3);
    const block = Math.round(sr * 0.022);
    let mode = 0, fr = 400, ph = 0;
    for (let i = 0; i < n; i++) {
      if (i % block === 0) { mode = Math.floor((pick() + 1) * 2); fr = 200 + Math.abs(pick()) * 2200; }
      ph += (TAU * fr) / sr;
      const v = mode === 0 ? noise() : mode === 1 ? Math.sign(Math.sin(ph)) : mode === 2 ? Math.round(Math.sin(ph) * 3) / 3 : 0;
      out[i] = v * 0.55 * (1 - i / n * 0.3);
    }
    return out;
  },
  'caixa-registradora': (n, sr) => {
    const out = buf(n), noise = rng(55), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const mech = t < 0.12 ? f(noise(), 1800, 1.2).band * expDecay(t, 0.03) * 1.5 + (t > 0.06 ? f(noise(), 2500, 2).band * expDecay(t - 0.06, 0.015) : 0) : 0;
      const tb = t - 0.12;
      const bell = tb >= 0 ? (Math.sin(TAU * 2093 * tb) + 0.5 * Math.sin(TAU * 2637 * tb) + 0.3 * Math.sin(TAU * 4186 * tb)) * expDecay(tb, 0.28) * 0.5 : 0;
      out[i] = mech + bell;
    }
    return out;
  },
  aplausos: (n, sr) => {
    const out = buf(n), noise = rng(13), when = rng(17), f = svf(sr);
    const claps: number[] = [];
    const dur = n / sr;
    for (let k = 0; k < dur * 55; k++) claps.push(Math.abs(when()) * dur);
    claps.sort((a, b) => a - b);
    let j = 0;
    const active: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      while (j < claps.length && claps[j] <= t) active.push(claps[j++]);
      let s = 0;
      for (let k = active.length - 1; k >= 0; k--) {
        const d = t - active[k];
        if (d > 0.04) { active.splice(k, 1); continue; }
        s += expDecay(d, 0.008);
      }
      const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.6);
      out[i] = f(noise(), 1400, 0.9).band * (0.25 + s) * env * 1.3;
    }
    return out;
  },
  obturador: (n, sr) => {
    const out = buf(n), noise = rng(61), f = svf(sr);
    const clk = (d: number, c: number) => (d >= 0 && d < 0.05 ? expDecay(d, 0.006) * c : 0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = f(noise(), 3200, 1.4).band * (clk(t, 1) + clk(t - 0.11, 0.8)) * 3 + f(noise(), 600, 1).band * (t < 0.12 ? 0.25 : 0);
    }
    return out;
  },
  'riser-longo': (n, sr) => {
    const out = buf(n), noise = rng(91), f = svf(sr);
    let ph1 = 0, ph2 = 0, ph3 = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const fr = 90 * Math.pow(10, p);
      ph1 += (TAU * fr) / sr; ph2 += (TAU * fr * 1.005) / sr; ph3 += (TAU * fr * 0.5) / sr;
      const saw = ((ph1 / TAU) % 1) * 2 - 1, saw2 = ((ph2 / TAU) % 1) * 2 - 1;
      const nz = f(noise(), 250 + 8000 * p * p, 1.4).band;
      const trem = 1 + 0.25 * Math.sin(TAU * (2 + 10 * p) * (i / sr));
      const env = Math.pow(p, 2) * (1 - Math.pow(Math.max(0, p - 0.98) / 0.02, 2));
      out[i] = (0.25 * (saw + saw2) + 0.3 * Math.sin(ph3) + 0.6 * nz) * env * trem;
    }
    return out;
  },
  'boom-grave': (n, sr) => {
    const out = buf(n), noise = rng(43), f = svf(sr), f2 = svf(sr);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fr = 34 + 90 * expDecay(t, 0.08);
      ph += (TAU * fr) / sr;
      const body = Math.sin(ph) * expDecay(t, 0.9);
      const hit = f(noise(), 700, 0.8).low * expDecay(t, 0.08) * 2.2;
      const tail = f2(noise(), 180, 0.7).low * expDecay(t, 0.7) * 1.5;
      out[i] = Math.tanh((body + hit + tail) * 1.8) * attack(t, 0.001);
    }
    return out;
  },
  swipe: (n, sr) => {
    const out = buf(n), noise = rng(29), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const env = Math.sin(Math.PI * p) ** 2;
      out[i] = f(noise(), 1500 + 9000 * Math.pow(p, 1.5), 3).band * env * 2;
    }
    return out;
  },
  'tick-tock': (n, sr) => {
    const out = buf(n), noise = rng(83), f = svf(sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = Math.floor(t / 0.5), d = t - k * 0.5;
      const fr = k % 2 === 0 ? 3200 : 2300;
      const nz = f(noise(), fr, 6).band;
      out[i] = d < 0.04 ? (nz * 2 + Math.sin(TAU * fr * d) * 0.6) * expDecay(d, 0.006) : nz * 0;
    }
    return out;
  },
  'notificacao-suave': (n, sr) => {
    const out = buf(n);
    const tone = (t: number, fr: number) => (t < 0 ? 0 : (Math.sin(TAU * fr * t) + 0.15 * Math.sin(TAU * fr * 3 * t)) * expDecay(t, 0.22) * attack(t, 0.012));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = 0.5 * (tone(t, 659) + tone(t - 0.12, 880) * 0.8);
    }
    return out;
  },
  'ding-duplo': (n, sr) => {
    const out = buf(n);
    const ding = (t: number, fr: number) => (t < 0 ? 0 : (Math.sin(TAU * fr * t) * 0.6 + Math.sin(TAU * fr * 2 * t) * 0.25 * expDecay(t, 0.1)) * expDecay(t, 0.28) * attack(t, 0.002));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = ding(t, 1568) + ding(t - 0.16, 2093);
    }
    return out;
  },
  'glitch-curto': (n, sr) => {
    const out = buf(n), noise = rng(7), pick = rng(19);
    const block = Math.round(sr * 0.015);
    let mode = 0, fr = 800, ph = 0;
    for (let i = 0; i < n; i++) {
      if (i % block === 0) { mode = Math.floor((pick() + 1) * 1.5); fr = 300 + Math.abs(pick()) * 3000; }
      ph += (TAU * fr) / sr;
      out[i] = (mode === 0 ? noise() : mode === 1 ? Math.sign(Math.sin(ph)) : Math.round(Math.sin(ph) * 2) / 2) * 0.6;
    }
    return out;
  },
  'sino-loja': (n, sr) => {
    const out = buf(n);
    const bell = (t: number, fr: number, a: number) => (t < 0 ? 0 : (Math.sin(TAU * fr * t) + 0.5 * Math.sin(TAU * fr * 2.76 * t) * expDecay(t, 0.2) + 0.3 * Math.sin(TAU * fr * 5.4 * t) * expDecay(t, 0.1)) * a * expDecay(t, 0.45) * attack(t, 0.002));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = bell(t, 2349, 0.5) + bell(t - 0.09, 2637, 0.4) + bell(t - 0.2, 2349, 0.3) + bell(t - 0.33, 2794, 0.2);
    }
    return out;
  },
};

/** normaliza o pico para `peak` e aplica rampa curta nas bordas (sem estalo) */
function finish(x: Float32Array, sr: number, peak = 0.89): Float32Array {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  const g = max > 1e-6 ? peak / max : 0;
  const rampIn = Math.min(Math.round(sr * 0.0008), Math.floor(x.length / 8));
  const rampOut = Math.min(Math.round(sr * 0.004), Math.floor(x.length / 4));
  for (let i = 0; i < x.length; i++) {
    let e = 1;
    if (i < rampIn) e = i / rampIn;
    else if (i > x.length - rampOut) e = (x.length - i) / rampOut;
    x[i] = x[i] * g * e;
  }
  return x;
}

/** gera o PCM (estéreo, canais iguais com leve alargamento nos de ruído) */
export function renderSfx(id: string, sampleRate = 44100): Float32Array[] {
  const def = sfxDef(id);
  const synth = SYNTHS[id];
  if (!def || !synth) throw new Error(`efeito sonoro desconhecido: ${id}`);
  const n = Math.max(1, Math.round(def.duration * sampleRate));
  const mono = finish(synth(n, sampleRate), sampleRate);
  const right = new Float32Array(n);
  // atraso de ~0,4 ms no canal direito dá sensação de largura sem mudar o timbre
  const d = Math.round(sampleRate * 0.0004);
  for (let i = 0; i < n; i++) right[i] = i >= d ? mono[i - d] : 0;
  return [mono, right];
}

/** WAV (ArrayBuffer) do efeito — puro */
export function sfxWav(id: string, sampleRate = 44100): ArrayBuffer {
  return encodeWav(renderSfx(id, sampleRate), sampleRate);
}

/** Blob audio/wav do efeito (cacheado) */
const blobCache = new Map<string, Blob>();
export async function synthSfx(id: string, sampleRate = 44100): Promise<Blob> {
  const key = `${id}@${sampleRate}`;
  const hit = blobCache.get(key);
  if (hit) return hit;
  // cede o laço de eventos antes do trabalho pesado (efeitos longos ~50 ms)
  await new Promise((r) => setTimeout(r, 0));
  const blob = new Blob([sfxWav(id, sampleRate)], { type: 'audio/wav' });
  blobCache.set(key, blob);
  return blob;
}

/** lê duração de um WAV PCM a partir do cabeçalho (usado nos testes e na UI) */
export function wavInfo(buf: ArrayBuffer): { sampleRate: number; channels: number; bits: number; duration: Seconds } | null {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  const dataLen = v.getUint32(40, true);
  return { sampleRate, channels, bits, duration: dataLen / (sampleRate * channels * (bits / 8)) };
}

/* ---------- inserção no projeto ---------- */

/** trilha de áudio livre em [at, at+dur] (ou nova) + op do AudioClip — puro */
export function sfxClipOps(p: Project, asset: MediaAsset, at: Seconds, opts: { volume?: number; id?: Id } = {}): EditOp[] {
  const dur = asset.duration || 0.5;
  const busy = (t: Project['tracks'][number]) => t.clips.some((c) => c.start < at + dur - 1e-6 && clipEnd(c) > at + 1e-6);
  const isSfxTrack = (t: Project['tracks'][number]) => /efeito|sfx/i.test(t.name) || (t.clips.length > 0 && t.clips.every((c) => c.label?.startsWith('SFX')));
  const free = p.tracks.find((t) => t.kind === 'audio' && !t.locked && isSfxTrack(t) && !busy(t));
  const ops: EditOp[] = [];
  let trackId = free?.id;
  if (!trackId) {
    trackId = uid('track_sfx');
    const n = p.tracks.filter((t) => /efeito|sfx/i.test(t.name)).length;
    ops.push({ op: 'add_track', track: { id: trackId, kind: 'audio', name: n ? `Efeitos sonoros ${n + 1}` : 'Efeitos sonoros' }, explain: 'Nova trilha de efeitos sonoros' });
  }
  const clip: AudioClip = makeAudioClip(asset, Math.max(0, at), { id: opts.id ?? uid('clip'), label: `SFX · ${asset.name.replace(/\.wav$/i, '')}`, volume: opts.volume ?? 1, duration: dur });
  ops.push({ op: 'add_clip', trackId, clip, explain: `Efeito sonoro “${asset.name.replace(/\.wav$/i, '')}”` });
  return ops;
}

/**
 * Gera o efeito, ingere como asset (role 'music', marcado `library`) e coloca
 * um AudioClip no playhead — num único dispatch (1 desfazer). Navegador.
 */
export async function insertSfx(id: string, opts: { at?: Seconds } = {}): Promise<MediaAsset | null> {
  const def = sfxDef(id);
  if (!def) return null;
  const [{ useEditor }, { ingestFile }] = await Promise.all([import('../store'), import('../media/ingest')]);
  const st = useEditor.getState();
  const name = `${def.name}.wav`;
  let asset = Object.values(st.assets).find((a) => a.library && a.name === name && a.url);
  if (!asset) {
    const blob = await synthSfx(id);
    const file = new File([blob], name, { type: 'audio/wav' });
    asset = await ingestFile(file, 'music');
    useEditor.getState().updateAsset(asset.id, { library: true });
    asset = { ...asset, library: true };
  }
  const now = useEditor.getState();
  now.dispatch(sfxClipOps(now.project, asset, opts.at ?? now.playhead, { volume: def.volume }));
  return asset;
}

/** toca uma prévia (sem inserir). Retorna função para parar. Navegador. */
export async function previewSfx(id: string): Promise<() => void> {
  const blob = await synthSfx(id);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const stop = () => { audio.pause(); URL.revokeObjectURL(url); };
  audio.onended = stop;
  await audio.play().catch(() => stop());
  return stop;
}
