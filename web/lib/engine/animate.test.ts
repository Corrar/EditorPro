import { describe, it, expect } from 'vitest';
import { animateClip, parseColor, lerpColor, hasVolumeKeyframes } from './animate';
import type { Clip, TextClip, VideoClip, AudioClip } from '../types';

const text = (keyframes: TextClip['keyframes']): TextClip => ({
  id: 't', type: 'text', text: 'Oi', start: 2, duration: 4, position: { x: 0.5, y: 0.5 },
  style: { fontFamily: 'Anton', fontSize: 80, fontWeight: 700, color: '#ffffff', strokeColor: '#000', strokeWidth: 4, background: '', shadow: false, uppercase: false, align: 'center' },
  keyframes,
} as TextClip);
const video = (extra: Partial<VideoClip> = {}): VideoClip => ({
  id: 'v', type: 'video', assetId: 'a', start: 0, duration: 5, in: 0, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra,
});

describe('animateClip: números, easing e retenção', () => {
  const c = text([{ t: 0, transform: {}, props: { 'style.fontSize': 80 } }, { t: 2, transform: {}, props: { 'style.fontSize': 160 } }]);
  it('interpola linear entre keyframes', () => {
    expect(animateClip(c, 1).style.fontSize).toBe(120);
  });
  it('segura antes do 1º e depois do último', () => {
    expect(animateClip(c, -1).style.fontSize).toBe(80);
    expect(animateClip(c, 9).style.fontSize).toBe(160);
  });
  it('easing do keyframe vale p/ o trecho que termina nele', () => {
    const e = text([{ t: 0, transform: {}, props: { scale: 1 } }, { t: 1, transform: {}, easing: 'easeIn', props: { scale: 2 } }]);
    expect(animateClip(e, 0.5).scale).toBeCloseTo(1 + 0.125);
  });
  it('não muta o original', () => {
    animateClip(c, 1);
    expect(c.style.fontSize).toBe(80);
  });
});

describe('animateClip: cores e strings', () => {
  it('cores #RRGGBB interpolam em RGB', () => {
    const c = text([{ t: 0, transform: {}, props: { 'style.color': '#000000' } }, { t: 2, transform: {}, props: { 'style.color': '#ff0000' } }]);
    expect(animateClip(c, 1).style.color).toBe('#800000');
  });
  it('#RGB e rgba() também; transparência sai em rgba()', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(lerpColor('rgba(0,0,0,0)', '#ffffff', 0.5)).toBe('rgba(128,128,128,0.5)');
    expect(parseColor('azul')).toBeNull();
  });
  it('string que não é cor troca quando o keyframe é atingido', () => {
    const c = text([{ t: 0, transform: {}, props: { 'style.fontFamily': 'Anton' } }, { t: 2, transform: {}, props: { 'style.fontFamily': 'Poppins' } }]);
    expect(animateClip(c, 1.9).style.fontFamily).toBe('Anton');
    expect(animateClip(c, 2).style.fontFamily).toBe('Poppins');
  });
});

describe('animateClip: caminhos', () => {
  it('effects.N.intensity/params e filters.<kind> (cria o filtro se faltar)', () => {
    const v = video({
      effects: [{ kind: 'vhs', intensity: 0.2 } as never],
      keyframes: [{ t: 0, transform: {}, props: { 'effects.0.intensity': 0, 'filters.brightness': 0, 'effects.0.params.amt': 0 } },
        { t: 2, transform: {}, props: { 'effects.0.intensity': 1, 'filters.brightness': 0.4, 'effects.0.params.amt': 1 } }],
    });
    const a = animateClip(v, 1);
    expect(a.effects![0].intensity).toBeCloseTo(0.5);
    expect(a.filters.find((f) => f.kind === 'brightness')!.value).toBeCloseTo(0.2);
  });
  it('colorGrade aninhado (cria colorGrade e a roda se faltarem)', () => {
    const v = video({ keyframes: [{ t: 0, transform: {}, props: { 'colorGrade.saturation': 0, 'colorGrade.lift.r': 0 } }, { t: 1, transform: {}, props: { 'colorGrade.saturation': 0.6, 'colorGrade.lift.r': -0.2 } }] });
    const a = animateClip(v, 0.5) as VideoClip & { colorGrade: { saturation: number; lift: { r: number } } };
    expect(a.colorGrade.saturation).toBeCloseTo(0.3);
    expect(a.colorGrade.lift.r).toBeCloseTo(-0.1);
  });
  it('mask.* e chromaKey.* só quando existem', () => {
    const v = video({ mask: { kind: 'circle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0 } as never, keyframes: [{ t: 0, transform: {}, props: { 'mask.feather': 0, 'chromaKey.similarity': 0.1 } }, { t: 2, transform: {}, props: { 'mask.feather': 1, 'chromaKey.similarity': 0.5 } }] });
    const a = animateClip(v, 1) as VideoClip & { mask: { feather: number } };
    expect(a.mask.feather).toBeCloseTo(0.5);
    expect(a.chromaKey).toBeUndefined(); // sem chroma no clipe: ignorado
  });
  it('caminho inválido, tipo errado, __proto__ e speed são ignorados (sem exceção)', () => {
    const v = video({ keyframes: [{ t: 0, transform: {}, props: { 'nada.aqui': 1, volume: 'alto', '__proto__.x': 1, speed: 2, 'effects.9.intensity': 1, 'filters.brightness': 'x' } as never }] });
    expect(() => animateClip(v, 0)).not.toThrow();
    const a = animateClip(v, 0);
    expect(a.volume).toBe(1);
    expect(a.speed).toBe(1);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('animateClip: custo', () => {
  it('sem props devolve o MESMO objeto', () => {
    const v = video({ keyframes: [{ t: 0, transform: { scale: 1 } }] });
    expect(animateClip(v, 1)).toBe(v);
    const plain = video();
    expect(animateClip(plain, 1)).toBe(plain);
  });
  it('mesmo tempo → mesmo resultado (cache, sem alocar de novo)', () => {
    const v = video({ keyframes: [{ t: 0, transform: {}, props: { volume: 0 } }, { t: 1, transform: {}, props: { volume: 1 } }] });
    expect(animateClip(v, 0.5)).toBe(animateClip(v, 0.5));
  });
  it('áudio: automação de volume detectada', () => {
    const a = { id: 'm', type: 'audio', assetId: 'x', start: 0, duration: 3, in: 0, speed: 1, volume: 1, keyframes: [{ t: 0, transform: {}, props: { volume: 0 } }] } as AudioClip;
    expect(hasVolumeKeyframes(a)).toBe(true);
    expect(hasVolumeKeyframes(video() as Clip)).toBe(false);
  });
});

import { scratchOwner, scratchOwnerCount } from './draw';
describe('donos de scratch por clip.id (r2 #6: histórico não prende canvases)', () => {
  it('mesmo id → mesmo dono (versões do clipe no desfazer reaproveitam)', () => {
    expect(scratchOwner('clipX')).toBe(scratchOwner('clipX'));
  });
  it('LRU limitado', () => {
    for (let i = 0; i < 100; i++) scratchOwner('c' + i);
    expect(scratchOwnerCount()).toBeLessThanOrEqual(24);
  });
});
