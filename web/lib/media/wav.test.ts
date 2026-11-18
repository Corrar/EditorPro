import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('gera cabeçalho e amostras 16-bit', () => {
    const buf = encodeWav([new Float32Array([0, 1, -1])], 8000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 6);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });
  it('estéreo intercala canais', () => {
    const buf = encodeWav([new Float32Array([1]), new Float32Array([0])], 44100);
    expect(new DataView(buf).getUint16(22, true)).toBe(2);
    expect(buf.byteLength).toBe(48);
  });
});
