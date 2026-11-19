/* WAV enviado ao servidor de transcrição */
import { describe, expect, it } from 'vitest';
import { encodeWav } from './whisper';

describe('encodeWav', () => {
  it('gera WAV PCM 16 bits 16 kHz mono com o tamanho certo', () => {
    const s = new Float32Array(16000).map((_, i) => Math.sin(i / 10));
    const buf = encodeWav(s);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 32000);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    expect(Math.abs(v.getInt16(44 + 2 * 15, true) - Math.sin(1.5) * 0x7fff)).toBeLessThanOrEqual(1);
  });
});

/* ---------- caminho do servidor: retry por trecho e queda só do trecho que falhou (plano §1.5) ---------- */
import { serverChunks, type ServerDeps } from './whisper';

function fakeFetch(plan: Record<number, (number | 'ok')[]>, calls: Record<number, number>, onRetryAfter = 0): ServerDeps['fetch'] {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    // descobre o trecho pelo tamanho do WAV (cada trecho do teste tem duração diferente)
    const bytes = (init!.body as ArrayBuffer).byteLength;
    const secs = Math.round((bytes - 44) / 32000);
    calls[secs] = (calls[secs] ?? 0) + 1;
    const step = plan[secs][Math.min(calls[secs] - 1, plan[secs].length - 1)];
    if (step === 'ok') {
      return new Response(JSON.stringify({ provider: 'groq', model: 'whisper-large-v3-turbo', words: [{ word: 'oi', start: 0.5, end: 0.8 }, { word: 'fim', start: secs - 0.2, end: secs + 5 }, { word: 'antes', start: -1, end: 0.1 }] }), { status: 200 });
    }
    const headers: Record<string, string> = step === 429 && onRetryAfter ? { 'Retry-After': String(onRetryAfter) } : {};
    return new Response(JSON.stringify({ error: `falha ${step}` }), { status: step, headers });
  }) as ServerDeps['fetch'];
}

describe('serverChunks', () => {
  const audio = new Float32Array(16000 * 20);
  const jobs = [{ a: 0, b: 3 }, { a: 3, b: 7 }, { a: 7, b: 12 }, { a: 12, b: 18 }];

  it('tenta de novo em 429/5xx (respeitando Retry-After) e prende as palavras ao trecho', async () => {
    const calls: Record<number, number> = {};
    const waits: number[] = [];
    const res = await serverChunks(audio, jobs, {}, { fetch: fakeFetch({ 3: [429, 'ok'], 4: [503, 502 as never, 'ok'], 5: ['ok'], 6: ['ok'] }, calls, 2), sleep: async (ms) => { waits.push(ms); } });
    expect(res.failed).toEqual([{ a: 3, b: 7 }]); // 502 = não repete (erro do provedor que não melhora)
    expect(calls[3]).toBe(2);
    expect(waits).toContain(2000);
    expect(res.label).toBe('Groq whisper-large-v3-turbo');
    // tempos dentro de cada trecho e em ordem
    for (const c of res.chunks) expect(c.timestamp[0]).toBeGreaterThanOrEqual(0);
    const t = res.chunks.map((c) => c.timestamp[0]);
    expect([...t].sort((x, y) => x - y)).toEqual(t);
    const fim = res.chunks.filter((c) => c.text.trim() === 'fim');
    expect(fim.map((c) => c.timestamp[1])).toEqual([3, 12, 18]);
  });

  it('um trecho que sempre falha volta sozinho em `failed` (o resto não é refeito)', async () => {
    const calls: Record<number, number> = {};
    const res = await serverChunks(audio, jobs, {}, { fetch: fakeFetch({ 3: ['ok'], 4: ['ok'], 5: [500, 500, 500], 6: ['ok'] }, calls), sleep: async () => {} });
    expect(res.failed).toEqual([{ a: 7, b: 12 }]);
    expect(calls[5]).toBe(3); // 1 + 2 tentativas
    expect(calls[3]).toBe(1);
    expect(res.chunks.length).toBe(9);
  });

  it('cancelamento interrompe', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(serverChunks(audio, jobs, { signal: ctrl.signal }, { fetch: fakeFetch({ 3: ['ok'], 4: ['ok'], 5: ['ok'], 6: ['ok'] }, {}), sleep: async () => {} })).rejects.toThrow(/cancelada/);
  });
});

import { wordsToSegments } from './words';
describe('frases sem sobra solta', () => {
  const mk = (txt: string, t0 = 0, step = 0.3) => txt.split(' ').map((w, i) => ({ text: ` ${w}`, timestamp: [t0 + i * step, t0 + i * step + 0.25] as [number, number] }));
  it('frase longa quebra na vírgula e não deixa 1 palavra sozinha no fim', () => {
    const segs = wordsToSegments(mk('Se você gostou, deixe o seu like e me segue para mais receitas.'), { duration: 10, maxWords: 12, maxDur: 6, pauseGap: 0.45 });
    expect(segs.every((s) => s.text.split(' ').length >= 3)).toBe(true);
    expect(segs.map((s) => s.text).join(' ')).toBe('Se você gostou, deixe o seu like e me segue para mais receitas.');
  });
  it('quebra no ponto bom da 2ª metade', () => {
    const segs = wordsToSegments(mk('Primeiro, separe três ovos, uma xícara de açúcar e duas xícaras de farinha.'), { duration: 10, maxWords: 12, maxDur: 6, pauseGap: 0.45 });
    expect(segs.some((s) => s.text.split(' ').length <= 2)).toBe(false);
  });
});
