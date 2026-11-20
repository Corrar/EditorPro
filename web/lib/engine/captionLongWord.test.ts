/* review r3 (legendas): palavra sozinha mais larga que o quadro diminui até caber (antes saía cortada nas bordas).
   Repro no navegador (exportFrame 1080×1920, fonte 76, "www.receitasdavovo.com.br"): pixels do texto em x=0…1079;
   depois do ajuste, x=93…986. */
import { describe, expect, it } from 'vitest';
import { createProject } from '../defaults';
import type { Project } from '../types';
import { drawCaptions } from './textDraw';
import type { Ctx } from './surface';

/** contexto 2D falso: mede 0,6 em por caractere e guarda o tamanho de fonte de cada texto desenhado */
function fakeCtx() {
  let font = '10px x';
  const drawn: { text: string; px: number }[] = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: [...s].length * px() * 0.6, actualBoundingBoxAscent: px() * 0.7, actualBoundingBoxDescent: px() * 0.2 }),
    fillText: (s: string) => { drawn.push({ text: s, px: px() }); },
    strokeText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const ctx = new Proxy(target, {
    get: (t, k: string) => (k === 'font' ? font : k in t ? t[k] : () => {}),
    set: (t, k: string, v) => { if (k === 'font') font = v; else t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as Ctx, drawn };
}

function withWord(word: string, fontSize: number): Project {
  const p = createProject();
  return { ...p, captions: { ...p.captions, enabled: true, style: { ...p.captions.style, fontSize, maxWords: 1, uppercase: true }, segments: [{ id: 's', start: 0, end: 2, text: word, words: [{ id: 'w1', text: word, start: 0, end: 2 }] }] } };
}

describe('legenda com palavra longa cabe no quadro', () => {
  const W = 1080, H = 1920, maxW = W * 0.84;
  it.each([['www.receitasdavovo.com.br', 76], ['responsabilidade', 130]] as const)('"%s" (fonte %d)', (word, size) => {
    const { ctx, drawn } = fakeCtx();
    drawCaptions(ctx, withWord(word, size), 1, W, H);
    const d = drawn.find((x) => x.text.toLowerCase().includes(word.slice(0, 5)));
    expect(d).toBeTruthy();
    expect([...word].length * d!.px * 0.6).toBeLessThanOrEqual(maxW + 1);
  });
  it('palavra curta não muda de tamanho', () => {
    const { ctx, drawn } = fakeCtx();
    drawCaptions(ctx, withWord('bolo', 76), 1, W, H);
    expect(drawn.find((x) => /bolo/i.test(x.text))!.px).toBeCloseTo(76, 6);
  });
});
