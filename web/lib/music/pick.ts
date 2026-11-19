/* =====================================================================
   Música · escolha automática (IA) e busca. Puro.
   pickMusic({ mood: 'música animada', energy: 'alta' }) → id do catálogo.
   ===================================================================== */
import { ENERGY_LABELS, MOOD_LABELS, MUSIC_CATALOG, type Energy, type Mood, type MusicTrack } from './catalog';
import { GENRE_LABELS, type Genre } from './styles';

/** minúsculas e sem acentos */
export const normSearch = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

interface Hint { genres?: Genre[]; moods?: Mood[]; energy?: Energy }

/** palavras (sem acento) → gênero/humor/energia */
const SYNONYMS: [RegExp, Hint][] = [
  [/sertanej|modao|agro|rodeio|fazenda|interior|viola/, { genres: ['sertanejo'] }],
  [/forro|xote|baiao|sao joao|junina|quadrilha|nordest|sanfona/, { genres: ['forro'] }],
  [/pagode|samba|carnaval|cavaco|roda de/, { genres: ['pagode'] }],
  [/funk br|funk brasil|baile|tamborzao|mandelao|favela|dancinha|funk 150|funk melody/, { genres: ['funkbr'] }],
  [/gospel|louvor|adorac|igreja|crista|devocional|oracao|fe\b|culto|biblic/, { genres: ['gospel'] }],
  [/anima|alegr|feliz|happy|pra cima|positiv|contagiant|vibrant/, { moods: ['feliz', 'divertida', 'energetica'], energy: 'alta', genres: ['pop', 'vlog', 'funk'] }],
  [/calm|tranquil|relax|suave|paz|zen|medit|spa|dormir|sono|respira/, { moods: ['calma', 'relaxante'], energy: 'baixa', genres: ['ambiente', 'lofi', 'acustica'] }],
  [/lo.?fi|chill|estud|cafe/, { genres: ['lofi'], moods: ['relaxante', 'nostalgica'] }],
  [/epic|trailer|heroi|batalha|grandios|orquestr|cinemat|filme/, { genres: ['cinematica'], moods: ['epica'], energy: 'alta' }],
  [/suspens|tens|terror|medo|misteri|thriller|crime|sombri|investiga/, { genres: ['suspense'], moods: ['tensa', 'misteriosa'] }],
  [/romant|amor|casamento|love|paixa|namor|casal/, { genres: ['romantica'], moods: ['romantica'] }],
  [/corporat|empresa|institucional|negocio|apresenta|startup|tecnolog|produto|marca|propaganda|comercial/, { genres: ['corporativa'], moods: ['inspiradora', 'confiante'] }],
  [/inspira|motiva|supera|conquista|sucesso|esperanc/, { moods: ['inspiradora'], genres: ['corporativa', 'cinematica'] }],
  [/eletron|edm|house|balada|dance|danc|festa|rave|techno/, { genres: ['eletronica'], moods: ['energetica'], energy: 'alta' }],
  [/trap|hip.?hop|rap|urban|boom.?bap/, { genres: ['hiphop'], moods: ['confiante'] }],
  [/viage|vlog|praia|tropical|verao|feria|turism|paisag|drone/, { genres: ['vlog'], moods: ['aventureira', 'feliz'] }],
  [/aventur|jornada|explora/, { moods: ['aventureira'], genres: ['vlog', 'cinematica', 'acustica'] }],
  [/violao|acustic|folk|campo|country|roca|natureza/, { genres: ['acustica'] }],
  [/funk|groove|disco|balanc|suingue|swing/, { genres: ['funk'], moods: ['divertida'] }],
  [/crianc|infantil|kids|fofo|fofa|engracad|comedi|desenho|brincadeira|bebe/, { genres: ['infantil'], moods: ['divertida'] }],
  [/nostalg|saudade|melanc|triste|sad|emocion/, { moods: ['nostalgica', 'romantica'], energy: 'baixa' }],
  [/esport|treino|academia|acao|rapid|energ|intens|agitad|forte|pesad/, { moods: ['energetica'], energy: 'alta', genres: ['eletronica', 'hiphop'] }],
  [/sonhad|dream|etere|ceu|leve/, { moods: ['sonhadora'] }],
  [/lenta|devagar|baixa energia/, { energy: 'baixa' }],
  [/media|moderad/, { energy: 'media' }],
];

const ENERGY_ORDER: Energy[] = ['baixa', 'media', 'alta'];

export function normEnergy(e?: string): Energy | undefined {
  if (!e) return undefined;
  const n = normSearch(e);
  if (/baix|low|calm|suave/.test(n)) return 'baixa';
  if (/med|mid|moder/.test(n)) return 'media';
  if (/alt|high|forte|intens/.test(n)) return 'alta';
  return undefined;
}

export interface PickOptions {
  /** humor ou pedido livre ("animada", "música calma para vlog", "épica") */
  mood?: string;
  energy?: string;
  /** duração do vídeo (s) — hoje não restringe (toda faixa se ajusta), mas fica no contrato */
  duration?: number;
  genre?: Genre | string;
  /** evita repetir faixas (ex.: as que o projeto já usa) */
  exclude?: string[];
}

/** pontuação de cada faixa para um pedido (maior = melhor) */
export function scoreTracks(o: PickOptions): { track: MusicTrack; score: number }[] {
  const text = normSearch(`${o.mood ?? ''} ${o.genre ?? ''}`);
  const hint: Required<Hint> = { genres: [], moods: [], energy: normEnergy(o.energy) ?? ('' as Energy) };
  for (const [re, h] of SYNONYMS) {
    if (!re.test(text)) continue;
    hint.genres.push(...(h.genres ?? []));
    hint.moods.push(...(h.moods ?? []));
    if (h.energy && !hint.energy) hint.energy = h.energy;
  }
  // nomes de gênero/humor escritos por extenso
  for (const [g, label] of Object.entries(GENRE_LABELS)) if (text && (normSearch(label).split('/').some((w) => text.includes(w)) || text.includes(g))) hint.genres.push(g as Genre);
  for (const [m, label] of Object.entries(MOOD_LABELS)) if (text && text.includes(normSearch(label).slice(0, 5))) hint.moods.unshift(m as Mood);
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  return MUSIC_CATALOG.map((t, i) => {
    let s = 0;
    const gi = hint.genres.indexOf(t.genre);
    if (gi >= 0) s += 3 - Math.min(1.5, gi * 0.3);
    const mi = hint.moods.indexOf(t.mood);
    if (mi >= 0) s += 3 - Math.min(1.5, mi * 0.3);
    if (t.moods?.some((m) => hint.moods.includes(m))) s += 1.2;
    if (hint.energy) {
      const d = Math.abs(ENERGY_ORDER.indexOf(t.energy) - ENERGY_ORDER.indexOf(hint.energy));
      s += d === 0 ? 2 : d === 1 ? 0.4 : -1;
    }
    const hay = normSearch(`${t.name} ${t.tags.join(' ')} ${t.description}`);
    for (const w of words) if (hay.includes(w)) s += 1;
    if (o.exclude?.includes(t.id)) s -= 5;
    // desempate estável: ordem do catálogo
    return { track: t, score: s - i * 1e-4 };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Faixa do catálogo para um pedido como "música animada" (sem arquivo do usuário).
 * Sempre devolve um id válido.
 */
export function pickMusic(o: PickOptions = {}): string {
  return scoreTracks(o)[0]?.track.id ?? MUSIC_CATALOG[0].id;
}

/** busca livre (nome, gênero, humor, tags, descrição, BPM) — sem acentos */
export function matchesMusic(t: MusicTrack, query: string): boolean {
  const q = normSearch(query);
  if (!q) return true;
  const hay = normSearch([t.name, t.genre, GENRE_LABELS[t.genre], GENRE_LABELS[t.genre].replace(/-/g, ''), MOOD_LABELS[t.mood], ...(t.moods ?? []).map((m) => MOOD_LABELS[m]), ...t.tags, t.description, `${t.bpm} bpm`, `energia ${ENERGY_LABELS[t.energy]}`].join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}
