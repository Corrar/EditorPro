/* asrFilter + vad com saídas MEDIDAS do Whisper (docs/fixtures/legendas-modelo) */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { filterAsr, normToken } from './asrFilter';
import { energyRuns, refineWordTimes, speechSeconds } from './vad';
import type { WhisperChunk } from './words';

const FX = path.resolve(__dirname, '../../../docs/fixtures/legendas-modelo');
const hasFx = fs.existsSync(FX);
const results = (f: string): { clips: { id: string; duration: number; words: WhisperChunk[] }[] } =>
  JSON.parse(fs.readFileSync(path.join(FX, 'whisper-results', f), 'utf8'));
const clip = (f: string, id: string) => results(f).clips.find((c) => c.id === id)!;
const manifest: { id: string; sentences?: { text: string; start: number; end: number }[] }[] = hasFx
  ? JSON.parse(fs.readFileSync(path.join(FX, 'whisper-clips/manifest.json'), 'utf8')) : [];

let ffmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch { /* sem ffmpeg: só testes sem áudio */ }
const pcmCache = new Map<string, Float32Array>();
function pcm(id: string): Float32Array {
  if (!pcmCache.has(id)) {
    const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(FX, 'whisper-clips', `${id}.m4a`), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 64 << 20 });
    pcmCache.set(id, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
  }
  return pcmCache.get(id)!;
}

const CLEAN = ['A_intro', 'B_fast', 'D_pauses', 'E_long', 'R_12249_12879_001458', 'R_5677_4807_001093', 'R_4367_3698_000162', 'R_9958_6390_000005', 'B_fast30', 'F_concat', 'B_vfast'];
const MODELS = ['whisper-base_timestamped__q8__app.json', 'whisper-small_timestamped__q8__app.json', 'whisper-large-v3-turbo_timestamped__q8__app.json', 'whisper-tiny_timestamped__fp32__app.json'];

describe.skipIf(!hasFx)('filterAsr (sem áudio)', () => {
  it('fala limpa passa intacta em todos os modelos', () => {
    for (const f of MODELS) for (const c of results(f).clips) {
      if (!CLEAN.includes(c.id)) continue;
      expect(filterAsr(c.words, undefined, { duration: c.duration }).length, `${f} ${c.id}`).toBe(c.words.length);
    }
  });
  it('loop de contagem do tiny ("1, 2, 3, 4, 5, 5, 6…") some, a fala real fica', () => {
    const c = clip('whisper-tiny_timestamped__q8__app.json', 'R_4367_3698_000162');
    const out = filterAsr(c.words, undefined, { duration: c.duration });
    const nums = out.filter((w) => /^\d+$/.test(normToken(w.text)));
    expect(nums.length).toBeLessThanOrEqual(2);
    expect(out.map((w) => normToken(w.text)).join(' ')).toContain('um retrato qualquer do senhor');
    expect(out.every((w) => w.timestamp[0] < c.duration)).toBe(true);
  });
  it('"sejam gostos de sejam gostas…" (tiny, fala + música) perde o loop', () => {
    const c = clip('whisper-tiny_timestamped__q8__app.json', 'C_music10');
    const out = filterAsr(c.words, undefined, { duration: c.duration }).map((w) => normToken(w.text));
    let worst = 0;
    for (let i = 0; i < out.length; i++) worst = Math.max(worst, out.slice(i, i + 10).filter((x) => x.startsWith('sej')).length);
    expect(worst).toBeLessThan(3);
  });
  it('música pura: nenhuma palavra sobra (base, small, tiny)', () => {
    for (const f of ['noise__base.json', 'noise__small.json', 'noise__tiny.json']) {
      const c = clip(f, 'N_music_only');
      expect(filterAsr(c.words, undefined, { duration: c.duration }), f).toEqual([]);
    }
  });
  it('a fala depois da música (N_intro_music) fica inteira', () => {
    const c = clip('noise__base.json', 'N_intro_music');
    expect(filterAsr(c.words, undefined, { duration: c.duration }).length).toBe(c.words.length);
  });
  it('frase-fantasma em silêncio some; com voz embaixo fica', () => {
    const words: WhisperChunk[] = 'espero que tenham gostado'.split(' ').map((t, i) => ({ text: ` ${t}`, timestamp: [10 + i * 0.3, 10.25 + i * 0.3] }));
    expect(filterAsr(words, [{ start: 0, end: 5 }, { start: 9.6, end: 9.7 }])).toEqual([]);
    expect(filterAsr(words, [{ start: 9.8, end: 11.4 }]).length).toBe(4);
  });
  it('amara.org / "legendas pela comunidade" somem sempre', () => {
    const words: WhisperChunk[] = 'Legendas pela comunidade Amara.org'.split(' ').map((t, i) => ({ text: ` ${t}`, timestamp: [1 + i * 0.3, 1.25 + i * 0.3] }));
    expect(filterAsr(words, [{ start: 0, end: 3 }])).toEqual([]);
  });
});

describe.skipIf(!hasFx || !ffmpeg)('vad + filtro com o áudio real', () => {
  it('com VAD: fala limpa intacta, música pura vazia', () => {
    for (const f of MODELS) for (const c of results(f).clips) {
      if (!CLEAN.includes(c.id)) continue;
      const runs = energyRuns(pcm(c.id));
      expect(filterAsr(c.words, runs, { duration: c.duration }).length, `${f} ${c.id}`).toBe(c.words.length);
    }
    const c = clip('whisper-base_timestamped__q8__app.json', 'N_music_only');
    expect(filterAsr(c.words, energyRuns(pcm(c.id)), { duration: c.duration })).toEqual([]);
  });

  it('refineWordTimes tira o atraso do Whisper base (|viés| < 0,03 s nas bordas de frase)', () => {
    const f = 'whisper-base_timestamped__q8__app.json';
    const before: number[] = [], after: number[] = [], endB: number[] = [], endA: number[] = [];
    for (const id of ['A_intro', 'B_fast', 'D_pauses', 'E_long']) {
      const c = clip(f, id);
      const runs = energyRuns(pcm(id));
      const raw = filterAsr(c.words, runs, { duration: c.duration });
      const ref = refineWordTimes(raw, runs);
      const m = manifest.find((x) => x.id === id)!;
      for (const s of m.sentences ?? []) {
        const toks = s.text.split(/\s+/);
        const fw = normToken(toks[0]), lw = normToken(toks[toks.length - 1]);
        const pick = (arr: WhisperChunk[], key: string, t: number, k: 0 | 1) => {
          let best: WhisperChunk | null = null;
          for (const w of arr) if (normToken(w.text) === key && (!best || Math.abs((w.timestamp[k] ?? 0) - t) < Math.abs((best.timestamp[k] ?? 0) - t))) best = w;
          return best && Math.abs((best.timestamp[k] ?? 0) - t) < 1 ? (best.timestamp[k] ?? 0) - t : null;
        };
        const a = pick(raw, fw, s.start, 0), b = pick(ref, fw, s.start, 0);
        if (a !== null && b !== null) { before.push(a); after.push(b); }
        const c2 = pick(raw, lw, s.end, 1), d = pick(ref, lw, s.end, 1);
        if (c2 !== null && d !== null) { endB.push(c2); endA.push(d); }
      }
    }
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(before.length).toBeGreaterThan(10);
    expect(mean(before)).toBeGreaterThan(0.1); // o atraso medido existe
    expect(Math.abs(mean(after))).toBeLessThan(0.03);
    expect(mean(endB)).toBeGreaterThan(0.1); // a última palavra "pendura" no silêncio
    expect(Math.abs(mean(endA))).toBeLessThan(0.03);
  });
});

describe('vad (sintético)', () => {
  const RATE = 16000;
  /** rajadas de "fala" (ruído modulado) em tempos conhecidos */
  function bursts(total: number, on: [number, number][]): Float32Array {
    const a = new Float32Array(total * RATE);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < a.length; i++) a[i] = rnd() * 0.0005;
    for (const [s, e] of on) for (let i = Math.floor(s * RATE); i < Math.floor(e * RATE); i++) a[i] = rnd() * 0.3 * (0.6 + 0.4 * Math.sin(i / 300));
    return a;
  }
  const ON: [number, number][] = [[1, 1.4], [1.5, 2.1], [3, 3.5], [3.6, 4.2], [6, 6.8]];

  it('energyRuns acha as bordas com erro < 20 ms', () => {
    const runs = energyRuns(bursts(8, ON));
    expect(runs.length).toBe(ON.length);
    runs.forEach((r, i) => {
      expect(Math.abs(r.start - ON[i][0])).toBeLessThan(0.02);
      expect(Math.abs(r.end - ON[i][1])).toBeLessThan(0.02);
    });
  });

  it('refineWordTimes: palavras +0,2 s atrasadas voltam (|viés| < 0,03 s)', () => {
    const runs = energyRuns(bursts(8, ON));
    const chunks: WhisperChunk[] = ON.map(([s, e], i) => ({ text: ` palavra${i}`, timestamp: [s + 0.2, e + 0.2] }));
    const out = refineWordTimes(chunks, runs);
    const bias = out.reduce((n, w, i) => n + (w.timestamp[0] - ON[i][0]), 0) / out.length;
    const biasEnd = out.reduce((n, w, i) => n + ((w.timestamp[1] ?? 0) - ON[i][1]), 0) / out.length;
    expect(Math.abs(bias)).toBeLessThan(0.03);
    expect(Math.abs(biasEnd)).toBeLessThan(0.03);
  });

  it('palavras sem duração ganham tempo mínimo e a ordem fica monotônica', () => {
    const out = refineWordTimes([{ text: ' a', timestamp: [2, 2] }, { text: ' casa', timestamp: [2, 2] }, { text: ' azul', timestamp: [2, null] }], []);
    for (let i = 0; i < out.length; i++) {
      expect((out[i].timestamp[1] ?? 0) - out[i].timestamp[0]).toBeGreaterThanOrEqual(0.05);
      if (i) expect(out[i].timestamp[0]).toBeGreaterThanOrEqual((out[i - 1].timestamp[1] ?? 0) - 1e-9);
    }
  });

  it('2 s de fala dentro de 60 s de silêncio contam como fala (≥ 0,4 s)', () => {
    const a = bursts(60, [[30, 31], [31.2, 32.2]]);
    expect(speechSeconds(energyRuns(a))).toBeGreaterThan(1.5);
    expect(speechSeconds(energyRuns(new Float32Array(60 * RATE)))).toBe(0);
  });
});
