/* =====================================================================
   Time-stretch offline (WSOLA) do export: muda a velocidade SEM mudar o tom,
   igual ao preview (<video>/<audio> com preservesPitch). Segue um mapeamento
   arbitrário tempo de saída → tempo de origem, então serve tanto p/ velocidade
   constante quanto p/ curva/preset de velocidade.
   ===================================================================== */

export interface StretchOptions {
  /** tamanho da janela (s); 40 ms é bom p/ voz e música */
  frame?: number;
  /** busca de alinhamento ± (s) */
  tolerance?: number;
}

/**
 * Estica/encolhe `input` (canais com a mesma taxa `sr`) até `outLen` amostras.
 * `srcAt(tOut)` = posição de origem (s, desde o início de `input`) que deve soar no tempo de saída tOut (s).
 * Velocidade constante v: srcAt = t => t * v.
 */
export function wsola(input: Float32Array[], sr: number, outLen: number, srcAt: (tOut: number) => number, o: StretchOptions = {}): Float32Array[] {
  const nch = input.length;
  const inLen = input[0]?.length ?? 0;
  const out = Array.from({ length: nch }, () => new Float32Array(Math.max(0, outLen)));
  if (!inLen || outLen <= 0) return out;
  const N = Math.max(64, Math.round((o.frame ?? 0.04) * sr) & ~1);
  const Hs = N >> 1;
  const tol = Math.max(1, Math.round((o.tolerance ?? 0.012) * sr));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const norm = new Float32Array(outLen);
  // canal de referência p/ o alinhamento (média dos canais)
  const mono = nch === 1 ? input[0] : (() => {
    const m = new Float32Array(inLen);
    for (const ch of input) for (let i = 0; i < inLen; i++) m[i] += ch[i] / nch;
    return m;
  })();
  const at = (i: number) => (i >= 0 && i < inLen ? mono[i] : 0);
  let prevIn = -1; // início do trecho de entrada usado no quadro anterior
  for (let outPos = -Hs; outPos < outLen; outPos += Hs) {
    // posição ideal: centro do quadro de saída mapeado p/ a origem
    const ideal = Math.round(srcAt(Math.max(0, outPos + Hs) / sr) * sr) - Hs;
    let best = ideal;
    if (prevIn >= 0) {
      // continuação natural do quadro anterior; procura em torno do ideal o trecho mais parecido
      const nat = prevIn + Hs;
      let bestScore = -Infinity;
      const step = tol > 64 ? 2 : 1, cmpStep = 4;
      for (let d = -tol; d <= tol; d += step) {
        const cand = ideal + d;
        let s = 0;
        for (let k = 0; k < Hs; k += cmpStep) s += at(cand + k) * at(nat + k);
        if (s > bestScore) { bestScore = s; best = cand; }
      }
    }
    prevIn = best;
    for (let k = 0; k < N; k++) {
      const oi = outPos + k;
      if (oi < 0 || oi >= outLen) continue;
      const ii = best + k;
      const w = win[k];
      norm[oi] += w;
      if (ii < 0 || ii >= inLen) continue;
      for (let c = 0; c < nch; c++) out[c][oi] += input[c][ii] * w;
    }
  }
  for (let i = 0; i < outLen; i++) {
    const n = norm[i];
    if (n > 1e-3) for (let c = 0; c < nch; c++) out[c][i] /= n;
  }
  return out;
}

/** frequência dominante aproximada por cruzamentos de zero (testes/diagnóstico) */
export function zeroCrossHz(x: Float32Array, sr: number, from = 0, to = x.length): number {
  let z = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
  return z / 2 / ((Math.min(x.length, to) - Math.max(1, from)) / sr);
}
