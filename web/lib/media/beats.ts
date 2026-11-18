/* =====================================================================
   Detecção de batidas (puro, sem DOM): fluxo de energia (onset) com
   limiar adaptativo e escolha de picos. Entrada: PCM mono.
   ===================================================================== */

export interface BeatOptions {
  /** tamanho da janela/salto em amostras */
  frame?: number;
  hop?: number;
  /** intervalo mínimo entre batidas (s) */
  minInterval?: number;
  /** sensibilidade: maior = menos batidas (multiplica o desvio local) */
  sensitivity?: number;
}

/** reduz para mono somando canais */
export function toMono(channels: ArrayLike<number>[]): Float32Array {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const out = new Float32Array(len);
  if (!channels.length) return out;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** curva de onset: aumento positivo do log da energia por quadro */
export function onsetEnvelope(samples: ArrayLike<number>, frame = 1024, hop = 512): number[] {
  const n = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
  const energy = new Array<number>(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    const a = f * hop;
    for (let i = a; i < a + frame; i++) e += samples[i] * samples[i];
    energy[f] = Math.log(1e-9 + e / frame);
  }
  const env = new Array<number>(n).fill(0);
  for (let f = 1; f < n; f++) env[f] = Math.max(0, energy[f] - energy[f - 1]);
  return env;
}

/** tempos (s) das batidas */
export function detectBeats(samples: ArrayLike<number>, sampleRate: number, opts: BeatOptions = {}): number[] {
  const frame = opts.frame ?? 1024;
  const hop = opts.hop ?? 512;
  const minInterval = opts.minInterval ?? 0.25;
  const k = opts.sensitivity ?? 1.5;
  const env = onsetEnvelope(samples, frame, hop);
  if (env.length < 3) return [];
  const fps = sampleRate / hop;
  const w = Math.max(2, Math.round(fps * 0.5)); // janela de ±0,5 s
  const beats: number[] = [];
  let last = -Infinity;
  for (let f = 1; f < env.length - 1; f++) {
    const v = env[f];
    if (v <= 0 || v < env[f - 1] || v < env[f + 1]) continue;
    let sum = 0, sum2 = 0, cnt = 0;
    for (let j = Math.max(0, f - w); j <= Math.min(env.length - 1, f + w); j++) { sum += env[j]; sum2 += env[j] * env[j]; cnt++; }
    const mean = sum / cnt;
    const sd = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
    if (v < mean + k * sd || v < 0.05) continue;
    const t = (f * hop + frame / 2) / sampleRate;
    if (t - last < minInterval) continue;
    beats.push(Math.round(t * 1000) / 1000);
    last = t;
  }
  return beats;
}

/** BPM estimado pela mediana dos intervalos (null se poucas batidas) */
export function estimateBpm(beats: number[]): number | null {
  if (beats.length < 4) return null;
  const iv = beats.slice(1).map((b, i) => b - beats[i]).filter((d) => d > 0.2 && d < 2).sort((a, b) => a - b);
  if (!iv.length) return null;
  const med = iv[Math.floor(iv.length / 2)];
  // média dos intervalos próximos da mediana (reduz o erro de quantização do salto)
  const near = iv.filter((d) => Math.abs(d - med) < med * 0.2);
  const mean = near.reduce((a, b) => a + b, 0) / near.length;
  return Math.round(60 / mean);
}
