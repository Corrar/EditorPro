import { describe, it, expect } from 'vitest';
import { loopRange, wrapLoop, stepFrame, zoomScale, stripLooks, snapTo, snapTargets, rateLabel, SAFE_ZONES } from './viewing';
import { createProject } from '@/lib/defaults';
import type { Project, VideoClip } from '@/lib/types';

const vclip = (id: string, start: number, duration: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, type: 'video', assetId: 'a', start, duration, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra,
});
function proj(): Project {
  const p = createProject({ name: 't', aspect: '9:16' });
  p.tracks.find((t) => t.kind === 'video')!.clips = [vclip('a', 0, 4), vclip('b', 4, 6, { colorPreset: 'warm' as never, filters: [{ kind: 'saturation', value: 0.4 }] as never, effects: [{ kind: 'vhs', intensity: 0.5 }] as never })];
  return p;
}

describe('loop / velocidade / quadro a quadro', () => {
  it('loop no clipe selecionado ou no vídeo inteiro', () => {
    expect(loopRange(proj(), ['b'])).toMatchObject({ start: 4, end: 10, label: 'clipe selecionado' });
    expect(loopRange(proj(), [])).toMatchObject({ start: 0, end: 10 });
    expect(loopRange(proj(), ['a', 'b']).label).toBe('vídeo inteiro');
  });
  it('passou do fim do trecho → volta ao início', () => {
    expect(wrapLoop(10, { start: 4, end: 10 })).toEqual({ t: 4, wrapped: true });
    expect(wrapLoop(7, { start: 4, end: 10 })).toEqual({ t: 7, wrapped: false });
    expect(wrapLoop(1, { start: 4, end: 10 })).toEqual({ t: 4, wrapped: true });
  });
  it('quadro a quadro alinhado à grade e limitado', () => {
    expect(stepFrame(1, 30, 1, 10)).toBeCloseTo(31 / 30);
    expect(stepFrame(1.01, 30, -1, 10)).toBeCloseTo(29 / 30);
    expect(stepFrame(0, 30, -1, 10)).toBe(0);
    expect(stepFrame(10, 30, 1, 10)).toBeCloseTo(299 / 30);
  });
  it('rótulo da velocidade em PT-BR', () => {
    expect(rateLabel(0.5)).toBe('0,5×');
    expect(rateLabel(2)).toBe('2×');
  });
});

describe('zoom do quadro', () => {
  it('ajustar usa o encaixe; 100% = 1 px do projeto por px físico', () => {
    expect(zoomScale('fit', 0.3, 2)).toBe(0.3);
    expect(zoomScale(100, 0.3, 2)).toBe(0.5);
    expect(zoomScale(200, 0.3, 2)).toBe(1);
    expect(zoomScale(100, 0.3, 1)).toBe(1);
  });
});

describe('antes/depois', () => {
  it('tira looks/filtros/efeitos e esconde camadas de ajuste, mantendo cortes e posições', () => {
    const p = proj();
    p.tracks.push({ id: 'fx', kind: 'effect', name: 'Ajustes', clips: [] } as never);
    const s = stripLooks(p);
    const b = s.tracks.find((t) => t.kind === 'video')!.clips[1] as VideoClip;
    expect(b.filters).toEqual([]);
    expect(b.colorPreset).toBeUndefined();
    expect(b.effects).toBeUndefined();
    expect(b.start).toBe(4);
    expect(s.tracks.find((t) => t.kind === 'effect')!.hidden).toBe(true);
    // não muta o original
    expect((p.tracks.find((t) => t.kind === 'video')!.clips[1] as VideoClip).colorPreset).toBe('warm');
  });
});

describe('guias de encaixe', () => {
  it('encaixa no centro/terço mais próximo dentro do limite', () => {
    expect(snapTo(0.507, snapTargets('x'))).toEqual({ value: 0.5, guide: 0.5 });
    expect(snapTo(0.34, snapTargets('y'))).toMatchObject({ guide: 1 / 3 });
    expect(snapTo(0.42, snapTargets('x'))).toEqual({ value: 0.42, guide: null });
  });
  it('inclui as bordas da zona segura', () => {
    const t = snapTargets('y', SAFE_ZONES.tiktok);
    expect(snapTo(0.795, t).guide).toBeCloseTo(0.8);
  });
});
