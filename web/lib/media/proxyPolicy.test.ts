import { describe, expect, it } from 'vitest';
import { needsProxy } from './proxyPolicy';

describe('needsProxy', () => {
  it('vídeos acima de 720p', () => {
    expect(needsProxy({ kind: 'video', width: 1080, height: 1920 })).toBe(true);
    expect(needsProxy({ kind: 'video', width: 720, height: 1280 })).toBe(false);
    expect(needsProxy({ kind: 'video', width: 3840, height: 2160 })).toBe(true);
  });
  it('HEVC mesmo em resolução baixa; imagem/áudio nunca', () => {
    expect(needsProxy({ kind: 'video', width: 640, height: 360, mime: 'video/mp4; codecs=hvc1' })).toBe(true);
    expect(needsProxy({ kind: 'video', width: 640, height: 360, name: 'clip.hevc' })).toBe(true);
    expect(needsProxy({ kind: 'image', width: 4000, height: 3000 })).toBe(false);
    expect(needsProxy({ kind: 'audio' })).toBe(false);
  });
});
