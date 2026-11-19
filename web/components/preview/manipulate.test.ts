import { describe, it, expect } from 'vitest';
import { textBox, visualBox, hitTest, dragPatch } from './manipulate';
import { createProject } from '@/lib/defaults';
import type { Project, TextClip, Clip } from '@/lib/types';

const measure = (s: string, px: number) => s.length * px * 0.5;
const text = (id: string, x: number, y: number, extra: Partial<TextClip> = {}): TextClip => ({
  id, type: 'text', text: 'OLÁ MUNDO', start: 0, duration: 5, position: { x, y },
  style: { fontFamily: 'Anton', fontSize: 100, fontWeight: 700, color: '#fff', strokeColor: '#000', strokeWidth: 0, background: '', shadow: false, uppercase: false, align: 'center' },
  ...extra,
} as TextClip);
const sticker = (id: string, x: number, y: number, scale = 0.3): Clip => ({ id, type: 'sticker', emoji: '🔥', start: 0, duration: 5, transform: { x, y, scale, rotation: 0, opacity: 1 } } as Clip);

function proj(): Project {
  const p = createProject({ name: 't', aspect: '9:16' });
  p.tracks.find((t) => t.kind === 'text')!.clips = [text('t1', 0.5, 0.2)];
  const ov = p.tracks.find((t) => t.kind === 'overlay');
  if (ov) ov.clips = [sticker('s1', 0.2, 0.2)];
  else p.tracks.push({ id: 'ov', kind: 'overlay', name: 'Sobreposição', clips: [sticker('s1', 0.2, 0.2)] } as never);
  p.tracks.find((t) => t.kind === 'video')!.clips = [{ id: 'v', type: 'video', assetId: 'a', start: 0, duration: 5, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [] } as Clip];
  return p;
}

describe('caixas das camadas', () => {
  it('texto: centro na posição, largura medida, quebra em 86%', () => {
    const b = textBox(text('t', 0.5, 0.3), 1, 1080, 1920, measure);
    expect(b.cx).toBe(0.5);
    expect(b.cy).toBe(0.3);
    expect(b.w).toBeGreaterThan(0.3);
    const long = textBox(text('t', 0.5, 0.3, { text: 'uma frase bem comprida que precisa quebrar em várias linhas no quadro' }), 1, 1080, 1920, measure);
    expect(long.w).toBeLessThanOrEqual(1);
    expect(long.h).toBeGreaterThan(b.h);
  });
  it('sticker: centro = 0,5 + deslocamento; tamanho pela escala', () => {
    const b = visualBox(sticker('s', 0.2, -0.1, 0.3), 1, 1080, 1920)!;
    expect(b.cx).toBeCloseTo(0.7);
    expect(b.cy).toBeCloseTo(0.4);
    expect(b.w).toBeCloseTo((1080 * 0.95 * 0.3) / 1080);
  });
});

describe('quem está sob o dedo', () => {
  it('acha texto e sticker; o vídeo principal não é arrastável', () => {
    const p = proj();
    expect(hitTest(p, 1, 0.5, 0.2, 1080, 1920, measure)?.clip.id).toBe('t1');
    expect(hitTest(p, 1, 0.7, 0.7, 1080, 1920, measure)?.clip.id).toBe('s1');
    expect(hitTest(p, 1, 0.1, 0.95, 1080, 1920, measure)).toBeNull();
  });
  it('fora do tempo do clipe não acha', () => {
    expect(hitTest(proj(), 9, 0.5, 0.2, 1080, 1920, measure)).toBeNull();
  });
  it('folga de dedo em camada pequena', () => {
    const p = proj();
    (p.tracks.find((t) => t.kind === 'overlay')!.clips[0] as Clip & { transform: { scale: number } }).transform.scale = 0.01;
    expect(hitTest(p, 1, 0.7 + 15 / 1080, 0.7, 1080, 1920, measure)?.clip.id).toBe('s1');
  });
});

describe('arrastar', () => {
  it('texto mexe em position; encaixa no centro com guia', () => {
    const r = dragPatch(text('t', 0.45, 0.2), { x: 0.45, y: 0.2 }, 0.046, 0.1);
    expect(r.guideX).toBe(0.5);
    expect((r.patch.position as { x: number }).x).toBeCloseTo(0.5);
    expect((r.patch.position as { y: number }).y).toBeCloseTo(0.3);
  });
  it('sticker mexe em transform.x/y preservando escala', () => {
    const r = dragPatch(sticker('s', 0, 0, 0.4), { x: 0.5, y: 0.5 }, 0.1, 0.123, undefined, false);
    const tf = r.patch.transform as { x: number; y: number; scale: number };
    expect(tf.x).toBeCloseTo(0.1);
    expect(tf.y).toBeCloseTo(0.123);
    expect(tf.scale).toBe(0.4);
    expect(r.guideX).toBeNull();
  });
  it('encaixa na borda da zona segura', () => {
    const r = dragPatch(text('t', 0.5, 0.75), { x: 0.5, y: 0.75 }, 0, 0.046, { top: 0.07, bottom: 0.2, left: 0.05, right: 0.13 });
    expect(r.guideY).toBeCloseTo(0.8);
  });
});
