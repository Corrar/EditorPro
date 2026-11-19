import { describe, expect, it } from 'vitest';
import { wsola, zeroCrossHz } from './timeStretch';

const sr = 16000;
const sine = (hz: number, secs: number) => Float32Array.from({ length: Math.round(secs * sr) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));

describe('time-stretch WSOLA (velocidade sem mudar o tom)', () => {
  it('2x: metade da duração, mesmo tom (440 Hz, não 880)', () => {
    const [y] = wsola([sine(440, 2)], sr, sr, (t) => t * 2);
    expect(y.length).toBe(sr);
    expect(Math.abs(zeroCrossHz(y, sr, 800, sr - 800) - 440)).toBeLessThan(6);
  });
  it('0,5x: dobro da duração, mesmo tom', () => {
    const [y] = wsola([sine(300, 1)], sr, 2 * sr, (t) => t * 0.5);
    expect(Math.abs(zeroCrossHz(y, sr, 800, 2 * sr - 800) - 300)).toBeLessThan(6);
  });
  it('4x (fora do limite ±12 semitons do pitch shifter) também mantém o tom', () => {
    const [y] = wsola([sine(500, 4)], sr, sr, (t) => t * 4);
    expect(Math.abs(zeroCrossHz(y, sr, 800, sr - 800) - 500)).toBeLessThan(8);
  });
  it('segue o mapeamento de origem (curva): nível não cai nem estoura', () => {
    // rampa 1x → 3x: srcAt = t + t² (derivada 1 + 2t)
    const [y] = wsola([sine(440, 4)], sr, sr, (t) => t + t * t);
    const rms = Math.sqrt(y.slice(800, sr - 800).reduce((s, v) => s + v * v, 0) / (sr - 1600));
    expect(rms).toBeGreaterThan(0.6);
    expect(rms).toBeLessThan(0.8);
    expect(Math.abs(zeroCrossHz(y, sr, 800, sr - 800) - 440)).toBeLessThan(10);
  });
  it('estéreo: canais preservados e alinhados', () => {
    const a = sine(440, 1), b = a.map((v) => -v);
    const [l, r] = wsola([a, b], sr, sr / 2, (t) => t * 2);
    let maxSum = 0;
    for (let i = 0; i < l.length; i++) maxSum = Math.max(maxSum, Math.abs(l[i] + r[i]));
    expect(maxSum).toBeLessThan(1e-5);
  });
});
