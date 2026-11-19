import { describe, it, expect } from 'vitest';
import { proxySize, matrixRotation, avcCodecFor, canMakeProxy, makePreviewProxy } from './proxy';
import { mediaUrl } from '@/components/preview/livePool';
import type { MediaAsset } from '@/lib/types';

describe('proxy de preview', () => {
  it('lado menor vira 540/720, mantém o aspecto, dimensões pares e nunca amplia', () => {
    expect(proxySize(1080, 1920, 540)).toEqual({ w: 540, h: 960 });
    expect(proxySize(3840, 2160, 720)).toEqual({ w: 1280, h: 720 });
    expect(proxySize(1080, 1920, 720)).toEqual({ w: 720, h: 1280 });
    expect(proxySize(480, 854, 540)).toEqual({ w: 480, h: 854 });
    expect(proxySize(1081, 1921, 540).w % 2).toBe(0);
  });
  it('rotação do celular a partir da matriz 16.16 do tkhd', () => {
    expect(matrixRotation([65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824])).toBe(0);
    expect(matrixRotation([0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824])).toBe(90);
    expect(matrixRotation([-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824])).toBe(180);
    expect(matrixRotation([0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824])).toBe(270);
    expect(matrixRotation(undefined)).toBe(0);
  });
  it('nível H.264 conforme o tamanho', () => {
    expect(avcCodecFor(540, 960)).toBe('avc1.42001f');
    expect(avcCodecFor(720, 1280)).toBe('avc1.42001f');
    expect(avcCodecFor(1080, 1920)).toBe('avc1.420028');
  });
  it('sem WebCodecs devolve null (preview usa a original)', async () => {
    expect(canMakeProxy()).toBe(false);
    expect(await makePreviewProxy(new Blob([new Uint8Array(10)]))).toBeNull();
  });
  it('preview usa proxyUrl quando existe; senão a original', () => {
    const a = { id: 'a', kind: 'video', url: 'blob:orig' } as MediaAsset;
    expect(mediaUrl(a)).toBe('blob:orig');
    expect(mediaUrl({ ...a, proxyUrl: 'blob:proxy' } as MediaAsset)).toBe('blob:proxy');
  });
});
