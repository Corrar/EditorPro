/* review r3 (legendas): transcrição no servidor — a API devolve palavras sem pontuação */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { punctuateWords, transcribeWav } from './server/transcribe';
import { wordsToSegments } from './words';

const TEXT = 'Oi gente, hoje eu vou mostrar como fazer um bolo de chocolate muito fácil. Primeiro, separe três ovos, uma xícara de açúcar e duas xícaras de farinha.';
/** formato da API de áudio (OpenAI/Groq verbose_json + word timestamps): `words` sem pontuação */
const apiWords = TEXT.replace(/[.,]/g, '').split(' ').map((w, i) => ({ word: w, start: i * 0.32, end: i * 0.32 + 0.28 }));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('transcribeWav: pontuação do texto volta para as palavras', () => {
  it('legenda com vírgula/ponto e frase quebrando no fim da frase', async () => {
    vi.stubEnv('GROQ_API_KEY', 'x');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: TEXT, words: apiWords, segments: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const out = await transcribeWav(new ArrayBuffer(8), 'pt-BR');
    expect(out.words.map((w) => w.word).join(' ')).toBe(TEXT);
    expect(out.words.map((w) => [w.start, w.end])).toEqual(apiWords.map((w) => [w.start, w.end])); // tempos intactos
    const segs = wordsToSegments(out.words.map((w) => ({ text: ` ${w.word}`, timestamp: [w.start, w.end] as [number, number] })), { duration: 60 });
    expect(segs[0].text.endsWith('fácil.')).toBe(true); // antes: "…chocolate muito fácil Primeiro separe…" na mesma frase, sem pontuação
    expect(segs.map((s) => s.text).join(' ')).toBe(TEXT);
  });
});

describe('punctuateWords', () => {
  it('palavra escrita junta no texto ("meia-noite") e separada nas palavras', () => {
    const ws = ['acaba', 'à', 'meia', 'noite', 'hoje'].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
    expect(punctuateWords(ws, 'Acaba à meia-noite, hoje!').map((w) => w.word)).toEqual(['Acaba', 'à', 'meia', 'noite,', 'hoje!']);
  });
  it('palavra a mais/menos no texto não desalinha o resto', () => {
    const ws = ['oi', 'gente', 'tudo', 'bem'].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
    expect(punctuateWords(ws, 'Oi, gente! Tudo bem?').map((w) => w.word)).toEqual(['Oi,', 'gente!', 'Tudo', 'bem?']);
    expect(punctuateWords(ws, 'Oi, minha gente! Tudo bem?').map((w) => w.word)).toEqual(['Oi,', 'gente!', 'Tudo', 'bem?']);
    expect(punctuateWords(ws.filter((w) => w.word !== 'tudo'), 'Oi, gente! Tudo bem?').map((w) => w.word)).toEqual(['Oi,', 'gente!', 'bem?']);
  });
  it('palavras que já vêm pontuadas ficam como estão', () => {
    const ws = [{ word: 'Oi,', start: 0, end: 1 }, { word: 'gente', start: 1, end: 2 }];
    expect(punctuateWords(ws, 'Oi, gente.')).toBe(ws);
  });
});
