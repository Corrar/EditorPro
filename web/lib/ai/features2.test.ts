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
  it('sem o motor de cor: filtros equivalentes, sem zerar o colorPreset', () => {
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'warm', filters: [{ kind: 'vignette', value: 0.3 }] } }]).project;
    const ops = colorGradeOps(p, { a1: matchColorGrade(model, material) }, 'x', false);
    const s = sanitizeOps(ops, p, { a1: src });
    const c = s.project.tracks[0].clips[0] as VideoClip;
    expect(c.colorPreset).toBe('warm');
    expect(c.colorGrade).toBeUndefined();
    expect(c.filters.find((f) => f.kind === 'vignette')).toBeTruthy();
    expect(c.filters.find((f) => f.kind === 'temperature')!.value).toBeGreaterThan(0);
    expect(c.filters.find((f) => f.kind === 'saturation')!.value).toBeGreaterThan(0);
    expect(JSON.stringify(ops)).not.toContain('colorPreset');
  });
  it('motor ligado: match vira colorGrade direto (sem filtros, sem zerar preset); null remove; looks no catálogo', async () => {
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'warm' } }]).project;
    const ops = colorGradeOps(p, { a1: matchColorGrade(model, material) });
    const s = sanitizeOps(ops, p, { a1: src });
    expect(s.dropped).toEqual([]);
    const c = s.project.tracks[0].clips[0] as VideoClip;
    expect(c.colorGrade?.offset?.r).toBeGreaterThan(0);
    expect(c.colorPreset).toBe('warm');
    expect(c.filters.some((f) => f.kind === 'temperature')).toBe(false);
    const s1 = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: { lut: { id: 'look:teal-orange', intensity: 0.8 }, contrast: 0.1 } } }], s.project, { a1: src });
    expect((s1.project.tracks[0].clips[0] as VideoClip).colorGrade).toEqual({ lut: { id: 'look:teal-orange', intensity: 0.8 }, contrast: 0.1 });
    const s2 = sanitizeOps([{ op: 'update_clip', clipId: 'c1', patch: { colorGrade: null } }], s.project, { a1: src });
    expect((s2.project.tracks[0].clips[0] as VideoClip).colorGrade).toBeUndefined();
    const { engineCatalogForAI } = await import('./catalogs');
    expect(engineCatalogForAI()).toMatch(/look:teal-orange \(Teal & Laranja\)/);
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

describe('catálogo da FX', () => {
  it('IA conhece os efeitos/transições/blend/máscaras/animações da FX e os campos novos', async () => {
    const { CATALOG, engineCatalogForAI } = await import('./catalogs');
    const fx = await import('../fx/catalog');
    expect(CATALOG.effects).toEqual([...new Set(fx.ALL_EFFECT_KINDS)]);
    expect(CATALOG.transitions).toEqual([...new Set(fx.ALL_TRANSITION_KINDS)]);
    expect(CATALOG.effects.length).toBeGreaterThanOrEqual(91);
    expect(CATALOG.transitions.length).toBeGreaterThanOrEqual(97);
    expect(CATALOG.blendModes).toContain('soft-light');
    expect(CATALOG.clipAnimations).toContain('jelly');
    expect(engineCatalogForAI()).toMatch(/Modos de mesclagem/);
    const p = applyOps(createProject(), [
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1', duration: 5 } },
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 5), id: 'c2', duration: 5, in: 5 } },
    ]).project;
    const r = sanitizeOps([
      { op: 'update_clip', clipId: 'c2', patch: { transitionIn: { kind: 'page-curl', duration: 0.6, easing: 'easeInOut' }, blendMode: 'soft-light', effects: [{ kind: 'neon-glow', intensity: 0.7, color: '#FF00AA', angle: 45 }, { kind: 'rain', intensity: 2, angle: 999 }], mask: { shape: 'text', x: 0.5, y: 0.5, w: 0.8, h: 0.3, rotation: 0, feather: 0.1, text: 'OFERTA', radius: 3, keyframes: [{ t: 1, w: 1.2 }, { t: 0, w: 0.4 }, { t: 0, w: 9 }] }, animationIn: { kind: 'jelly', duration: 0.5 } } },
    ], p, { a1: src });
    expect(r.dropped).toEqual([]);
    const c = r.project.tracks[0].clips.find((x) => x.id === 'c2') as VideoClip & Record<string, unknown>;
    expect(c.transitionIn).toEqual({ kind: 'page-curl', duration: 0.6, easing: 'easeInOut' });
    expect(c.blendMode).toBe('soft-light');
    expect(c.effects).toEqual([{ kind: 'neon-glow', intensity: 0.7, color: '#FF00AA', angle: 45 }, { kind: 'rain', intensity: 1, angle: 360 }]);
    expect(c.mask).toMatchObject({ shape: 'text', text: 'OFERTA', radius: 1, keyframes: [{ t: 0, w: 0.4 }, { t: 1, w: 1.2 }] });
    expect((c.animationIn as { kind: string }).kind).toBe('jelly');
  });
});

describe('bugs da QA', () => {
  it('B5: "corte/tire/remova/apague os primeiros/últimos N s" no demo', async () => {
    const { chatIntent } = await import('./demo');
    for (const txt of ['corte os primeiros 2 s', 'tire os primeiros 2 segundos', 'remova os primeiros 2 s', 'apague os primeiros 2s', 'corta os primeiros 2 s']) {
      const r = chatIntent(txt, { project: base(), assets: { a1: src } });
      const s = sanitizeOps(r.ops, base(), { a1: src });
      expect(s.project.tracks[0].clips[0].duration, txt).toBeCloseTo(18, 1);
    }
    const r2 = chatIntent('remova os últimos 3 segundos', { project: base(), assets: { a1: src } });
    expect(sanitizeOps(r2.ops, base(), { a1: src }).project.tracks[0].clips[0].duration).toBeCloseTo(17, 1);
  });

  it('brief com "uma transição" e "música": transição genérica e aviso quando não há trilha', async () => {
    const { parseBrief, planFirstEdit } = await import('./demo');
    expect(parseBrief('vídeo calmo com uma transição e música').transition).toEqual({ kind: 'crossfade', name: 'suaves' });
    expect(parseBrief('reels dinâmico com transições').transition?.kind).toBe('zoom-in');
    expect(parseBrief('vídeo com música').wantsMusic).toBe(true);
    // adjetivos/sinônimos não quebram o pedido de música; o aviso aparece mesmo sem nenhuma edição
    for (const b of ['Vídeo dinâmico para Reels com música animada', 'com música calma', 'com som de fundo', 'trilha sonora animada', 'quero musiquinha', 'música de fundo e legendas', 'Música animada!']) {
      expect(parseBrief(b).wantsMusic, b).toBe(true);
      const r = planFirstEdit({ project: base(), assets: { a1: src }, brief: b, silencesByAsset: {} } as never);
      expect(r.reply, b).toMatch(/Obs\.: .*não recebi nenhuma trilha/);
    }
    expect(parseBrief('vídeo sem música').wantsMusic).toBe(false);
    const plan = planFirstEdit({ project: base(), assets: { a1: src }, brief: 'vídeo com uma transição e música', silencesByAsset: { a1: [{ start: 8, end: 10 }] } } as never);
    expect(plan.reply).toMatch(/não recebi nenhuma trilha/);
    const s = sanitizeOps(plan.ops, base(), { a1: src });
    const vids = s.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'video') as VideoClip[];
    if (vids.length > 1) expect(vids.slice(1).some((c) => c.transitionIn?.kind === 'crossfade')).toBe(true);
  });

  it('"Voltar para antes desta edição" desfaz até aquele ponto, mesmo com edições depois', async () => {
    const { useEditor } = await import('../store');
    const { useAIChat } = await import('./chatStore');
    useEditor.setState({ project: base(), past: [], future: [], assets: { a1: src }, messages: [] });
    useAIChat.setState({ status: { configured: false, provider: 'demo' } as never, fast: true, runs: {}, busy: false });
    const p0 = useEditor.getState().project;
    await useAIChat.getState().send('corte os primeiros 2 s');
    const first = [...useEditor.getState().messages].reverse().find((m) => m.role === 'assistant')!;
    await useAIChat.getState().send('remova os últimos 3 segundos');
    expect(useAIChat.getState().canUndoTo(first.id)).toBe(true);
    useAIChat.getState().undoTo(first.id);
    expect(useEditor.getState().project).toBe(p0);
    expect(useEditor.getState().future.length).toBeGreaterThan(0); // dá para refazer
  }, 30000);
});

describe('música do catálogo pela IA', () => {
  it('add_music vira pedido de música (id válido) e o catálogo vai no prompt; id inventado é descartado', async () => {
    const { MUSIC_CATALOG } = await import('../music/catalog');
    const id = MUSIC_CATALOG[0].id;
    const r = sanitizeOps([{ op: 'add_music', musicId: id }, { op: 'add_music', musicId: 'nao-existe' }], base(), { a1: src });
    expect(r.sfx).toEqual([{ sfxId: `music:${id}`, at: 0 }]);
    expect(r.dropped).toHaveLength(1);
    const { sanitizeSfxRequests } = await import('./library');
    expect(sanitizeSfxRequests([{ sfxId: `music:${id}`, at: 0 }, { sfxId: 'music:x', at: 0 }], 30)).toEqual([{ sfxId: `music:${id}`, at: 0 }]);
    const { engineCatalogForAI } = await import('./catalogs');
    expect(engineCatalogForAI()).toContain(`${id} (${MUSIC_CATALOG[0].name}`);
  });
  it('demo não usa efeito sonoro da biblioteca como música de fundo', async () => {
    const { planFirstEdit } = await import('./demo');
    const sfx = { id: 'w1', kind: 'audio', role: 'music', name: 'Whoosh.wav', mime: 'audio/wav', size: 1, duration: 0.9, library: true } as MediaAsset;
    const plan = planFirstEdit({ project: base(), assets: { a1: src, w1: sfx }, brief: 'vídeo com música', silencesByAsset: {} } as never);
    expect(JSON.stringify(plan.ops)).not.toContain('"assetId":"w1"');
  });
});
