import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionWord, MediaAsset, Project, VideoClip } from '../types';
import { emphasisZoomOps, isFiller } from './features';
import { silenceOptsFromText } from './demo';
import { colorGradeOps, matchColorGrade } from './colormatch';
import { sanitizeColorGrade } from './sanitize';
import { sanitizeOps } from './validate';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const base = (): Project => applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' } }]).project;
const W = (text: string, start: number, end: number): CaptionWord => ({ text, start, end });

describe('vícios: então / sabe', () => {
  it('"então…" solto e "sabe?" de muleta são vícios; usos normais não', () => {
    const a = [W('Então…', 0, 0.5), W('vamos', 0.9, 1.2), W('lá', 1.2, 1.4)];
    expect(isFiller(a, 0)).toBe(true);
    const b = [W('e', 0, 0.1), W('então', 0.1, 0.3), W('ele', 0.32, 0.5), W('saiu', 0.5, 0.8)];
    expect(isFiller(b, 1)).toBe(false);
    const c = [W('é', 0, 0.1), W('bom,', 0.1, 0.4), W('sabe?', 0.4, 0.8), W('Daí', 1.3, 1.5)];
    expect(isFiller(c, 2)).toBe(true);
    const d = [W('você', 0, 0.2), W('sabe', 0.2, 0.5), W('como', 0.52, 0.7), W('faz', 0.7, 0.9)];
    expect(isFiller(d, 1)).toBe(false);
  });
});

describe('silêncio com limiar ajustável', () => {
  it('lê o limiar do pedido', () => {
    expect(silenceOptsFromText('corta as pausas maiores que 1 s')).toMatchObject({ minSilence: 1 });
    expect(silenceOptsFromText('tira silêncios acima de 0,8 segundo')).toMatchObject({ minSilence: 0.8 });
    expect(silenceOptsFromText('corta pausas maiores que 400 ms')).toMatchObject({ minSilence: 0.4 });
    expect(silenceOptsFromText('corte agressivo de silêncio, bem colado')).toMatchObject({ minSilence: 0.3, pad: 0.05 });
    expect(silenceOptsFromText('só as pausas longas')).toMatchObject({ minSilence: 1 });
    expect(silenceOptsFromText('corta os silêncios')).toBeUndefined();
  });
});

describe('zoom na ênfase', () => {
  it('punch-ins nas frases fortes, um update_clip com keyframes válidos', () => {
    let p = base();
    const segs = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, start: i * 2.4, end: i * 2.4 + 2, text: i === 3 ? 'Isso mudou TUDO!' : i === 5 ? 'Foram 300 clientes' : 'frase comum aqui' }));
    p = applyOps(p, [{ op: 'set_captions', segments: segs, language: 'pt-BR' } as EditOp]).project;
    const { ops, count } = emphasisZoomOps(p);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(ops).toHaveLength(1);
    const s = sanitizeOps(ops, p, { a1: src });
    const c = s.project.tracks[0].clips.find((x) => x.id === 'c1') as VideoClip;
    const kfs = c.keyframes ?? [];
    expect(kfs.some((k) => Math.abs((k.transform.scale ?? 1) - 1.18) < 1e-6 && Math.abs(k.t - (7.2 + 0.15)) < 0.01)).toBe(true);
    expect(kfs.every((k, i) => i === 0 || k.t > kfs[i - 1].t)).toBe(true);
  });
});

describe('combinar cor com o modelo (ColorGrade)', () => {
  const model = { r: 0.62, g: 0.48, b: 0.36, sat: 0.42, lum: 0.5, lumSd: 0.24 };
  const material = { r: 0.45, g: 0.47, b: 0.52, sat: 0.2, lum: 0.47, lumSd: 0.16 };
  it('material frio e lavado -> esquenta, satura e dá contraste', () => {
    const g = matchColorGrade(model, material);
    expect(g.offset!.r).toBeGreaterThan(0);
    expect(g.offset!.b).toBeLessThan(0);
    expect(g.saturation!).toBeGreaterThan(0);
    expect(g.contrast!).toBeGreaterThan(0);
    expect(matchColorGrade(model, model)).toEqual({});
  });
  it('vira update_clip {colorGrade} válido pelo validate; null remove', () => {
    const p = base();
    const ops = colorGradeOps(p, { a1: matchColorGrade(model, material) });
    const s = sanitizeOps(ops, p, { a1: src });
    expect(s.dropped).toEqual([]);
    const c = s.project.tracks[0].clips[0] as VideoClip;
    expect(c.colorGrade?.offset?.r).toBeGreaterThan(0);
    const s2 = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: null } }], s.project, { a1: src });
    expect((s2.project.tracks[0].clips[0] as VideoClip).colorGrade).toBeUndefined();
  });
  it('sanitizeColorGrade limita valores e ignora lixo', () => {
    expect(sanitizeColorGrade({ exposure: 9, lift: { r: 2, g: 0, b: 0, y: 0 }, foo: 1, lut: { id: '../x', intensity: 1 }, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 2 }] } }))
      .toEqual({ exposure: 1, lift: { r: 1, g: 0, b: 0, y: 0 }, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
  });
});

describe('catálogo derivado dos donos', () => {
  it('IA aceita transições em shader e efeitos do engine; prompt lista com rótulos', async () => {
    const { CATALOG, engineCatalogForAI } = await import('./catalogs');
    const { TRANSITION_LABELS } = await import('../engine/transitions');
    expect(CATALOG.transitions).toEqual(Object.keys(TRANSITION_LABELS));
    expect(CATALOG.transitions).toContain('whip-pan');
    const p = applyOps(createProject(), [
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 5 } },
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 5), id: 'c2', duration: 5, in: 5 } },
    ]).project;
    const r = sanitizeOps([{ op: 'update_clip', clipId: 'c2', patch: { transitionIn: { kind: 'swirl-vortex', duration: 0.5 } } }], p, { a1: src });
    expect(r.dropped).toEqual([]);
    expect(engineCatalogForAI()).toMatch(/swirl-vortex \(/);
    const { EditOpSchema } = await import('./schemas');
    const { z } = await import('zod');
    expect(JSON.stringify(z.toJSONSchema(EditOpSchema))).toContain('cinematic-zoom');
  });
});

describe('usabilidade: sugestões e "o que mudou?"', () => {
  it('sugestões mudam com o estado do projeto', async () => {
    const { suggestionsFor, isExplainRequest, isHelpRequest } = await import('./suggest');
    expect(suggestionsFor(createProject(), {})).toEqual(['Como funciona?']);
    const p = base();
    const s1 = suggestionsFor(p, { a1: src });
    expect(s1).toContain('Gerar legendas');
    expect(s1).not.toContain('Cortar vícios de linguagem');
    const withCaps = applyOps(p, [{ op: 'set_captions', segments: [{ id: 's1', start: 0, end: 2, text: 'oi' }], language: 'pt-BR' } as EditOp]).project;
    const s2 = suggestionsFor(withCaps, { a1: src });
    expect(s2).toContain('Cortar vícios de linguagem');
    expect(s2).not.toContain('Gerar legendas');
    expect(isExplainRequest('o que você mudou?')).toBe(true);
    expect(isExplainRequest('Explica o que mudou')).toBe(true);
    expect(isExplainRequest('muda a cor')).toBe(false);
    expect(isHelpRequest('Como funciona?')).toBe(true);
  });
  it('explainChanges descreve cortes, textos, cor e legenda', async () => {
    const { explainChanges } = await import('./suggest');
    const p = base();
    const r = sanitizeOps([
      { op: 'ripple_delete', start: 2, end: 4 },
      { op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'warm' } },
      { op: 'add_clip', clip: { type: 'text', text: 'Oferta!', start: 0, duration: 2 } },
      { op: 'set_caption_style', style: { fontSize: 99 } },
    ], p, { a1: src });
    const e = explainChanges(p, r.project);
    expect(e).toMatch(/Duração: 20,0 s → 18,0 s \(2,0 s a menos\)/);
    expect(e).toMatch(/\+1 texto: “Oferta!”/);
    expect(e).toMatch(/Cor ajustada em/);
    expect(e).toMatch(/Estilo da legenda/);
    expect(explainChanges(p, p)).toBe('Nada mudou no projeto nessa edição.');
  });
});
