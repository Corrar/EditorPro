/* =====================================================================
   Música · teoria (escalas, acordes, condução de vozes). Puro.
   ===================================================================== */

export type ScaleName = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'phrygian' | 'harmonic' | 'lydian';

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const NOTE_NAMES = ['Dó', 'Dó#', 'Ré', 'Mib', 'Mi', 'Fá', 'Fá#', 'Sol', 'Láb', 'Lá', 'Sib', 'Si'];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** semitons (a partir da tônica) do grau `deg` da escala (graus podem passar de 7 ou ser negativos) */
export function degreeSemis(scale: ScaleName, deg: number): number {
  const s = SCALES[scale];
  return 12 * Math.floor(deg / 7) + s[mod(deg, 7)];
}

export interface ChordSpec {
  /** grau da fundamental (0 = I) */
  deg: number;
  /** semitons (relativos à tônica) das notas do acorde, a partir da fundamental */
  semis: number[];
  /** fundamental em semitons (relativo à tônica, 0..11) */
  root: number;
}

/**
 * Acorde por terças empilhadas na escala. `size` 3 = tríade, 4 = tétrade; `sus`
 * troca a terça pela quarta (2 = sus2, 4 = sus4); `add9` acrescenta a nona.
 */
export function chordOf(scale: ScaleName, deg: number, size: 3 | 4 = 3, opts: { sus?: 2 | 4; add9?: boolean } = {}): ChordSpec {
  const steps = size === 4 ? [0, 2, 4, 6] : [0, 2, 4];
  if (opts.sus === 2) steps[1] = 1;
  if (opts.sus === 4) steps[1] = 3;
  if (opts.add9) steps.push(8);
  const base = degreeSemis(scale, deg);
  const semis = steps.map((s) => degreeSemis(scale, deg + s));
  return { deg, semis, root: mod(base, 12) };
}

/**
 * Escolhe a inversão/oitava das notas do acorde dentro de [lo, hi] (MIDI) mais
 * próxima da voz anterior (condução suave). `key` = MIDI da tônica de referência.
 */
export function voiceChord(chord: ChordSpec, key: number, lo: number, hi: number, prev?: number[]): number[] {
  const pcs = chord.semis.map((s) => mod(key + s, 12));
  const center = prev?.length ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  let best: number[] = [];
  let bestScore = Infinity;
  // candidatos: cada inversão, começando em oitavas próximas do centro
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo - 12; base <= hi; base += 12) {
      const notes: number[] = [];
      let last = -Infinity;
      for (const pc of order) {
        let m = base + mod(pc - base, 12);
        while (m <= last) m += 12;
        notes.push(m);
        last = m;
      }
      if (notes[0] < lo || notes[notes.length - 1] > hi + 4) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let score = Math.abs(mean - center) * 1.5;
      if (prev?.length) for (const n of notes) score += Math.min(...prev.map((p) => Math.abs(p - n))) * 0.6;
      if (score < bestScore) { bestScore = score; best = notes; }
    }
  }
  if (!best.length) best = pcs.map((pc) => lo + mod(pc - lo, 12)).sort((a, b) => a - b);
  return best;
}

/** nota da escala mais próxima de `m` (MIDI) */
export function snapToScale(m: number, scale: ScaleName, key: number): number {
  const s = SCALES[scale];
  for (let d = 0; d < 7; d++) {
    for (const c of d === 0 ? [m] : [m - d, m + d]) if (s.includes(mod(c - key, 12))) return c;
  }
  return m;
}

/** passo de `steps` graus na escala a partir de `m` (que deve estar na escala) */
export function stepScale(m: number, steps: number, scale: ScaleName, key: number): number {
  const s = SCALES[scale];
  const rel = m - key;
  const oct = Math.floor(rel / 12);
  const idx = s.indexOf(mod(rel, 12));
  if (idx < 0) return snapToScale(m, scale, key);
  return key + degreeSemis(scale, oct * 7 + idx + steps);
}
