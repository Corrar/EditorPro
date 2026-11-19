import { describe, it, expect } from 'vitest';
import { nativePlan, clipNeedsCanvas, nativeGeometry, geometryTransform, geometryClip, isCssTransition, layerFilter } from './hybrid';
import { createProject } from '@/lib/defaults';
import type { Project, VideoClip, Track } from '@/lib/types';

const vclip = (id: string, start: number, duration: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, type: 'video', assetId: 'a1', start, duration, in: start * 1.3, speed: 1, volume: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], ...extra,
});

function proj(clips: VideoClip[]): Project {
  const p = createProject({ name: 't', aspect: '9:16' });
  p.tracks.find((t) => t.kind === 'video')!.clips = clips;
  return p;
}
const mode = (p: Project, t: number) => { const r = nativePlan(p, t); return r.native ? 'nativo' : r.reason; };

describe('política de modo: nativo (<video> visível) × canvas', () => {
  it('clipe simples com keyframes de zoom, fade e legenda → nativo', () => {
    const p = proj([vclip('a', 0, 5, { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 5, transform: { scale: 1.2 } }], fadeIn: 0.5 })]);
    p.captions = { ...p.captions, enabled: true };
    const r = nativePlan(p, 0.25);
    expect(r.native).toBe(true);
    if (r.native) expect(r.layers[0].opacity).toBeCloseTo(0.5);
  });
  it('cortes do MESMO asset sem transição → nativo (troca de elemento no corte)', () => {
    const p = proj([vclip('a', 0, 5), vclip('b', 5, 5), vclip('c', 10, 5)]);
    expect([4.9, 5, 9.99, 10.01].map((t) => mode(p, t))).toEqual(['nativo', 'nativo', 'nativo', 'nativo']);
  });
  it('transição simples (fade/slide/zoom) → nativo com 2 camadas; o que entra fica por cima', () => {
    for (const kind of ['fade', 'slide-left', 'zoom-in'] as const) {
      const p = proj([vclip('a', 0, 5), vclip('b', 5, 5, { transitionIn: { kind, duration: 0.6 } })]);
      const r = nativePlan(p, 5.2);
      expect(r.native).toBe(true);
      if (r.native) {
        expect(r.layers.map((l) => l.clip.id).sort()).toEqual(['a', 'b']);
        expect(r.layers.find((l) => l.clip.id === 'b')!.z).toBeGreaterThan(r.layers.find((l) => l.clip.id === 'a')!.z);
      }
    }
  });
  it('transição com flash/glitch/shader → canvas só durante a transição', () => {
    for (const kind of ['flash', 'glitch', 'whip-pan'] as const) {
      const p = proj([vclip('a', 0, 5), vclip('b', 5, 5, { transitionIn: { kind, duration: 0.5 } })]);
      expect(mode(p, 5.2)).toBe('transição');
      expect(mode(p, 6)).toBe('nativo');
    }
    expect(isCssTransition('fade')).toBe(true);
    expect(isCssTransition('flash')).toBe(false);
  });
  it('recursos que exigem composição por pixel → canvas', () => {
    const cases: [Partial<VideoClip>, string][] = [
      [{ effects: [{ kind: 'vhs', intensity: 0.5 } as never] }, 'efeito'],
      [{ mask: { kind: 'circle' } as never }, 'máscara'],
      [{ chromaKey: { color: '#00ff00', similarity: 0.4 } as never }, 'chroma'],
      [{ removeBackground: true }, 'remover fundo'],
      [{ blendMode: 'screen' }, 'mesclagem'],
      [{ crop: { x: 0.1, y: 0, w: 0.8, h: 1 } }, 'recorte'],
      [{ reverse: true }, 'reverso'],
      [{ filters: [{ kind: 'vignette', value: 0.5 }] as never }, 'look'],
    ];
    for (const [extra, why] of cases) expect(clipNeedsCanvas(vclip('a', 0, 5, extra), 1)).toBe(why);
  });
  it('filtros simples (brilho/contraste/saturação) viram CSS no <video>', () => {
    const p = proj([vclip('a', 0, 5, { filters: [{ kind: 'saturation', value: 0.3 }, { kind: 'brightness', value: 0.1 }] as never })]);
    const r = nativePlan(p, 1);
    expect(r.native).toBe(true);
    if (r.native) expect(r.layers[0].filter).toMatch(/saturate|brightness/);
  });
  it('animação de entrada → canvas só na janela da animação', () => {
    const c = vclip('a', 0, 5, { animationIn: { kind: 'zoom-in', duration: 0.5 } as never });
    expect(clipNeedsCanvas(c, 0.2)).toBe('animação');
    expect(clipNeedsCanvas(c, 2)).toBeNull();
  });
  it('fundo desfocado, PiP, 2ª trilha de vídeo e camada de ajuste → canvas', () => {
    const p = proj([vclip('a', 0, 5)]);
    expect(mode({ ...p, canvas: { type: 'blur', blur: 0.6 } }, 1)).toBe('fundo desfocado');
    const extra = (kind: Track['kind'], clip: unknown): Project => ({ ...p, tracks: [...p.tracks, { id: 'x', kind, name: 'x', clips: [clip as VideoClip] } as Track] });
    expect(mode(extra('overlay', vclip('pip', 0, 5)), 1)).toBe('PiP');
    expect(mode(extra('video', vclip('v2', 0, 5)), 1)).toBe('2ª trilha de vídeo');
    expect(mode(extra('effect', { id: 'adj', type: 'adjustment', start: 0, duration: 5 }), 1)).toBe('camada de ajuste');
  });
  it('imagem na trilha principal → canvas', () => {
    const p = proj([]);
    p.tracks.find((t) => t.kind === 'video')!.clips = [{ id: 'i', type: 'image', assetId: 'x', start: 0, duration: 3, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [] } as never];
    expect(mode(p, 1)).toBe('imagem');
  });
});

describe('geometria nativa = mesma conta do drawLayer', () => {
  it('cover num quadro do mesmo aspecto ocupa o quadro', () => {
    const g = nativeGeometry(vclip('a', 0, 5), 1, 360, 640, 1080, 1920);
    expect(g).toMatchObject({ x: 0, y: 0, w: 360, h: 640 });
  });
  it('contain de vídeo deitado num quadro em pé centraliza com faixas', () => {
    const g = nativeGeometry(vclip('a', 0, 5, { fit: 'contain' }), 1, 360, 640, 1920, 1080);
    expect(g.w).toBeCloseTo(360);
    expect(g.h).toBeCloseTo(202.5);
    expect(g.y).toBeCloseTo((640 - 202.5) / 2);
  });
  it('keyframe de escala/posição e espelho', () => {
    const c = vclip('a', 0, 2, { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 2, x: 0.1 } }], flipH: true });
    const g = nativeGeometry(c, 2, 100, 200, 100, 200);
    expect(g.w).toBeCloseTo(200);
    expect(g.x).toBeCloseTo(50 + 10 - 100);
    expect(geometryTransform(g)).toContain('scale(-1,1)');
  });
  it('slide recorta a camada no quadro deslocado (clip-path)', () => {
    const c = vclip('a', 0, 5, { keyframes: [{ t: 0, transform: { scale: 1.2 } }] });
    const g = nativeGeometry(c, 1, 100, 200, 100, 200, { opacity: 1, dx: 0.5, dy: 0, scale: 1, rotation: 0, motionBlur: 0, blur: 0, flash: 0, glitch: 0, pixelate: 0, shake: 0, rgbSplit: 0, burn: 0 });
    expect(geometryClip(g)).toMatch(/^inset\(/);
    expect(g.clip!.left).toBeCloseTo(10); // a sobra do zoom à esquerda do quadro deslocado some
  });
  it('desfoque da transição vira blur() em px do quadro', () => {
    expect(layerFilter({ clip: vclip('a', 0, 5), opacity: 1, filter: 'none', z: 1, tv: { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, motionBlur: 0, blur: 0.5, flash: 0, glitch: 0, pixelate: 0, shake: 0, rgbSplit: 0, burn: 0 } }, 360, 640)).toBe('blur(5.4px)');
    expect(layerFilter({ clip: vclip('a', 0, 5), opacity: 1, filter: 'none', z: 1 }, 360, 640)).toBe('');
  });
});
