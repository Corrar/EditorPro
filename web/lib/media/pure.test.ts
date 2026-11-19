import { describe, expect, it } from 'vitest';
import { defaultRoleFor, mediaKindOf, peakCountFor, reducePeaks, thumbCountFor, thumbSize, thumbTimes } from './pure';

describe('mediaKindOf', () => {
  it('usa o mime', () => {
    expect(mediaKindOf('video/mp4')).toBe('video');
    expect(mediaKindOf('audio/mpeg')).toBe('audio');
    expect(mediaKindOf('image/png')).toBe('image');
  });
  it('cai para a extensão quando não há mime', () => {
    expect(mediaKindOf('', 'clip.MOV')).toBe('video');
    expect(mediaKindOf('', 'trilha.m4a')).toBe('audio');
    expect(mediaKindOf('application/octet-stream', 'foto.jpeg')).toBe('image');
  });
  it('rejeita o que não é mídia', () => {
    expect(mediaKindOf('application/pdf', 'doc.pdf')).toBeNull();
    expect(mediaKindOf('', 'semext')).toBeNull();
  });
});

describe('defaultRoleFor', () => {
  it('áudio vira música, resto material; respeita pedido', () => {
    expect(defaultRoleFor('audio')).toBe('music');
    expect(defaultRoleFor('video')).toBe('source');
    expect(defaultRoleFor('video', 'reference')).toBe('reference');
  });
});

describe('reducePeaks', () => {
  it('reduz para a contagem pedida e normaliza pelo maior pico', () => {
    const ch = new Float32Array([0, 0.5, -0.25, 0.1, 0, -1, 0.2, 0.2]);
    const out = reducePeaks([ch], 4);
    expect(out).toEqual([0.5, 0.25, 1, 0.2]);
  });
  it('combina canais pelo máximo', () => {
    const l = new Float32Array([0.1, 0.1]);
    const r = new Float32Array([0.4, 0.05]);
    expect(reducePeaks([l, r], 2)).toEqual([1, 0.25]);
  });
  it('silêncio e entrada vazia viram zeros', () => {
    expect(reducePeaks([new Float32Array(10)], 3)).toEqual([0, 0, 0]);
    expect(reducePeaks([], 2)).toEqual([0, 0]);
  });
  it('mais picos que amostras não quebra', () => {
    const out = reducePeaks([new Float32Array([1, 0.5])], 4);
    expect(out).toHaveLength(4);
    expect(Math.max(...out)).toBe(1);
  });
});

describe('contagens e tempos', () => {
  it('peakCountFor fica dentro dos limites', () => {
    expect(peakCountFor(0)).toBe(64);
    expect(peakCountFor(10)).toBe(500);
    expect(peakCountFor(10_000)).toBe(6000);
  });
  it('thumbTimes espaça uniformemente dentro da duração', () => {
    expect(thumbTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
    const t = thumbTimes(1, 20);
    expect(t).toHaveLength(20);
    expect(Math.max(...t)).toBeLessThan(1);
  });
  it('thumbCountFor entre 10 e 20', () => {
    expect(thumbCountFor(5)).toBe(10);
    expect(thumbCountFor(600)).toBe(20);
  });
  it('thumbSize mantém proporção', () => {
    expect(thumbSize(1080, 1920, 96)).toEqual({ width: 54, height: 96 });
    expect(thumbSize(1920, 1080, 90)).toEqual({ width: 160, height: 90 });
  });
});

describe('looksUndecodable', () => {
  it('sem dimensões ou sem quadros = não decodifica', async () => {
    const { looksUndecodable, UNDECODABLE_MSG } = await import('./pure');
    expect(looksUndecodable({ width: 0, height: 0, thumbCount: 0, duration: 5 })).toBe(true);
    expect(looksUndecodable({ width: 1080, height: 1920, thumbCount: 0, duration: 5 })).toBe(true);
    expect(looksUndecodable({ width: 1080, height: 1920, thumbCount: 6, duration: 5 })).toBe(false);
    expect(UNDECODABLE_MSG('a.mov')).toContain('Mais compatível');
  });
});

describe('decodeFits (B6: áudio longo não decodifica inteiro)', () => {
  it('podcast de 1 h fica fora; música de 4 min passa', async () => {
    const { decodeFits } = await import('./pure');
    expect(decodeFits(3600)).toBe(false);
    expect(decodeFits(240)).toBe(true);
    expect(decodeFits(0)).toBe(true);
  });
});
