import { describe, expect, it } from 'vitest';
import { detectBeats, estimateBpm, onsetEnvelope, toMono } from './beats';

/** cliques curtos a 120 BPM sobre ruído baixo */
function clicks(bpm: number, seconds: number, sr = 22050): Float32Array {
  const s = new Float32Array(Math.floor(seconds * sr));
  let seed = 1;
  for (let i = 0; i < s.length; i++) { seed = (seed * 16807) % 2147483647; s[i] = ((seed / 2147483647) - 0.5) * 0.01; }
  const step = 60 / bpm;
  for (let t = 0.5; t < seconds; t += step) {
    const a = Math.floor(t * sr);
    for (let i = 0; i < 600 && a + i < s.length; i++) s[a + i] += Math.sin(i * 0.3) * Math.exp(-i / 150);
  }
  return s;
}

describe('batidas', () => {
  it('acha batidas a 120 BPM perto dos cliques', () => {
    const sr = 22050;
    const beats = detectBeats(clicks(120, 8, sr), sr);
    expect(beats.length).toBeGreaterThanOrEqual(14);
    expect(beats.length).toBeLessThanOrEqual(16);
    for (const b of beats) {
      const nearest = Math.round((b - 0.5) / 0.5) * 0.5 + 0.5;
      expect(Math.abs(b - nearest)).toBeLessThan(0.06);
    }
    expect(estimateBpm(beats)).toBe(120);
  });
  it('silêncio não tem batidas', () => {
    expect(detectBeats(new Float32Array(44100), 22050)).toEqual([]);
    expect(estimateBpm([1, 2])).toBeNull();
  });
  it('toMono e envelope', () => {
    expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
    expect(onsetEnvelope(new Float32Array(10), 1024, 512)).toEqual([]);
  });
});
