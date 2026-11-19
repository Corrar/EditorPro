/* =====================================================================
   Música · estilos (receitas por gênero). Cada faixa do catálogo parte
   de um estilo + variante + semente; o arranjador (engine.ts) transforma
   a receita em notas. Puro.
   ===================================================================== */
import type { BassType, KeysType, KickType, LeadType, PadType, PercType, SnareType } from './instruments';
import type { ScaleName } from './theory';

export type Genre =
  | 'pop' | 'eletronica' | 'lofi' | 'hiphop' | 'corporativa' | 'cinematica' | 'acustica'
  | 'funk' | 'ambiente' | 'suspense' | 'infantil' | 'romantica' | 'vlog';

export const GENRE_LABELS: Record<Genre, string> = {
  pop: 'Animada/Pop',
  eletronica: 'Eletrônica/EDM',
  lofi: 'Lo-fi/Chill',
  hiphop: 'Hip-hop/Trap',
  corporativa: 'Corporativa/Inspiradora',
  cinematica: 'Cinematográfica/Épica',
  acustica: 'Acústica/Folk',
  funk: 'Funk/Groove',
  ambiente: 'Ambiente/Calma',
  suspense: 'Suspense',
  infantil: 'Infantil/Divertida',
  romantica: 'Romântica',
  vlog: 'Vlog/Viagem',
};

/** instrumento de uma parte: pad (acordes sustentados), teclas/cordas ou lead */
export type Inst = { pad: PadType } | { keys: KeysType } | { lead: LeadType };

/** linhas de 16 passos: X=acento, x=normal, g=fantasma, r=rufo (3), R=rufo (4), .=nada */
export interface DrumPat {
  k?: string; // bumbo
  s?: string; // caixa/palma
  h?: string; // chimbal fechado
  o?: string; // chimbal aberto
  p?: string; // percussão (kit.perc)
  x?: string; // shaker
  t?: string; // segunda percussão (kit.perc2)
}

export type BassPattern = 'root8' | 'offbeat' | 'root4' | 'sustain' | 'walking' | 'funk' | '808' | 'folk' | 'pulse' | 'none';
export type HarmRhythm = 'sustain' | 'stab' | 'comp' | 'strum' | 'pick' | 'arp' | 'block' | 'pianoarp' | 'halfs';
export type LeadKind = 'melody' | 'arp' | 'sparse' | 'ostinato' | 'none';

export interface Style {
  scale: ScaleName;
  progA: number[];
  progB: number[];
  chordSize: 3 | 4;
  sus?: 2 | 4;
  add9?: boolean;
  chordsPerBar: 1 | 2;
  /** atraso dos 16 ímpares (0..0,45) */
  swing: number;
  kit: { kick: KickType; snare: SnareType | 'none'; perc?: PercType; perc2?: PercType; kickGain?: number; snareGain?: number; hatGain?: number };
  drumsA?: DrumPat;
  drumsB?: DrumPat;
  drumsIntro?: DrumPat;
  bass: { type: BassType; pattern: BassPattern; gain?: number; oct?: number };
  harm: { inst: Inst; rhythm: HarmRhythm; gain?: number; lo?: number; hi?: number; rev?: number };
  /** camada extra de harmonia (só na seção B, ou sempre com `always`) */
  harm2?: { inst: Inst; rhythm: HarmRhythm; gain?: number; lo?: number; hi?: number; always?: boolean };
  lead: { kind: LeadKind; inst: Inst; center: number; gain?: number; sections: 'B' | 'all'; rate?: 8 | 16; density?: number; dly?: number };
  fx: { reverb: number; room: number; delay: number; sidechain: number; lofi?: number; bright?: number; crash?: boolean; riser?: boolean; drive?: number };
  /** compassos de introdução (sem bumbo) quando cabe */
  intro?: number;
}

const EMPTY = '................';

/* ---------- receitas base ---------- */

export const STYLES: Record<Genre, Style> = {
  pop: {
    scale: 'major', progA: [0, 4, 5, 3], progB: [5, 3, 0, 4], chordSize: 3, chordsPerBar: 1, swing: 0,
    kit: { kick: 'punch', snare: 'clap', perc: 'tamb', hatGain: 0.8 },
    drumsA: { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', p: EMPTY },
    drumsB: { k: 'x.....x.x.x.....', s: '....X.......X...', h: 'xgxgxgxgxgxgxgxg', o: '..............x.', p: '....x.......x...' },
    drumsIntro: { h: 'x.x.x.x.x.x.x.x.' },
    bass: { type: 'synth', pattern: 'root8', gain: 0.75 },
    harm: { inst: { keys: 'piano' }, rhythm: 'block', gain: 0.55 },
    harm2: { inst: { pad: 'saw' }, rhythm: 'sustain', gain: 0.35 },
    lead: { kind: 'melody', inst: { lead: 'saw' }, center: 74, gain: 0.42, sections: 'B', density: 0.7 },
    fx: { reverb: 0.35, room: 0.55, delay: 0.25, sidechain: 0.25, crash: true, riser: true },
    intro: 1,
  },
  eletronica: {
    scale: 'minor', progA: [5, 3, 0, 4], progB: [5, 3, 0, 6], chordSize: 3, chordsPerBar: 1, swing: 0,
    kit: { kick: 'deep', snare: 'clap', perc: 'tamb', hatGain: 0.9, kickGain: 1.1 },
    drumsA: { k: 'x...x...x...x...', s: '....x.......x...', o: '..x...x...x...x.' },
    drumsB: { k: 'X...x...X...x...', s: '....X.......X...', h: 'gxgggxgggxgggxgg', o: '..x...x...x...x.', p: '......x.......x.' },
    drumsIntro: { o: '..x...x...x...x.', h: 'x...x...x...x...' },
    bass: { type: 'synth', pattern: 'offbeat', gain: 0.8 },
    harm: { inst: { pad: 'saw' }, rhythm: 'sustain', gain: 0.5 },
    harm2: { inst: { keys: 'stab' }, rhythm: 'stab', gain: 0.4 },
    lead: { kind: 'arp', inst: { keys: 'pluck' }, center: 72, gain: 0.45, sections: 'B', rate: 16, dly: 0.35 },
    fx: { reverb: 0.4, room: 0.7, delay: 0.35, sidechain: 0.55, crash: true, riser: true },
    intro: 2,
  },
  lofi: {
    scale: 'major', progA: [1, 4, 0, 5], progB: [3, 2, 1, 4], chordSize: 4, chordsPerBar: 1, swing: 0.3,
    kit: { kick: 'soft', snare: 'rim', perc: 'tamb', hatGain: 0.55, snareGain: 0.9 },
    drumsA: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.xg', x: EMPTY },
    drumsB: { k: 'x......x..x.....', s: '....x.......x..g', h: 'x.xgx.x.x.xgx.x.', x: '..x...x...x...x.' },
    drumsIntro: { h: 'x...x...x...x...' },
    bass: { type: 'finger', pattern: 'walking', gain: 0.75 },
    harm: { inst: { keys: 'epiano' }, rhythm: 'comp', gain: 0.65, lo: 52, hi: 72 },
    harm2: { inst: { pad: 'warm' }, rhythm: 'sustain', gain: 0.22, always: true },
    lead: { kind: 'sparse', inst: { keys: 'bell' }, center: 79, gain: 0.25, sections: 'B', density: 0.3 },
    fx: { reverb: 0.4, room: 0.5, delay: 0.2, sidechain: 0.15, lofi: 1, bright: 6500 },
    intro: 1,
  },
  hiphop: {
    scale: 'harmonic', progA: [0, 5, 3, 4], progB: [0, 5, 2, 4], chordSize: 3, chordsPerBar: 1, swing: 0,
    kit: { kick: '808', snare: 'clap', perc: 'tick', hatGain: 0.7, kickGain: 0.75 },
    drumsA: { k: 'x......x..x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
    drumsB: { k: 'x......x..x..x..', s: '........X.......', h: 'x.xxx.x.x.r.x.xx', o: '......x.........' },
    drumsIntro: { h: 'x...x...x...x...' },
    bass: { type: '808', pattern: '808', gain: 0.85 },
    harm: { inst: { keys: 'bell' }, rhythm: 'arp', gain: 0.35, lo: 60, hi: 79 },
    harm2: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.3, always: true },
    lead: { kind: 'none', inst: { lead: 'soft' }, center: 76, sections: 'B' },
    fx: { reverb: 0.35, room: 0.6, delay: 0.25, sidechain: 0, drive: 1.4 },
    intro: 1,
  },
  corporativa: {
    scale: 'major', progA: [0, 4, 5, 3], progB: [3, 0, 4, 5], chordSize: 3, add9: true, chordsPerBar: 1, swing: 0,
    kit: { kick: 'punch', snare: 'clap', perc: 'tamb', hatGain: 0.6, snareGain: 0.6 },
    drumsA: { k: 'x.......x.......', s: '....x.......x...', x: 'xgxgxgxgxgxgxgxg' },
    drumsB: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', x: 'xgxgxgxgxgxgxgxg' },
    drumsIntro: { x: 'x.x.x.x.x.x.x.x.' },
    bass: { type: 'pulse', pattern: 'pulse', gain: 0.7 },
    harm: { inst: { keys: 'piano' }, rhythm: 'pianoarp', gain: 0.55 },
    harm2: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.35 },
    lead: { kind: 'arp', inst: { keys: 'pluck' }, center: 76, gain: 0.3, sections: 'B', rate: 16, dly: 0.3 },
    fx: { reverb: 0.4, room: 0.65, delay: 0.3, sidechain: 0.2, crash: true, riser: true },
    intro: 1,
  },
  cinematica: {
    scale: 'minor', progA: [0, 5, 2, 6], progB: [5, 3, 0, 4], chordSize: 3, chordsPerBar: 1, swing: 0,
    kit: { kick: 'boom', snare: 'snare', perc: 'taiko', perc2: 'tom', snareGain: 0.4, kickGain: 0.9 },
    drumsA: { k: 'x.........x.....', p: '........x.......' },
    drumsB: { k: 'x.....x...x.....', p: 'x..x..x.x...x.x.', t: '............xxxx', s: '....x.......x...' },
    drumsIntro: {},
    bass: { type: 'sub', pattern: 'sustain', gain: 0.75 },
    harm: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.6, lo: 50, hi: 72 },
    harm2: { inst: { pad: 'saw' }, rhythm: 'sustain', gain: 0.3 },
    lead: { kind: 'ostinato', inst: { keys: 'stab' }, center: 62, gain: 0.35, sections: 'all', rate: 8 },
    fx: { reverb: 0.6, room: 0.9, delay: 0.1, sidechain: 0, crash: true, riser: true },
    intro: 2,
  },
  acustica: {
    scale: 'major', progA: [0, 4, 5, 3], progB: [3, 0, 4, 4], chordSize: 3, chordsPerBar: 1, swing: 0.08,
    kit: { kick: 'soft', snare: 'brush', perc: 'tamb', hatGain: 0.5 },
    drumsA: { k: 'x.......x.......', x: 'x.x.x.x.x.x.x.x.' },
    drumsB: { k: 'x.......x.x.....', s: '....x.......x...', x: 'xgxgxgxgxgxgxgxg', p: '....x.......x...' },
    drumsIntro: {},
    bass: { type: 'finger', pattern: 'folk', gain: 0.65 },
    harm: { inst: { keys: 'guitar' }, rhythm: 'strum', gain: 0.55, lo: 52, hi: 71 },
    lead: { kind: 'melody', inst: { lead: 'whistle' }, center: 76, gain: 0.3, sections: 'B', density: 0.5 },
    fx: { reverb: 0.3, room: 0.5, delay: 0.15, sidechain: 0 },
    intro: 1,
  },
  funk: {
    scale: 'dorian', progA: [0, 3], progB: [0, 3, 6, 3], chordSize: 4, chordsPerBar: 1, swing: 0.12,
    kit: { kick: 'punch', snare: 'snare', perc: 'cowbell', hatGain: 0.65 },
    drumsA: { k: 'x..x..x...x..x..', s: '....x..g.g..x..g', h: 'xgxgxgxgxgxgxgxg' },
    drumsB: { k: 'x..x..x...x..x.x', s: '....X..g.g..X..g', h: 'xgxgxgxgxgxgxgog', o: '..............x.', p: 'x.......x.......' },
    drumsIntro: { h: 'xgxgxgxgxgxgxgxg' },
    bass: { type: 'funk', pattern: 'funk', gain: 0.8 },
    harm: { inst: { keys: 'stab' }, rhythm: 'stab', gain: 0.45, lo: 57, hi: 76 },
    harm2: { inst: { pad: 'organ' }, rhythm: 'sustain', gain: 0.2 },
    lead: { kind: 'melody', inst: { lead: 'square' }, center: 74, gain: 0.3, sections: 'B', density: 0.75 },
    fx: { reverb: 0.25, room: 0.45, delay: 0.15, sidechain: 0.15, crash: false },
    intro: 1,
  },
  ambiente: {
    scale: 'lydian', progA: [0, 1, 0, 4], progB: [5, 3, 0, 1], chordSize: 3, add9: true, chordsPerBar: 1, swing: 0,
    kit: { kick: 'soft', snare: 'none', hatGain: 0.4 },
    drumsA: {},
    drumsB: { x: '....x.......x...' },
    bass: { type: 'sub', pattern: 'sustain', gain: 0.5 },
    harm: { inst: { pad: 'air' }, rhythm: 'sustain', gain: 0.7, lo: 52, hi: 76 },
    harm2: { inst: { keys: 'harp' }, rhythm: 'arp', gain: 0.25, always: true },
    lead: { kind: 'sparse', inst: { keys: 'bell' }, center: 79, gain: 0.3, sections: 'all', density: 0.25 },
    fx: { reverb: 0.7, room: 0.92, delay: 0.35, sidechain: 0, bright: 9000 },
    intro: 0,
  },
  suspense: {
    scale: 'phrygian', progA: [0, 0, 1, 0], progB: [0, 5, 1, 6], chordSize: 3, chordsPerBar: 1, swing: 0,
    kit: { kick: 'boom', snare: 'none', perc: 'tick', perc2: 'taiko', kickGain: 0.9 },
    drumsA: { k: 'x..x............', p: 'g.g.g.g.g.g.g.g.' },
    drumsB: { k: 'x..x......x..x..', p: 'gggggggggggggggg', t: '........x.......' },
    drumsIntro: { p: 'g...g...g...g...' },
    bass: { type: 'sub', pattern: 'sustain', gain: 0.7 },
    harm: { inst: { pad: 'saw' }, rhythm: 'sustain', gain: 0.45, lo: 48, hi: 67 },
    harm2: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.3, lo: 67, hi: 84 },
    lead: { kind: 'ostinato', inst: { keys: 'pluck' }, center: 60, gain: 0.35, sections: 'all', rate: 16 },
    fx: { reverb: 0.55, room: 0.85, delay: 0.3, sidechain: 0, bright: 9000, riser: true },
    intro: 1,
  },
  infantil: {
    scale: 'major', progA: [0, 3, 4, 0], progB: [3, 4, 2, 5], chordSize: 3, chordsPerBar: 1, swing: 0.2,
    kit: { kick: 'soft', snare: 'clap', perc: 'wood', hatGain: 0.5, snareGain: 0.7 },
    drumsA: { k: 'x.......x.......', s: '....x.......x...', p: '..x...x...x...x.' },
    drumsB: { k: 'x...x...x...x...', s: '....x.......x...', p: '..x...x...x.x.x.', x: 'x.x.x.x.x.x.x.x.' },
    drumsIntro: { p: '..x...x...x...x.' },
    bass: { type: 'finger', pattern: 'folk', gain: 0.7 },
    harm: { inst: { keys: 'uke' }, rhythm: 'strum', gain: 0.5, lo: 60, hi: 76 },
    lead: { kind: 'melody', inst: { keys: 'glock' }, center: 79, gain: 0.45, sections: 'all', density: 0.8 },
    fx: { reverb: 0.25, room: 0.4, delay: 0.1, sidechain: 0 },
    intro: 1,
  },
  romantica: {
    scale: 'major', progA: [0, 5, 3, 4], progB: [3, 4, 2, 5], chordSize: 4, chordsPerBar: 1, swing: 0,
    kit: { kick: 'soft', snare: 'rim', hatGain: 0.4, snareGain: 0.7 },
    drumsA: {},
    drumsB: { k: 'x.......x.x.....', s: '....x.......x...', x: 'x.x.x.x.x.x.x.x.' },
    bass: { type: 'finger', pattern: 'root4', gain: 0.6 },
    harm: { inst: { keys: 'piano' }, rhythm: 'pianoarp', gain: 0.65 },
    harm2: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.35 },
    lead: { kind: 'melody', inst: { lead: 'soft' }, center: 76, gain: 0.32, sections: 'B', density: 0.45 },
    fx: { reverb: 0.55, room: 0.75, delay: 0.15, sidechain: 0 },
    intro: 1,
  },
  vlog: {
    scale: 'major', progA: [3, 0, 4, 5], progB: [5, 3, 0, 4], chordSize: 3, add9: true, chordsPerBar: 1, swing: 0,
    kit: { kick: 'deep', snare: 'clap', perc: 'conga', hatGain: 0.55, snareGain: 0.7 },
    drumsA: { k: 'x...x...x...x...', s: '....x.......x...', x: 'xgxgxgxgxgxgxgxg' },
    drumsB: { k: 'x...x...x...x...', s: '....x.......x...', x: 'xgxgxgxgxgxgxgxg', p: '...x..x....x..x.', o: '..x...x...x...x.' },
    drumsIntro: { x: 'xgxgxgxgxgxgxgxg' },
    bass: { type: 'pluck', pattern: 'offbeat', gain: 0.75 },
    harm: { inst: { pad: 'warm' }, rhythm: 'sustain', gain: 0.4 },
    harm2: { inst: { keys: 'mallet' }, rhythm: 'stab', gain: 0.35, always: true },
    lead: { kind: 'melody', inst: { keys: 'pluck' }, center: 76, gain: 0.45, sections: 'B', density: 0.7, dly: 0.3 },
    fx: { reverb: 0.4, room: 0.6, delay: 0.3, sidechain: 0.4, riser: true },
    intro: 1,
  },
};

/** junta a receita base com as alterações da faixa (rasa, por campo) */
export function mergeStyle(base: Style, o: Partial<Style> = {}): Style {
  return {
    ...base, ...o,
    kit: { ...base.kit, ...(o.kit ?? {}) },
    bass: { ...base.bass, ...(o.bass ?? {}) },
    harm: { ...base.harm, ...(o.harm ?? {}) },
    lead: { ...base.lead, ...(o.lead ?? {}) },
    fx: { ...base.fx, ...(o.fx ?? {}) },
    harm2: 'harm2' in o ? o.harm2 : base.harm2,
  };
}
