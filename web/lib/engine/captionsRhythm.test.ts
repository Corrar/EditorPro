/* blocos de legenda no ritmo da fala (sessão legendas, plano §2.6) — medido com a fala real das fixtures */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { CaptionSegment } from '../types';
import { captionCutPoints, chunkCaptions, chunkCaptionsFor, rhythmFor, type CaptionChunk } from './captions';
import { chunksToCaptions } from '../ai/whisper';
import { energyRuns } from '../ai/vad';

const FX = path.resolve(__dirname, '../../../docs/fixtures/legendas-modelo');
const hasFx = fs.existsSync(FX);
let ffmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch { /* sem ffmpeg */ }

function captionsOf(id: string): CaptionSegment[] {
  const d = JSON.parse(fs.readFileSync(path.join(FX, 'whisper-results/whisper-base_timestamped__q8__app.json'), 'utf8'));
  const c = d.clips.find((x: { id: string }) => x.id === id);
  let runs;
  if (ffmpeg) {
    const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(FX, 'whisper-clips', `${id}.m4a`), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 64 << 20 });
    runs = energyRuns(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
  }
  return chunksToCaptions(c.words, runs, c.duration);
}

/** métricas de legibilidade/ritmo */
function metrics(ch: CaptionChunk[], pause = 0.3) {
  let mixing = 0, orphans = 0, blinks = 0, minOn = Infinity, glueEnd = 0;
  const GLUE = /^(o|a|os|as|um|uma|de|do|da|dos|das|no|na|em|com|para|pra|por|que|e)$/i;
  ch.forEach((c, i) => {
    for (let k = 1; k < c.words.length; k++) if (c.words[k].start - c.words[k - 1].end >= pause) mixing++;
    const dur = c.end - c.start;
    minOn = Math.min(minOn, dur);
    if (c.words.length === 1 && c.words[0].end - c.words[0].start < 0.35 && dur < 0.35) orphans++;
    const nx = ch[i + 1];
    if (nx && nx.start - c.end > 0.001 && nx.start - c.end < 0.2) blinks++; // apaga e volta logo
    if (dur < 0.3) blinks++; // pisca na tela
    if (nx && GLUE.test(c.words[c.words.length - 1].text.replace(/[^\p{L}]/gu, ''))) glueEnd++;
  });
  return { mixing, orphans, blinks, minOn, glueEnd };
}

describe.skipIf(!hasFx)('ritmo da fala com transcrição real (Whisper base)', () => {
  it('maxWords 3: nada de frase misturada com a seguinte nem órfãs; menos piscadas e mais tempo de leitura que antes', () => {
    const report: string[] = [];
    for (const id of ['A_intro', 'B_fast', 'D_pauses', 'E_long', 'B_vfast']) {
      const segs = captionsOf(id);
      const old = metrics(chunkCaptions(segs, 3));
      const now = metrics(chunkCaptionsFor(segs, { maxWords: 3 }));
      report.push(`${id}: mistura ${old.mixing}→${now.mixing} órfãs ${old.orphans}→${now.orphans} piscadas ${old.blinks}→${now.blinks} mín ${old.minOn.toFixed(2)}→${now.minOn.toFixed(2)} s, artigo no fim ${old.glueEnd}→${now.glueEnd}`);
      expect(now.mixing, `${id} mistura`).toBe(0);
      expect(now.orphans, `${id} órfãs`).toBe(0);
      expect(now.blinks, `${id} piscadas`).toBeLessThanOrEqual(old.blinks);
      expect(now.minOn, `${id} mínimo na tela`).toBeGreaterThanOrEqual((id === "B_vfast" ? 0.2 : Math.min(old.minOn, 0.3)) - 1e-6);
      expect(now.glueEnd, `${id} artigo no fim`).toBeLessThanOrEqual(old.glueEnd);
      // fala em ritmo normal: nada pisca (< 0,3 s); a fala 1,25× acelerada (B_vfast) é rápida demais p/ 3 palavras
      if (id !== 'B_vfast') expect(now.blinks, `${id} piscadas`).toBe(0);
    }
    console.log(`[ritmo] ${report.join('\n[ritmo] ')}`);
  });
  it('todas as palavras aparecem, na ordem, e cada uma está na tela enquanto é falada', () => {
    const segs = captionsOf('A_intro');
    const ch = chunkCaptionsFor(segs, { maxWords: 3 });
    expect(ch.flatMap((c) => c.words.map((w) => w.text))).toEqual(segs.flatMap((s) => s.words!.map((w) => w.text)));
    for (const c of ch) for (const w of c.words) {
      expect(c.start).toBeLessThanOrEqual(w.start + 1e-9);
      expect(c.end).toBeGreaterThanOrEqual(Math.min(w.end, c.end));
    }
    for (let i = 1; i < ch.length; i++) expect(ch[i].start).toBeGreaterThanOrEqual(ch[i - 1].end - 1e-9);
  });
});

describe('rhythmFor / casos sintéticos', () => {
  const W = (text: string, start: number, end: number) => ({ text, start, end });
  const seg = (words: { text: string; start: number; end: number }[]): CaptionSegment => ({ id: 's', start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(' '), words });

  it('presets derivados do maxWords; "count" desliga', () => {
    expect(rhythmFor({ maxWords: 1 })?.minOn).toBe(0.22);
    expect(rhythmFor({ maxWords: 3 })?.pauseBreak).toBe(0.2);
    expect(rhythmFor({ maxWords: 7 })?.tailHold).toBe(0.4);
    expect(rhythmFor({ maxWords: 3, rhythm: 'phrase' })?.maxWords).toBe(3);
    expect(rhythmFor({ maxWords: 3, rhythm: 'count' })).toBeNull();
  });
  it('quebra na pausa, não depois de artigo, e não separa número da unidade', () => {
    const s = seg([W('mostrar', 0, 0.4), W('o', 0.42, 0.5), W('truque', 0.52, 0.9), W('de', 1.3, 1.4), W('90', 1.42, 1.7), W('por', 1.72, 1.85), W('cento', 1.87, 2.2)]);
    const ch = chunkCaptionsFor([s], { maxWords: 3 });
    const txt = ch.map((c) => c.words.map((w) => w.text).join(' '));
    expect(txt).toContain('mostrar o truque');
    expect(txt.some((t) => /90$/.test(t))).toBe(false);
  });
  it('corte de edição entre palavras vira troca de bloco', () => {
    const s = seg([W('um', 0, 0.3), W('dois', 0.32, 0.6), W('três', 0.62, 0.9), W('quatro', 0.92, 1.2), W('cinco', 1.22, 1.5), W('seis', 1.52, 1.8)]);
    const ch = chunkCaptionsFor([s], { maxWords: 3 }, [0.61]);
    expect(ch[0].words.map((w) => w.text)).toEqual(['um', 'dois']);
  });
  it('bloco entra um pouco antes da fala e segura depois (sem piscar no meio da frase)', () => {
    const s = seg([W('oi', 1, 1.2), W('gente', 1.25, 1.6), W('tudo', 2.5, 2.7), W('bem', 2.72, 3)]);
    const ch = chunkCaptionsFor([s], { maxWords: 3 });
    expect(ch[0].start).toBeCloseTo(0.94, 2);
    expect(ch[0].end).toBeCloseTo(1.85, 2);
    expect(ch[1].start).toBeCloseTo(2.44, 2);
    expect(ch[1].end).toBeCloseTo(3.25, 2);
  });
  it('captionCutPoints: início dos clipes de vídeo (menos o 1º)', () => {
    expect(captionCutPoints([{ kind: 'video', clips: [{ type: 'video', start: 0 }, { type: 'video', start: 4.2 }] }, { kind: 'audio', clips: [{ type: 'audio', start: 3 }] }])).toEqual([4.2]);
  });
  it('número continua no modo antigo (compatível)', () => {
    const s = seg([W('a', 0, 0.5), W('b', 0.5, 1), W('c', 1, 1.5), W('d', 1.5, 2)]);
    expect(chunkCaptions([s], 3).map((c) => c.words.length)).toEqual([3, 1]);
  });
});

describe('ritmo respeita a legenda encurtada/movida (regressão r2 biblioteca #2, igual a textR2.test.ts)', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => ({ id: 'w' + i, text, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const seg = (start: number, end: number): CaptionSegment => ({ id: 's', start, end, text: 'a b c d e f', words });
  it('fim puxado para 1,5 s: nada aparece depois de 1,5 s', () => {
    const ch = chunkCaptionsFor([seg(0, 1.5)], { maxWords: 3 });
    expect(ch[ch.length - 1].end).toBeLessThanOrEqual(1.5 + 1e-9);
    for (const c of ch) for (const w of c.words) expect(w.end).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(ch.flatMap((c) => c.words.map((w) => w.text)).join(' ')).toBe('a b c d e f');
  });
  it('início puxado para 2 s: nada aparece antes de 2 s', () => {
    const ch = chunkCaptionsFor([seg(2, 3)], { maxWords: 3 });
    expect(ch[0].start).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(ch[ch.length - 1].end).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe('quebra obrigatória nunca fica DENTRO do bloco (review r3: a DP só olhava a última fronteira)', () => {
  const W = (text: string, start: number, end: number) => ({ text, start, end });
  it('fim de frase curto seguido de fala rápida: "Sim." não divide bloco com a frase seguinte', () => {
    const words = [W('Sim.', 0, 0.1), W('vamos', 0.12, 0.3), W('lá', 0.32, 0.42), W('agora', 0.44, 0.7)];
    const s: CaptionSegment = { id: 's', start: 0, end: 0.7, text: words.map((w) => w.text).join(' '), words };
    for (const maxWords of [3, 4, 7]) {
      const ch = chunkCaptionsFor([s], { maxWords });
      for (const c of ch) for (let k = 0; k < c.words.length - 1; k++) expect(c.words[k].text, `maxWords ${maxWords}: ${c.words.map((w) => w.text).join(' ')}`).not.toMatch(/[.!?…]$/);
    }
  });
  it('pausa longa (≥ hardGap) no meio: as palavras depois da pausa não aparecem antes de serem ditas', () => {
    const words = [W('Então', 0, 0.12), W('olha', 0.9, 1.0), W('isso', 1.02, 1.2)];
    const s: CaptionSegment = { id: 's', start: 0, end: 1.2, text: 'Então olha isso', words };
    for (const maxWords of [3, 7]) {
      const ch = chunkCaptionsFor([s], { maxWords });
      for (const c of ch) for (let k = 1; k < c.words.length; k++) expect(c.words[k].start - c.words[k - 1].end, `maxWords ${maxWords}`).toBeLessThan(0.5);
    }
  });
});
