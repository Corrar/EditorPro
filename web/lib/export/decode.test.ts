import { describe, it, expect } from 'vitest';
import { keyIndexFor, frameIndexAt, editListShift } from './demux';
import { decodeFallbackReason } from './decodePool';
import { videoBitrate, estimateExportSeconds, SPEED_PROFILE } from './options';
import type { MediaAsset, VideoClip } from '../types';

// GOP de 1 s a 30 fps, com B-frames (ordem de decodificação ≠ apresentação)
const samples = Array.from({ length: 90 }, (_, i) => ({ cts: i / 30, sync: i % 30 === 0 }));

describe('decodificação sequencial: busca', () => {
  it('chave anterior ao ponto de entrada', () => {
    expect(keyIndexFor(samples, 0)).toBe(0);
    expect(keyIndexFor(samples, 0.99)).toBe(0);
    expect(keyIndexFor(samples, 1)).toBe(30);
    expect(keyIndexFor(samples, 2.5)).toBe(60);
    expect(keyIndexFor(samples, 99)).toBe(60);
  });
  it('quadro exibido em t = maior timestamp ≤ t (regra do seek do <video>)', () => {
    const ts = samples.map((s) => s.cts);
    expect(frameIndexAt(ts, 0)).toBe(0);
    expect(frameIndexAt(ts, 2)).toBe(60); // 60/30 exato (sem erro de ponto flutuante)
    expect(frameIndexAt(ts, 2.0166)).toBe(60);
    expect(frameIndexAt(ts, 2.034)).toBe(61);
    expect(frameIndexAt(ts, -1)).toBe(0); // antes do 1º quadro: mostra o 1º
    expect(frameIndexAt([], 1)).toBe(-1);
  });
  it('edit list: B-frames (media_time de 2 quadros) adiantam a trilha; edição vazia atrasa', () => {
    expect(editListShift([{ segment_duration: 30000, media_time: 1024 }], 15360, 1000)).toBeCloseTo(-1024 / 15360);
    expect(editListShift([{ segment_duration: 500, media_time: -1 }, { segment_duration: 30000, media_time: 0 }], 15360, 1000)).toBeCloseTo(0.5);
    expect(editListShift(undefined, 15360, 1000)).toBe(0);
  });
});

describe('decodificação sequencial: quando cair no pool de <video>', () => {
  const asset = (mime: string) => ({ id: 'a', kind: 'video', url: 'blob:x', mime }) as MediaAsset;
  const clip = (extra: Partial<VideoClip> = {}) => ({ id: 'c', type: 'video', assetId: 'a', start: 0, duration: 2, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra }) as VideoClip;
  it('MP4/MOV normal vai pelo decodificador (inclusive com curva de velocidade)', () => {
    expect(decodeFallbackReason(clip(), asset('video/mp4'))).toBeNull();
    expect(decodeFallbackReason(clip({ speedPreset: 'montage' }), asset('video/quicktime'))).toBeNull();
    expect(decodeFallbackReason(clip(), asset(''))).toBeNull(); // sem mime: tenta o demux
  });
  it('reverso, remover fundo, WebM e sem mídia → pool de <video>', () => {
    expect(decodeFallbackReason(clip({ reverse: true }), asset('video/mp4'))).toBe('reverso');
    expect(decodeFallbackReason(clip({ removeBackground: true }), asset('video/mp4'))).toBe('remover fundo');
    expect(decodeFallbackReason(clip(), asset('video/webm'))).toBe('contêiner não-MP4');
    expect(decodeFallbackReason(clip(), undefined)).toBe('sem mídia');
  });
});

describe('velocidade do export', () => {
  it('bitrate por modo (rápido < equilibrado < qualidade)', () => {
    const r = videoBitrate(1080, 1920, 30, 'rapido'), e = videoBitrate(1080, 1920, 30), q = videoBitrate(1080, 1920, 30, 'qualidade');
    expect(r).toBeLessThan(e);
    expect(e).toBeLessThan(q);
    expect(r).toBeCloseTo(1080 * 1920 * 30 * 0.08, -3);
    expect(SPEED_PROFILE.rapido.keyEvery).toBe(3);
  });
  it('estimativa cresce com resolução/duração e é maior no celular', () => {
    const a = estimateExportSeconds(30, 30, 1080, 1920);
    expect(estimateExportSeconds(30, 30, 720, 1280)).toBeLessThan(a);
    expect(estimateExportSeconds(60, 30, 1080, 1920)).toBeGreaterThan(a);
    expect(estimateExportSeconds(30, 30, 1080, 1920, { mobile: true })).toBeGreaterThan(a);
  });
});
