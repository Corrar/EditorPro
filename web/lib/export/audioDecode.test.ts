import { describe, expect, it } from 'vitest';
import { audioSampleRange, joinPlanar } from './audioDecode';

// AAC 48 kHz: 1024 amostras = 21,33 ms por quadro
const q = 1024 / 48000;
const samples = Array.from({ length: 500 }, (_, i) => ({ cts: i * q, duration: q }));

describe('áudio do export só no trecho usado', () => {
  it('cobre [from, to] com 1 quadro extra antes (sobreposição do MDCT)', () => {
    const r = audioSampleRange(samples, 2, 4)!;
    expect(samples[r.first + 1].cts).toBeLessThanOrEqual(2);
    expect(samples[r.first + 1].cts + q).toBeGreaterThanOrEqual(2);
    expect(samples[r.last].cts).toBeLessThanOrEqual(4);
    expect(samples[r.last].cts + q).toBeGreaterThanOrEqual(4);
    expect(r.last - r.first).toBeLessThan(100); // ~94 quadros p/ 2 s, não o arquivo inteiro (500)
  });
  it('início do arquivo não passa de 0; trecho fora do arquivo = null', () => {
    expect(audioSampleRange(samples, 0, 0.1)!.first).toBe(0);
    expect(audioSampleRange(samples, 100, 101)).toBeNull();
  });
  it('junta blocos planares em ordem de tempo; mono vira estéreo repetindo o canal', () => {
    const j = joinPlanar([
      { ts: 0.5, planes: [new Float32Array([3, 4])] },
      { ts: 0.25, planes: [new Float32Array([1, 2]), new Float32Array([5, 6])] },
    ])!;
    expect(j.t0).toBe(0.25);
    expect([...j.channels[0]]).toEqual([1, 2, 3, 4]);
    expect([...j.channels[1]]).toEqual([5, 6, 3, 4]);
    expect(joinPlanar([])).toBeNull();
  });
});
