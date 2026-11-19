/* =====================================================================
   Música · CATÁLOGO de trilhas geradas por código (sem direitos autorais,
   nada baixado). Cada faixa = estilo + variações + semente. Puro.
   ===================================================================== */
import { STYLES, mergeStyle, type Genre, type Style } from './styles';
import { NOTE_NAMES } from './theory';

export type Mood =
  | 'feliz' | 'energetica' | 'relaxante' | 'inspiradora' | 'epica' | 'tensa' | 'romantica'
  | 'divertida' | 'nostalgica' | 'confiante' | 'misteriosa' | 'sonhadora' | 'calma' | 'aventureira';

export const MOOD_LABELS: Record<Mood, string> = {
  feliz: 'Feliz', energetica: 'Energética', relaxante: 'Relaxante', inspiradora: 'Inspiradora', epica: 'Épica',
  tensa: 'Tensa', romantica: 'Romântica', divertida: 'Divertida', nostalgica: 'Nostálgica', confiante: 'Confiante',
  misteriosa: 'Misteriosa', sonhadora: 'Sonhadora', calma: 'Calma', aventureira: 'Aventureira',
};

export type Energy = 'baixa' | 'media' | 'alta';
export const ENERGY_LABELS: Record<Energy, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

export interface MusicTrack {
  id: string;
  name: string;
  genre: Genre;
  mood: Mood;
  /** humores secundários (busca/IA) */
  moods?: Mood[];
  tags: string[];
  bpm: number;
  energy: Energy;
  /** tônica (0 = Dó … 11 = Si) */
  key: number;
  seed: number;
  /** duração padrão sugerida (s) */
  duration: 30 | 60;
  description: string;
  /** alterações sobre a receita do gênero */
  style?: Partial<Style>;
}

type T = Omit<MusicTrack, 'duration'> & { duration?: 30 | 60 };

const TRACKS: T[] = [
  /* ---------- Animada / Pop ---------- */
  { id: 'sol-de-verao', name: 'Sol de Verão', genre: 'pop', mood: 'feliz', moods: ['energetica'], tags: ['alegre', 'verão', 'positiva'], bpm: 118, energy: 'alta', key: 0, seed: 101, description: 'Pop solar com piano, palmas e refrão de sintetizador.' },
  { id: 'confete', name: 'Confete', genre: 'pop', mood: 'divertida', moods: ['feliz'], tags: ['festa', 'animada', 'balada'], bpm: 124, energy: 'alta', key: 7, seed: 102, description: 'Pop dançante com chimbal rápido e baixo pulsante.', style: { progA: [5, 3, 0, 4], progB: [3, 4, 5, 5], harm: { inst: { keys: 'stab' }, rhythm: 'stab', gain: 0.45 } } },
  { id: 'dia-perfeito', name: 'Dia Perfeito', genre: 'pop', mood: 'feliz', moods: ['inspiradora'], tags: ['otimista', 'leve', 'manhã'], bpm: 108, energy: 'media', key: 2, seed: 103, description: 'Pop leve com violão de fundo e melodia assobiável.', style: { harm2: { inst: { keys: 'guitar' }, rhythm: 'strum', gain: 0.35 }, lead: { kind: 'melody', inst: { lead: 'soft' }, center: 76, gain: 0.4, sections: 'B', density: 0.6 } } },
  { id: 'luz-neon-pop', name: 'Luz de Neon', genre: 'pop', mood: 'confiante', moods: ['energetica'], tags: ['moda', 'estilo', 'urbana'], bpm: 115, energy: 'media', key: 9, seed: 104, description: 'Synth-pop com acordes menores e groove firme.', style: { scale: 'minor', progA: [0, 5, 2, 6], progB: [5, 6, 0, 0], lead: { kind: 'melody', inst: { lead: 'square' }, center: 72, gain: 0.35, sections: 'B', density: 0.7 } } },

  /* ---------- Eletrônica / EDM ---------- */
  { id: 'pulso-noturno', name: 'Pulso Noturno', genre: 'eletronica', mood: 'energetica', moods: ['confiante'], tags: ['house', 'balada', 'noite'], bpm: 124, energy: 'alta', key: 9, seed: 201, description: 'House com bumbo reto, sidechain e arpejo brilhante.' },
  { id: 'horizonte-digital', name: 'Horizonte Digital', genre: 'eletronica', mood: 'inspiradora', moods: ['sonhadora'], tags: ['progressive', 'tecnologia', 'futuro'], bpm: 126, energy: 'alta', key: 4, seed: 202, description: 'Progressive com supersaw na virada.', style: { lead: { kind: 'melody', inst: { lead: 'super' }, center: 72, gain: 0.38, sections: 'B', density: 0.55, dly: 0.3 } } },
  { id: 'cidade-acesa', name: 'Cidade Acesa', genre: 'eletronica', mood: 'confiante', tags: ['deep house', 'moda', 'noite'], bpm: 120, energy: 'media', key: 2, seed: 203, description: 'Deep house elegante com teclado e baixo redondo.', style: { scale: 'dorian', progA: [0, 3, 0, 3], progB: [0, 6, 3, 4], harm: { inst: { keys: 'epiano' }, rhythm: 'stab', gain: 0.5 }, bass: { type: 'sub', pattern: 'offbeat', gain: 0.85 }, harm2: { inst: { pad: 'warm' }, rhythm: 'sustain', gain: 0.3 } } },
  { id: 'adrenalina', name: 'Adrenalina', genre: 'eletronica', mood: 'energetica', moods: ['epica'], tags: ['esporte', 'treino', 'ação'], bpm: 128, energy: 'alta', key: 5, seed: 204, description: 'EDM intensa para treino, esporte e ação.', style: { fx: { reverb: 0.35, room: 0.65, delay: 0.3, sidechain: 0.6, crash: true, riser: true, drive: 1.5 } } },

  /* ---------- Lo-fi / Chill ---------- */
  { id: 'cafe-da-tarde', name: 'Café da Tarde', genre: 'lofi', mood: 'relaxante', moods: ['nostalgica'], tags: ['estudo', 'café', 'chill'], bpm: 82, energy: 'baixa', key: 5, seed: 301, description: 'Lo-fi com piano elétrico, chiado de vinil e bateria macia.' },
  { id: 'chuva-na-janela', name: 'Chuva na Janela', genre: 'lofi', mood: 'nostalgica', moods: ['calma'], tags: ['chuva', 'estudo', 'noite'], bpm: 76, energy: 'baixa', key: 2, seed: 302, description: 'Batida lenta e melancólica para dias cinzentos.', style: { scale: 'dorian', progA: [0, 3, 6, 3], progB: [5, 6, 0, 0], harm: { inst: { keys: 'piano' }, rhythm: 'comp', gain: 0.6, lo: 52, hi: 72 } } },
  { id: 'domingo-lento', name: 'Domingo Lento', genre: 'lofi', mood: 'relaxante', tags: ['preguiça', 'casa', 'chill'], bpm: 85, energy: 'media', key: 10, seed: 303, description: 'Lo-fi com groove de hip-hop e baixo andando.' },
  { id: 'fim-de-tarde-lofi', name: 'Fim de Tarde', genre: 'lofi', mood: 'sonhadora', moods: ['relaxante'], tags: ['pôr do sol', 'vlog', 'chill'], bpm: 88, energy: 'media', key: 7, seed: 304, description: 'Chill com violão dedilhado e sininhos.', style: { harm: { inst: { keys: 'guitar' }, rhythm: 'pick', gain: 0.55, lo: 52, hi: 72 } } },

  /* ---------- Hip-hop / Trap ---------- */
  { id: 'rua-de-concreto', name: 'Rua de Concreto', genre: 'hiphop', mood: 'confiante', moods: ['tensa'], tags: ['trap', 'urbano', 'atitude'], bpm: 140, energy: 'alta', key: 4, seed: 401, description: 'Trap com 808 grave, chimbal picotado e sinos sombrios.' },
  { id: 'coroa', name: 'Coroa', genre: 'hiphop', mood: 'epica', moods: ['confiante'], tags: ['trap', 'vitória', 'poder'], bpm: 145, energy: 'alta', key: 1, seed: 402, description: 'Trap épico com cordas e 808 deslizante.', style: { harm: { inst: { pad: 'strings' }, rhythm: 'halfs', gain: 0.45, lo: 55, hi: 74 }, harm2: { inst: { keys: 'bell' }, rhythm: 'arp', gain: 0.25, always: true } } },
  { id: 'boom-bap-classico', name: 'Boom Bap Clássico', genre: 'hiphop', mood: 'nostalgica', moods: ['confiante'], tags: ['boom bap', 'rap', 'anos 90'], bpm: 90, energy: 'media', key: 9, seed: 403, description: 'Batida boom bap com swing e piano.', style: { scale: 'minor', progA: [0, 3, 0, 4], progB: [5, 3, 0, 4], swing: 0.28, kit: { kick: 'punch', snare: 'snare', perc: 'tamb', hatGain: 0.6 }, drumsA: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }, drumsB: { k: 'x.x.....x.x..x..', s: '....x.......x..g', h: 'x.x.x.xgx.x.x.x.' }, bass: { type: 'finger', pattern: 'root4', gain: 0.8 }, harm: { inst: { keys: 'piano' }, rhythm: 'comp', gain: 0.55, lo: 55, hi: 74 }, harm2: undefined, fx: { reverb: 0.25, room: 0.4, delay: 0.1, sidechain: 0, lofi: 0.6, bright: 9000 } } },

  /* ---------- Corporativa / Inspiradora ---------- */
  { id: 'novo-comeco', name: 'Novo Começo', genre: 'corporativa', mood: 'inspiradora', moods: ['feliz'], tags: ['empresa', 'apresentação', 'startup'], bpm: 112, energy: 'media', key: 0, seed: 501, description: 'Piano em arpejo, cordas e batida otimista.' },
  { id: 'subindo', name: 'Subindo', genre: 'corporativa', mood: 'confiante', moods: ['inspiradora'], tags: ['crescimento', 'negócios', 'sucesso'], bpm: 120, energy: 'alta', key: 7, seed: 502, description: 'Corporativa enérgica para resultados e conquistas.', style: { harm: { inst: { keys: 'guitar' }, rhythm: 'strum', gain: 0.45 }, lead: { kind: 'melody', inst: { keys: 'pluck' }, center: 76, gain: 0.35, sections: 'B', density: 0.6 } } },
  { id: 'tecnologia-limpa', name: 'Tecnologia Limpa', genre: 'corporativa', mood: 'inspiradora', moods: ['calma'], tags: ['tecnologia', 'produto', 'minimalista'], bpm: 100, energy: 'baixa', key: 2, seed: 503, description: 'Minimalista com pulsos suaves e marimba.', style: { harm: { inst: { keys: 'mallet' }, rhythm: 'arp', gain: 0.45 }, harm2: { inst: { pad: 'warm' }, rhythm: 'sustain', gain: 0.35, always: true } } },
  { id: 'missao', name: 'Missão', genre: 'corporativa', mood: 'epica', moods: ['inspiradora'], tags: ['institucional', 'propósito', 'motivacional'], bpm: 96, energy: 'media', key: 5, seed: 504, description: 'Inspiradora com crescendo de cordas e tambores.', style: { kit: { kick: 'punch', snare: 'snare', perc: 'tom', hatGain: 0.5, snareGain: 0.5 }, drumsB: { k: 'x.......x.x.....', s: '....x.......x...', p: '..........x.x.x.', x: 'x.x.x.x.x.x.x.x.' } } },

  /* ---------- Cinematográfica / Épica ---------- */
  { id: 'batalha-final', name: 'Batalha Final', genre: 'cinematica', mood: 'epica', moods: ['tensa'], tags: ['trailer', 'ação', 'heroica'], bpm: 120, energy: 'alta', key: 2, seed: 601, description: 'Taikos, cordas em ostinato e metais sintéticos.' },
  { id: 'reino-distante', name: 'Reino Distante', genre: 'cinematica', mood: 'aventureira', moods: ['epica'], tags: ['fantasia', 'viagem', 'jornada'], bpm: 100, energy: 'media', key: 7, seed: 602, description: 'Aventura orquestral com melodia de cordas.', style: { lead: { kind: 'melody', inst: { pad: 'strings' }, center: 72, gain: 0.45, sections: 'B', density: 0.4 } } },
  { id: 'amanhecer-epico', name: 'Amanhecer Épico', genre: 'cinematica', mood: 'inspiradora', moods: ['epica'], tags: ['emoção', 'superação', 'documentário'], bpm: 90, energy: 'media', key: 0, seed: 603, description: 'Cresce do piano ao tutti com tambores.', style: { scale: 'major', progA: [0, 4, 5, 3], progB: [3, 4, 5, 3], harm2: { inst: { keys: 'piano' }, rhythm: 'pianoarp', gain: 0.45, always: true } } },
  { id: 'sombra-do-heroi', name: 'Sombra do Herói', genre: 'cinematica', mood: 'tensa', moods: ['epica'], tags: ['trailer', 'sombria', 'drama'], bpm: 132, energy: 'alta', key: 4, seed: 604, description: 'Épica sombria com pulsos graves e impactos.', style: { scale: 'harmonic', progA: [0, 5, 3, 4], progB: [0, 1, 0, 4] } },

  /* ---------- Acústica / Folk ---------- */
  { id: 'estrada-de-terra', name: 'Estrada de Terra', genre: 'acustica', mood: 'aventureira', moods: ['feliz'], tags: ['violão', 'campo', 'viagem'], bpm: 104, energy: 'media', key: 7, seed: 701, description: 'Violão batido, pandeirola e assobio.' },
  { id: 'varanda', name: 'Varanda', genre: 'acustica', mood: 'calma', moods: ['nostalgica'], tags: ['violão', 'dedilhado', 'família'], bpm: 84, energy: 'baixa', key: 2, seed: 702, description: 'Dedilhado tranquilo de violão para momentos simples.', style: { harm: { inst: { keys: 'guitar' }, rhythm: 'pick', gain: 0.6, lo: 50, hi: 71 }, drumsA: {}, lead: { kind: 'sparse', inst: { keys: 'harp' }, center: 76, gain: 0.25, sections: 'B', density: 0.3 } } },
  { id: 'fogueira', name: 'Fogueira', genre: 'acustica', mood: 'feliz', moods: ['divertida'], tags: ['amigos', 'acampamento', 'folk'], bpm: 112, energy: 'alta', key: 4, seed: 703, description: 'Folk animado de roda, palmas e violão.', style: { scale: 'mixolydian', progA: [0, 6, 3, 0], progB: [3, 0, 6, 0], kit: { kick: 'soft', snare: 'clap', perc: 'tamb', hatGain: 0.5 } } },

  /* ---------- Funk / Groove ---------- */
  { id: 'groove-de-sexta', name: 'Groove de Sexta', genre: 'funk', mood: 'divertida', moods: ['confiante'], tags: ['groove', 'dança', 'disco'], bpm: 108, energy: 'alta', key: 2, seed: 801, description: 'Funk com baixo sincopado, metais e cowbell.' },
  { id: 'disco-dourado', name: 'Disco Dourado', genre: 'funk', mood: 'feliz', moods: ['energetica'], tags: ['disco', 'anos 70', 'festa'], bpm: 118, energy: 'alta', key: 9, seed: 802, description: 'Disco com bumbo reto, chimbal aberto e cordas.', style: { drumsA: { k: 'x...x...x...x...', s: '....x.......x...', o: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.' }, drumsB: { k: 'x...x...x...x...', s: '....X.......X...', o: '..x...x...x...x.', h: 'xgxgxgxgxgxgxgxg', p: 'x.......x.......' }, bass: { type: 'funk', pattern: 'offbeat', gain: 0.8 }, harm2: { inst: { pad: 'strings' }, rhythm: 'sustain', gain: 0.3 } } },
  { id: 'malandragem', name: 'Malandragem', genre: 'funk', mood: 'confiante', moods: ['divertida'], tags: ['groove', 'brasil', 'balanço'], bpm: 96, energy: 'media', key: 5, seed: 803, description: 'Balanço com guitarra-stab, órgão e swing.', style: { swing: 0.22, harm: { inst: { keys: 'epiano' }, rhythm: 'stab', gain: 0.5, lo: 55, hi: 74 } } },

  /* ---------- Ambiente / Calma ---------- */
  { id: 'nevoa', name: 'Névoa', genre: 'ambiente', mood: 'calma', moods: ['sonhadora'], tags: ['meditação', 'relaxar', 'natureza'], bpm: 70, energy: 'baixa', key: 2, seed: 901, description: 'Camadas etéreas, harpa e sinos distantes.' },
  { id: 'oceano-calmo', name: 'Oceano Calmo', genre: 'ambiente', mood: 'relaxante', moods: ['calma'], tags: ['mar', 'spa', 'respiração'], bpm: 64, energy: 'baixa', key: 9, seed: 902, description: 'Pads lentos como ondas, para respirar.', style: { scale: 'major', progA: [0, 3, 0, 4], progB: [5, 3, 0, 3], harm2: undefined } },
  { id: 'aurora', name: 'Aurora', genre: 'ambiente', mood: 'sonhadora', moods: ['inspiradora'], tags: ['céu', 'esperança', 'contemplação'], bpm: 76, energy: 'media', key: 4, seed: 903, description: 'Ambiente luminoso com pulso suave.', style: { drumsA: { x: '....x.......x...' }, drumsB: { k: 'x.......x.......', x: 'x.x.x.x.x.x.x.x.' }, bass: { type: 'sub', pattern: 'root4', gain: 0.55 } } },

  /* ---------- Suspense ---------- */
  { id: 'corredor-escuro', name: 'Corredor Escuro', genre: 'suspense', mood: 'tensa', moods: ['misteriosa'], tags: ['terror', 'mistério', 'investigação'], bpm: 90, energy: 'media', key: 4, seed: 1001, description: 'Pulsos graves, relógio e cordas dissonantes.' },
  { id: 'segredo', name: 'Segredo', genre: 'suspense', mood: 'misteriosa', moods: ['tensa'], tags: ['mistério', 'true crime', 'noir'], bpm: 80, energy: 'baixa', key: 9, seed: 1002, description: 'Suspense contido com piano esparso.', style: { lead: { kind: 'sparse', inst: { keys: 'piano' }, center: 72, gain: 0.4, sections: 'all', density: 0.3 }, drumsA: { k: 'x...............', p: 'g...g...g...g...' } } },
  { id: 'contagem-regressiva', name: 'Contagem Regressiva', genre: 'suspense', mood: 'tensa', moods: ['epica'], tags: ['tensão', 'urgência', 'thriller'], bpm: 110, energy: 'alta', key: 2, seed: 1003, description: 'Ostinato urgente com taikos e subidas.', style: { scale: 'harmonic', progA: [0, 0, 5, 4], progB: [0, 5, 1, 4], bass: { type: 'pulse', pattern: 'pulse', gain: 0.65 } } },

  /* ---------- Infantil / Divertida ---------- */
  { id: 'pula-pula', name: 'Pula-Pula', genre: 'infantil', mood: 'divertida', moods: ['feliz'], tags: ['criança', 'brincadeira', 'desenho'], bpm: 124, energy: 'alta', key: 0, seed: 1101, description: 'Ukulele, glockenspiel e palmas saltitantes.' },
  { id: 'bolhas-de-sabao', name: 'Bolhas de Sabão', genre: 'infantil', mood: 'feliz', moods: ['divertida'], tags: ['criança', 'fofo', 'leve'], bpm: 110, energy: 'media', key: 7, seed: 1102, description: 'Marimba fofa e assobio brincalhão.', style: { harm: { inst: { keys: 'mallet' }, rhythm: 'block', gain: 0.45 }, lead: { kind: 'melody', inst: { lead: 'whistle' }, center: 79, gain: 0.35, sections: 'all', density: 0.7 } } },
  { id: 'trapalhada', name: 'Trapalhada', genre: 'infantil', mood: 'divertida', tags: ['comédia', 'engraçado', 'bobeira'], bpm: 132, energy: 'alta', key: 5, seed: 1103, description: 'Comédia saltitante com baixo andando e pizzicato.', style: { bass: { type: 'finger', pattern: 'walking', gain: 0.75 }, harm: { inst: { keys: 'harp' }, rhythm: 'stab', gain: 0.45 }, lead: { kind: 'melody', inst: { lead: 'square' }, center: 79, gain: 0.3, sections: 'all', density: 0.85 } } },

  /* ---------- Romântica ---------- */
  { id: 'carta-de-amor', name: 'Carta de Amor', genre: 'romantica', mood: 'romantica', moods: ['calma'], tags: ['amor', 'casamento', 'piano'], bpm: 72, energy: 'baixa', key: 5, seed: 1201, description: 'Piano em arpejo, cordas e flauta suave.' },
  { id: 'primeiro-encontro', name: 'Primeiro Encontro', genre: 'romantica', mood: 'romantica', moods: ['feliz'], tags: ['casal', 'pedido', 'doce'], bpm: 92, energy: 'media', key: 0, seed: 1202, description: 'Romântica leve com violão e piano elétrico.', style: { harm: { inst: { keys: 'guitar' }, rhythm: 'pick', gain: 0.55 }, harm2: { inst: { keys: 'epiano' }, rhythm: 'halfs', gain: 0.35 } } },
  { id: 'para-sempre', name: 'Para Sempre', genre: 'romantica', mood: 'inspiradora', moods: ['romantica'], tags: ['casamento', 'emoção', 'votos'], bpm: 66, energy: 'baixa', key: 2, seed: 1203, description: 'Balada emocionante que cresce com cordas.', style: { harm: { inst: { keys: 'piano' }, rhythm: 'halfs', gain: 0.6 }, lead: { kind: 'melody', inst: { pad: 'strings' }, center: 74, gain: 0.4, sections: 'B', density: 0.35 } } },

  /* ---------- Vlog / Viagem ---------- */
  { id: 'mochila-nas-costas', name: 'Mochila nas Costas', genre: 'vlog', mood: 'aventureira', moods: ['feliz'], tags: ['viagem', 'tropical', 'praia'], bpm: 110, energy: 'media', key: 2, seed: 1301, description: 'Tropical house com marimba e pluck ensolarado.' },
  { id: 'cartao-postal', name: 'Cartão-Postal', genre: 'vlog', mood: 'feliz', moods: ['sonhadora'], tags: ['viagem', 'férias', 'vlog'], bpm: 100, energy: 'media', key: 9, seed: 1302, description: 'Vlog leve com violão, palmas e assobio.', style: { kit: { kick: 'soft', snare: 'snap', perc: 'conga', hatGain: 0.5 }, bass: { type: 'finger', pattern: 'root4', gain: 0.7 }, harm: { inst: { keys: 'guitar' }, rhythm: 'strum', gain: 0.5 }, lead: { kind: 'melody', inst: { lead: 'whistle' }, center: 79, gain: 0.32, sections: 'B', density: 0.6 }, fx: { reverb: 0.3, room: 0.5, delay: 0.2, sidechain: 0 } } },
  { id: 'rotina-boa', name: 'Rotina Boa', genre: 'vlog', mood: 'relaxante', moods: ['feliz'], tags: ['dia a dia', 'casa', 'lifestyle'], bpm: 96, energy: 'baixa', key: 5, seed: 1303, description: 'Batida chill para rotina e lifestyle.', style: { drumsA: { k: 'x.......x.......', s: '....x.......x...', x: 'x.x.x.x.x.x.x.x.' }, fx: { reverb: 0.35, room: 0.55, delay: 0.25, sidechain: 0.25 } } },
  { id: 'vista-do-alto', name: 'Vista do Alto', genre: 'vlog', mood: 'inspiradora', moods: ['aventureira'], tags: ['drone', 'paisagem', 'montanha'], bpm: 118, energy: 'alta', key: 7, seed: 1304, description: 'Pop eletrônico aberto para paisagens e drone.', style: { lead: { kind: 'melody', inst: { lead: 'super' }, center: 74, gain: 0.35, sections: 'B', density: 0.55 }, fx: { reverb: 0.45, room: 0.7, delay: 0.35, sidechain: 0.45, crash: true, riser: true } } },
];

export const MUSIC_CATALOG: MusicTrack[] = TRACKS.map((t) => ({ duration: 30, ...t }));

const BY_ID = new Map(MUSIC_CATALOG.map((t) => [t.id, t]));

export function musicTrack(id: string): MusicTrack | undefined {
  return BY_ID.get(id);
}

/** receita final da faixa (gênero + alterações) */
export function trackStyle(t: MusicTrack): Style {
  return mergeStyle(STYLES[t.genre], t.style);
}

/** "Lá menor", "Dó maior"… */
export function keyLabel(t: MusicTrack): string {
  const s = trackStyle(t).scale;
  const minorish = s === 'minor' || s === 'dorian' || s === 'phrygian' || s === 'harmonic';
  return `${NOTE_NAMES[t.key]} ${minorish ? 'menor' : 'maior'}`;
}
