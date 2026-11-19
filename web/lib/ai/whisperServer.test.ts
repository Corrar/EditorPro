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
