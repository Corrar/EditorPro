/* review r3 (legendas): corrigir o TEXTO de uma legenda no painel mantém os tempos reais das palavras */
import { describe, expect, it } from 'vitest';
import type { CaptionSegment } from '../types';
import { retextSegment, wordIdMaker } from './words';
import { captionLook, chunkCaptionsFor, chunkAt, wordStates } from '../engine/captions';

// fala com pausa no meio: "Oi gente, | (pausa 1,2 s) | hoje tem bolo de chocolat" (Whisper errou "chocolate")
const words = [
  { id: 'w00001', text: 'Oi', start: 0.2, end: 0.45 },
  { id: 'w00002', text: 'gente,', start: 0.5, end: 0.9 },
  { id: 'w00003', text: 'hoje', start: 2.1, end: 2.4 },
  { id: 'w00004', text: 'tem', start: 2.45, end: 2.65 },
  { id: 'w00005', text: 'bolo', start: 2.7, end: 3.0 },
  { id: 'w00006', text: 'de', start: 3.05, end: 3.15 },
  { id: 'w00007', text: 'chocolat', start: 3.2, end: 3.8 },
];
const seg: CaptionSegment = { id: 's', start: 0.2, end: 3.8, text: words.map((w) => w.text).join(' '), words };

/** palavra acesa (karaokê) no instante t */
function lit(s: CaptionSegment, t: number): string | undefined {
  const ch = chunkCaptionsFor([s], { maxWords: 3 });
  const c = chunkAt(ch, t);
  if (!c) return undefined;
  const st = wordStates(c, t, captionLook('karaoke'));
  return c.words[st.findIndex((x) => x.active)]?.text;
}

describe('retextSegment (painel Legendas)', () => {
  it('corrigir a grafia mantém tempos e ids', () => {
    const r = retextSegment(seg, 'Oi gente, hoje tem bolo de chocolate', wordIdMaker(words));
    expect(r.words!.map((w) => [w.id, w.text, w.start, w.end])).toEqual(words.map((w, i) => [w.id, i === 6 ? 'chocolate' : w.text, w.start, w.end]));
  });
  it('inserir/remover palavra: as outras ficam no tempo da fala; ids novos no padrão wNNNNN', () => {
    const r = retextSegment(seg, 'Oi gente, hoje tem bolo de chocolate sim', wordIdMaker(words));
    expect(r.words!.length).toBe(8);
    expect(r.words!.slice(0, 5).map((w) => w.start)).toEqual([0.2, 0.5, 2.1, 2.45, 2.7]);
    expect(r.words!.some((w) => w.id === 'w00008')).toBe(true);
    const r2 = retextSegment(seg, 'Oi gente, hoje tem bolo', wordIdMaker(words));
    expect(r2.words!.map((w) => w.start)).toEqual([0.2, 0.5, 2.1, 2.45, 2.7]);
  });
  it('karaokê continua no tempo da fala depois da correção (antes: words apagadas → acendia por proporção)', () => {
    const fixed: CaptionSegment = { ...seg, ...retextSegment(seg, 'Oi gente, hoje tem bolo de chocolate', wordIdMaker(words)) };
    const old: CaptionSegment = { ...seg, text: 'Oi gente, hoje tem bolo de chocolate', words: undefined };
    // em 2,2 s quem fala é "hoje"; em 1,5 s ninguém (pausa)
    expect(lit(fixed, 2.2)).toBe('hoje');
    expect(lit(fixed, 1.5)).toBeUndefined();
    expect(lit(old, 2.2)).not.toBe('hoje'); // comportamento antigo do painel (prova do bug)
  });
  it('legenda sem palavras (manual) continua sem; texto vazio não deixa palavras', () => {
    expect(retextSegment({}, 'nova legenda', wordIdMaker([])).words).toBeUndefined();
    expect(retextSegment(seg, '   ', wordIdMaker(words)).words).toBeUndefined();
  });
});
