/* =====================================================================
   Efeitos de voz (AudioEffect) e tom (pitch) como grafo WebAudio.
   Mesmo construtor serve ao preview (AudioContext + <video>/<audio>) e ao
   export (OfflineAudioContext). Pitch mantendo a duração: deslocador por
   linhas de atraso moduladas (técnica "Jungle"), só com nós nativos.
   ===================================================================== */
import type { AudioEffect, AudioEffectKind } from '../types';

export const AUDIO_EFFECT_LABELS: Record<AudioEffectKind, string> = {
  'noise-reduction': 'Redução de ruído', normalize: 'Normalizar', 'voice-enhance': 'Realçar voz', chipmunk: 'Esquilo',
  deep: 'Voz grave', robot: 'Robô', echo: 'Eco', reverb: 'Reverb', telephone: 'Telefone', megaphone: 'Megafone',
  'bass-boost': 'Grave reforçado',
};

export interface FxChain {
  input: AudioNode;
  output: AudioNode;
  /** para os osciladores/fontes internas */
  stop(): void;
}

const amt = (e: AudioEffect) => Math.max(0, Math.min(1, e.amount ?? 0.6));

/** semitons totais: pitch do clipe + esquilo/grave */
export function totalSemitones(effects: AudioEffect[] | undefined, pitch: number | undefined): number {
  let s = pitch ?? 0;
  for (const e of effects ?? []) {
    if (e.kind === 'chipmunk') s += 4 + 8 * amt(e);
    if (e.kind === 'deep') s -= 3 + 6 * amt(e);
  }
  return Math.max(-12, Math.min(12, s));
}

/** precisa de grafo? (sem efeitos nem tom, o áudio vai direto) */
export function needsAudioChain(effects: AudioEffect[] | undefined, pitch: number | undefined): boolean {
  return Math.abs(totalSemitones(effects, pitch)) > 0.01 || !!effects?.some((e) => e.kind !== 'chipmunk' && e.kind !== 'deep' && amt(e) > 0);
}

/** chave estável p/ saber se o grafo precisa ser refeito */
export function chainKey(effects: AudioEffect[] | undefined, pitch: number | undefined): string {
  return JSON.stringify([pitch ?? 0, (effects ?? []).map((e) => [e.kind, Math.round(amt(e) * 100)])]);
}

/* ---------- pitch shifter (Jungle) ---------- */

const DELAY = 0.1, FADE = 0.05, BUF = 0.1;

function fadeBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const l1 = Math.round(BUF * sr), l2 = Math.round((BUF - 2 * FADE) * sr), len = l1 + l2;
  const fl = Math.round(FADE * sr);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < l1; i++) {
    d[i] = i < fl ? Math.sqrt(i / fl) : i >= l1 - fl ? Math.sqrt(1 - (i - (l1 - fl)) / fl) : 1;
  }
  return b;
}

function delayBuffer(ctx: BaseAudioContext, up: boolean): AudioBuffer {
  const sr = ctx.sampleRate;
  const l1 = Math.round(BUF * sr), l2 = Math.round((BUF - 2 * FADE) * sr), len = l1 + l2;
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < l1; i++) d[i] = up ? (l1 - i) / len : i / l1;
  return b;
}

export function pitchShifter(ctx: BaseAudioContext, semitones: number, startAt = 0): FxChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const ratio = Math.pow(2, semitones / 12);
  const up = ratio > 1;
  const mult = up ? Math.min(1, ratio - 1) : Math.min(1, 1 - ratio);
  const sources: AudioScheduledSourceNode[] = [];
  const mkSrc = (buf: AudioBuffer, offset: number) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.start(startAt + offset);
    sources.push(s);
    return s;
  };
  const dBuf = delayBuffer(ctx, up);
  const fBuf = fadeBuffer(ctx);
  const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
  const g1 = ctx.createGain(), g2 = ctx.createGain();
  g1.gain.value = DELAY * mult; g2.gain.value = DELAY * mult;
  mkSrc(dBuf, 0).connect(g1).connect(d1.delayTime);
  mkSrc(dBuf, BUF - FADE).connect(g2).connect(d2.delayTime);
  const m1 = ctx.createGain(), m2 = ctx.createGain();
  m1.gain.value = 0; m2.gain.value = 0;
  mkSrc(fBuf, 0).connect(m1.gain);
  mkSrc(fBuf, BUF - FADE).connect(m2.gain);
  input.connect(d1).connect(m1).connect(output);
  input.connect(d2).connect(m2).connect(output);
  return { input, output, stop: () => sources.forEach((s) => { try { s.stop(); } catch { /* já parou */ } }) };
}

/* ---------- utilitários ---------- */

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, gain = 0, q = 0.707) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.gain.value = gain; f.Q.value = q;
  return f;
}

function series(nodes: AudioNode[]): { input: AudioNode; output: AudioNode } {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return { input: nodes[0], output: nodes[nodes.length - 1] };
}

/** estágio com mistura seco/molhado */
function wetDry(ctx: BaseAudioContext, wet: { input: AudioNode; output: AudioNode }, mix: number) {
  const input = ctx.createGain(), output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const w = ctx.createGain(); w.gain.value = mix;
  input.connect(dry).connect(output);
  input.connect(wet.input); wet.output.connect(w).connect(output);
  return { input, output };
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.max(1, Math.round(seconds * sr));
  const b = ctx.createBuffer(2, len, sr);
  let seed = 9871;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return b;
}

function distortionCurve(k: number): Float32Array {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

/** monta a cadeia de efeitos; null se não houver nada a fazer */
export function buildAudioChain(ctx: BaseAudioContext, effects: AudioEffect[] | undefined, pitch: number | undefined, startAt = 0): FxChain | null {
  if (!needsAudioChain(effects, pitch)) return null;
  const stages: { input: AudioNode; output: AudioNode }[] = [];
  const stops: (() => void)[] = [];
  const semis = totalSemitones(effects, pitch);
  if (Math.abs(semis) > 0.01) { const ps = pitchShifter(ctx, semis, startAt); stages.push(ps); stops.push(ps.stop); }
  for (const e of effects ?? []) {
    const a = amt(e);
    if (a <= 0) continue;
    switch (e.kind) {
      case 'noise-reduction': {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -40; comp.ratio.value = 2; comp.knee.value = 20;
        stages.push(series([biquad(ctx, 'highpass', 80 + 120 * a), biquad(ctx, 'lowpass', 9000 - 3000 * a), biquad(ctx, 'notch', 60, 0, 8), comp]));
        break;
      }
      case 'normalize': {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -28 + 8 * (1 - a); comp.ratio.value = 4; comp.knee.value = 12; comp.attack.value = 0.005; comp.release.value = 0.2;
        const g = ctx.createGain(); g.gain.value = 1 + 1.2 * a;
        stages.push(series([comp, g]));
        break;
      }
      case 'voice-enhance': {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -26; comp.ratio.value = 3;
        const g = ctx.createGain(); g.gain.value = 1.25;
        stages.push(series([biquad(ctx, 'highpass', 90), biquad(ctx, 'peaking', 250, -3 * a, 1), biquad(ctx, 'peaking', 3200, 6 * a, 0.9), biquad(ctx, 'highshelf', 9000, 3 * a), comp, g]));
        break;
      }
      case 'robot': {
        const input = ctx.createGain(), output = ctx.createGain();
        const ring = ctx.createGain(); ring.gain.value = 0; // anel: sinal × oscilador
        const osc = ctx.createOscillator(); osc.frequency.value = 40 + 30 * a; osc.type = 'sine';
        osc.connect(ring.gain); osc.start(startAt); stops.push(() => { try { osc.stop(); } catch { /* ok */ } });
        const comb = ctx.createDelay(0.05); comb.delayTime.value = 0.008;
        const fb = ctx.createGain(); fb.gain.value = 0.5 * a;
        comb.connect(fb).connect(comb);
        const wet = ctx.createGain(); wet.gain.value = 1.6;
        const dry = ctx.createGain(); dry.gain.value = 1 - a;
        input.connect(dry).connect(output);
        input.connect(ring);
        ring.connect(wet); ring.connect(comb); comb.connect(wet);
        wet.connect(output);
        stages.push({ input, output });
        break;
      }
      case 'echo': {
        const d = ctx.createDelay(2); d.delayTime.value = 0.28 + 0.12 * a;
        const fb = ctx.createGain(); fb.gain.value = 0.25 + 0.3 * a;
        d.connect(fb).connect(d);
        stages.push(wetDry(ctx, { input: d, output: d }, 0.5 * a + 0.2));
        break;
      }
      case 'reverb': {
        const conv = ctx.createConvolver();
        conv.buffer = impulse(ctx, 0.6 + 2.4 * a, 2.5);
        stages.push(wetDry(ctx, { input: conv, output: conv }, 0.35 + 0.4 * a));
        break;
      }
      case 'telephone': {
        const sh = ctx.createWaveShaper(); sh.curve = distortionCurve(2 + 6 * a);
        stages.push(series([biquad(ctx, 'highpass', 400), biquad(ctx, 'lowpass', 3200), biquad(ctx, 'peaking', 1600, 6 * a, 1), sh]));
        break;
      }
      case 'megaphone': {
        const sh = ctx.createWaveShaper(); sh.curve = distortionCurve(10 + 40 * a); sh.oversample = '2x';
        const g = ctx.createGain(); g.gain.value = 0.7;
        stages.push(series([biquad(ctx, 'highpass', 650), biquad(ctx, 'lowpass', 4200), biquad(ctx, 'peaking', 2000, 8 * a, 1.2), sh, g]));
        break;
      }
      case 'bass-boost':
        stages.push(series([biquad(ctx, 'lowshelf', 140, 4 + 10 * a), biquad(ctx, 'peaking', 60, 3 * a, 1)]));
        break;
      default: break;
    }
  }
  if (!stages.length) return null;
  for (let i = 0; i < stages.length - 1; i++) stages[i].output.connect(stages[i + 1].input);
  return { input: stages[0].input, output: stages[stages.length - 1].output, stop: () => stops.forEach((f) => f()) };
}

/* ---------- processamento de buffer (export, exato) ---------- */

/** inverte um AudioBuffer (reverso) */
export function reverseBuffer(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const src = b.getChannelData(ch), dst = out.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

/** portão de ruído simples sobre amostras (in-place): atenua trechos abaixo do limiar */
export function noiseGate(data: Float32Array[], sampleRate: number, amount: number): void {
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  const n = data[0]?.length ?? 0;
  // limiar relativo ao RMS global
  let sum = 0;
  for (const ch of data) for (let i = 0; i < n; i += 4) sum += ch[i] * ch[i];
  const rms = Math.sqrt(sum / Math.max(1, (n / 4) * data.length));
  const thr = rms * (0.15 + 0.5 * amount);
  const floor = 1 - 0.9 * amount;
  let g = 1;
  for (let start = 0; start < n; start += win) {
    let e = 0;
    const end = Math.min(n, start + win);
    for (const ch of data) for (let i = start; i < end; i++) e += ch[i] * ch[i];
    const r = Math.sqrt(e / Math.max(1, (end - start) * data.length));
    const target = r < thr ? floor : 1;
    for (let i = start; i < end; i++) {
      g += (target - g) * (target < g ? 0.002 : 0.02); // ataque rápido, soltura suave
      for (const ch of data) ch[i] *= g;
    }
  }
}

/** ganho para levar o pico a -1 dBFS (normalizar) */
export function peakGain(data: Float32Array[], amount = 1): number {
  let peak = 0;
  for (const ch of data) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  if (peak < 1e-4) return 1;
  const target = Math.pow(10, -1 / 20);
  return 1 + (target / peak - 1) * amount;
}
