import { describe, expect, it } from 'vitest';
import { createProject } from '../defaults';
import { applyOps, projectDuration } from '../ops';
import type { MediaAsset, Project, ShapeClip, TextClip } from '../types';
import { googleFontsUrl, nearestWeight, searchFonts, FONT_CATALOG, projectFonts, fontDef } from './fonts';
import { emojiFor, emojiForWords } from './emoji';
import { CAPTION_PRESETS, captionPresetOp, captionStylePatch, captionBasePreset } from './captions';
import { TEXT_ANIMATIONS, CLIP_ANIMATIONS, textAnimationOp, clipAnimationOp, textAnimationsFor } from './animations';
import { TEMPLATES, buildTemplate, shapeGeometry, estimateTextWidth, templateFonts } from './templates';
import { LOOKS, lookFilters, detectLook, lookClipOps, lookAdjustmentOps } from './looks';
import { SFX_CATALOG, renderSfx, sfxWav, wavInfo, sfxClipOps } from './sfx';
import { TEXT_ANIMATION_LABELS } from '../engine/text';
import { CLIP_ANIMATION_LABELS } from '../engine/animations';
import { libraryCatalogForAI } from './catalog';

const allClips = (p: Project) => p.tracks.flatMap((t) => t.clips);

describe('fontes', () => {
  it('catálogo tem ~30 famílias únicas com pesos', () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FONT_CATALOG.map((f) => f.family)).size).toBe(FONT_CATALOG.length);
    for (const f of FONT_CATALOG) {
      expect(f.weights.length).toBeGreaterThan(0);
      expect(f.weights).toContain(nearestWeight(f.family, f.display));
    }
  });
  it('monta URL do Google Fonts só com pesos existentes', () => {
    const url = googleFontsUrl([{ family: 'Montserrat', weights: [900, 680] }, { family: 'Anton', weights: [800] }, { family: 'Inexistente' }])!;
    expect(url).toContain('family=Montserrat:wght@700;900');
    expect(url).toContain('family=Anton&');
    expect(url).not.toContain('Inexistente');
    expect(url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
  });
  it('busca sem acento e por categoria', () => {
    expect(searchFonts('cursiva').map((f) => f.family)).toContain('Dancing Script');
    expect(searchFonts('', 'mono').every((f) => f.category === 'mono')).toBe(true);
    expect(fontDef('"Bebas Neue"')?.narrow).toBe(true);
  });
  it('lista fontes usadas no projeto', () => {
    const p = createProject();
    const fonts = projectFonts(p).map((f) => f.family);
    expect(fonts).toContain(p.captions.style.fontFamily);
  });
});

describe('emojiFor', () => {
  it('reconhece palavras-chave com acento, pontuação e plural', () => {
    expect(emojiFor('Dinheiro!')).toBe('💰');
    expect(emojiFor('IDEIAS')).toBe('💡');
    expect(emojiFor('atenção:')).toBe('⚠️');
    expect(emojiFor('corações')).toBe('❤️');
    expect(emojiFor('cafezinho')).toBeNull();
    expect(emojiFor('foguetinho')).toBe('🚀');
  });
  it('ignora palavras comuns e curtas', () => {
    expect(emojiFor('não')).toBeNull();
    expect(emojiFor('a')).toBeNull();
    expect(emojiFor('mesa')).toBeNull();
  });
  it('primeiro emoji de um bloco', () => {
    expect(emojiForWords(['isso', 'é', 'fogo'])).toBe('🔥');
    expect(emojiForWords(['nada', 'aqui'])).toBeNull();
  });
});

describe('estilos de legenda', () => {
  it('20 presets com ids únicos e base nativa', () => {
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CAPTION_PRESETS.map((c) => c.id)).size).toBe(CAPTION_PRESETS.length);
    for (const c of CAPTION_PRESETS) {
      expect(fontDef(c.style.fontFamily)).toBeTruthy();
      expect(['classic', 'bold-pop', 'karaoke', 'minimal', 'boxed', 'neon']).toContain(c.base);
    }
    expect(captionBasePreset('karaoke')).toBe('karaoke');
    expect(captionBasePreset('caixa-por-palavra')).toBe('boxed');
    expect(captionBasePreset('xyz')).toBe('classic');
  });
  it('trocar de preset zera campos do anterior e mantém posição', () => {
    let p = createProject();
    p = applyOps(p, [{ op: 'set_caption_style', style: { position: { x: 0.5, y: 0.4 } } }]).project;
    p = applyOps(p, [captionPresetOp('caixa-por-palavra', p.captions.style)!]).project;
    expect(p.captions.style.wordBox).toBeTruthy();
    expect(p.captions.style.preset).toBe('caixa-por-palavra');
    expect(p.captions.style.position.y).toBe(0.4);
    p = applyOps(p, [captionPresetOp('minimal-branco', p.captions.style)!]).project;
    expect(p.captions.style.wordBox).toBeUndefined();
    expect(p.captions.style.fontFamily).toBe('Inter');
    expect(p.captions.style.maxWords).toBe(6);
  });
  it('preset que define posição (letterbox) sobrepõe', () => {
    const patch = captionStylePatch('cinema-letterbox', { position: { x: 0.5, y: 0.3 } })!;
    expect(patch.position!.y).toBeGreaterThan(0.9);
    expect(captionPresetOp('nao-existe')).toBeNull();
  });
});

describe('animações', () => {
  it('todo id do catálogo existe no engine (rótulos)', () => {
    for (const a of TEXT_ANIMATIONS) expect(TEXT_ANIMATION_LABELS[a.id]).toBeTruthy();
    for (const a of CLIP_ANIMATIONS) expect(CLIP_ANIMATION_LABELS[a.id]).toBeTruthy();
    expect(Object.keys(TEXT_ANIMATION_LABELS).length).toBe(TEXT_ANIMATIONS.length);
  });
  it('ops de animação aplicam em clipes', () => {
    const p0 = buildP();
    const text = allClips(p0).find((c) => c.type === 'text') as TextClip;
    const shape = allClips(p0).find((c) => c.type === 'shape') as ShapeClip;
    let r = applyOps(p0, [textAnimationOp(text.id, 'out', 'word-fade'), textAnimationOp(text.id, 'in', 'stomp'), clipAnimationOp(shape.id, 'loop', 'swing')]);
    expect(r.errors).toEqual([]);
    const t2 = allClips(r.project).find((c) => c.id === text.id) as TextClip;
    expect(t2.animation).toBe('stomp');
    expect(t2.animationOut).toBe('word-fade');
    expect((allClips(r.project).find((c) => c.id === shape.id) as ShapeClip).animationLoop?.kind).toBe('swing');
    r = applyOps(r.project, [textAnimationOp(text.id, 'out', 'none')]);
    expect((allClips(r.project).find((c) => c.id === text.id) as TextClip).animationOut).toBeUndefined();
    expect(textAnimationsFor('loop').every((a) => a.slots.includes('loop'))).toBe(true);
  });
});

function buildP() {
  const p = createProject();
  return applyOps(p, buildTemplate('lt-caixa', { nome: 'Bruno' }, { project: p, at: 1 })).project;
}

describe('modelos', () => {
  it('catálogo cobre títulos, 5 lower thirds, CTAs e motion graphics', () => {
    expect(TEMPLATES.filter((t) => t.category === 'lower-third').length).toBe(5);
    expect(TEMPLATES.filter((t) => t.category === 'cta').length).toBeGreaterThanOrEqual(4);
    for (const id of ['titulo-impacto', 'titulo-elegante', 'titulo-cinema', 'subtitulo', 'contador', 'citacao', 'preco-oferta', 'lista-123', 'capitulo', 'barra-progresso', 'antes-depois', 'nome-na-tela', 'marca-dagua']) {
      expect(TEMPLATES.some((t) => t.id === id)).toBe(true);
    }
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  for (const aspect of ['9:16', '16:9'] as const) {
    it(`todos geram ops válidas aplicáveis (${aspect})`, () => {
      for (const def of TEMPLATES) {
        const p = createProject({ aspect });
        const ops = buildTemplate(def.id, {}, { project: p, at: 2, groupId: 'g1' });
        expect(ops.length, def.id).toBeGreaterThan(0);
        const { project, errors } = applyOps(p, ops);
        expect(errors, def.id).toEqual([]);
        const added = allClips(project).filter((c) => c.groupId === 'g1');
        expect(added.length, def.id).toBe(ops.filter((o) => o.op === 'add_clip').length);
        // texto por cima das formas
        const ti = project.tracks.findIndex((t) => t.clips.some((c) => c.groupId === 'g1' && c.type === 'text'));
        const oi = project.tracks.findIndex((t) => t.clips.some((c) => c.groupId === 'g1' && c.type !== 'text'));
        if (ti >= 0 && oi >= 0) expect(oi, def.id).toBeLessThan(ti);
        for (const c of added) {
          expect(c.duration, def.id).toBeGreaterThan(0);
          if (!def.fullLength) { expect(c.start).toBeGreaterThanOrEqual(2); expect(c.start + c.duration).toBeLessThanOrEqual(2 + def.duration + 1e-6); }
          if (c.type === 'text') {
            expect(c.position.x, `${def.id} x`).toBeGreaterThan(0);
            expect(c.position.x, `${def.id} x`).toBeLessThan(1);
            expect(c.templateId).toBe(def.id);
          }
          if (c.type === 'shape') expect(Number.isFinite(c.transform.scale) && c.transform.scale > 0).toBe(true);
        }
      }
    });
  }

  it('inserir duas vezes no mesmo ponto não sobrepõe na mesma trilha', () => {
    let p = createProject();
    p = applyOps(p, buildTemplate('lt-caixa', {}, { project: p, at: 0, groupId: 'a' })).project;
    p = applyOps(p, buildTemplate('lt-caixa', {}, { project: p, at: 0, groupId: 'b' })).project;
    const trackOf = (g: string, type: string) => p.tracks.findIndex((t) => t.clips.some((c) => c.groupId === g && c.type === type));
    expect(trackOf('a', 'text')).not.toBe(trackOf('b', 'text'));
    expect(trackOf('a', 'shape')).not.toBe(trackOf('b', 'shape'));
    expect(trackOf('b', 'shape')).toBeLessThan(trackOf('b', 'text'));
  });

  it('parâmetros substituem textos; marca d’água cobre o projeto inteiro', () => {
    let p = createProject();
    p = applyOps(p, buildTemplate('titulo-impacto', { titulo: 'OLÁ BRUNO' }, { project: p, at: 0 })).project;
    expect(allClips(p).some((c) => c.type === 'text' && c.text === 'OLÁ BRUNO')).toBe(true);
    p = applyOps(p, [{ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: 'x', start: 0, duration: 12, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [] } }]).project;
    const ops = buildTemplate('marca-dagua', { texto: '@bruno' }, { project: p, at: 5, groupId: 'wm' });
    p = applyOps(p, ops).project;
    const wm = allClips(p).filter((c) => c.groupId === 'wm');
    expect(wm.every((c) => c.start === 0 && Math.abs(c.duration - projectDuration(p)) < 1e-6)).toBe(true);
  });

  it('contagem regressiva gera um texto por número + final', () => {
    const p = createProject();
    const r = applyOps(p, buildTemplate('contador', { de: 5, final: 'VAI' }, { project: p, at: 0, groupId: 'c' }));
    const texts = allClips(r.project).filter((c) => c.type === 'text') as TextClip[];
    expect(texts.map((t) => t.text)).toEqual(['5', '4', '3', '2', '1', 'VAI']);
    for (let i = 1; i < texts.length; i++) expect(texts[i].start).toBeGreaterThanOrEqual(texts[i - 1].start + texts[i - 1].duration - 1e-6);
  });

  it('geometria de forma: caixa larga vira aspect, barra alta gira 90°', () => {
    const g = shapeGeometry({ cx: 0.5, cy: 0.5, w: 0.5, h: 0.05 }, 'rounded-rect', 1080, 1920);
    expect(g.aspect).toBeCloseTo((0.5 * 1080) / (0.05 * 1920), 5);
    expect(g.transform.scale).toBeCloseTo((0.5 * 1080) / (1080 * 0.95), 5);
    const v = shapeGeometry({ cx: 0.1, cy: 0.5, w: 0.01, h: 0.2 }, 'rect', 1080, 1920);
    expect(v.rotate90).toBe(true);
    expect(v.transform.rotation).toBe(90);
    expect(v.transform.x).toBeCloseTo(-0.4);
  });

  it('estimativa de largura considera fonte estreita e caixa alta', () => {
    const a = estimateTextWidth('TESTE', { fontFamily: 'Anton', fontSize: 100 }, 1920);
    const b = estimateTextWidth('TESTE', { fontFamily: 'Poppins', fontSize: 100 }, 1920);
    expect(a).toBeLessThan(b);
    expect(templateFonts('titulo-cinema', createProject())).toContain('Bebas Neue');
  });
});

describe('looks', () => {
  it('16 looks únicos', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
  });
  it('intensidade interpola a partir do neutro', () => {
    const full = lookFilters('teal-laranja', 1);
    const half = lookFilters('teal-laranja', 0.5);
    expect(lookFilters('teal-laranja', 0)).toEqual([]);
    expect(half.length).toBe(full.length);
    for (const f of full) {
      const h = half.find((x) => x.kind === f.kind)!;
      expect(h.value).toBeCloseTo(f.value / 2, 2);
    }
    expect(lookFilters('teal-laranja', 7)).toEqual(full);
  });
  it('look com preset nativo expande e soma filtros repetidos', () => {
    const v = lookFilters('vintage-70', 1);
    expect(v.find((f) => f.kind === 'sepia')).toBeTruthy();
    expect(new Set(v.map((f) => f.kind)).size).toBe(v.length);
  });
  it('detecta look e intensidade', () => {
    for (const l of LOOKS) {
      const d = detectLook(lookFilters(l.id, 0.6));
      expect(d?.id, l.id).toBe(l.id);
      expect(d?.intensity).toBeCloseTo(0.6, 1);
    }
    expect(detectLook([{ kind: 'blur', value: 0.3 }])).toBeNull();
  });
  it('aplica em clipe ou como camada de ajuste acima do vídeo', () => {
    const p0 = createProject();
    let p = applyOps(p0, [{ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: 'x', start: 0, duration: 8, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [], colorPreset: 'warm' } }]).project;
    p = applyOps(p, lookClipOps(p, ['v'], 'noir', 0.8)).project;
    const v = allClips(p).find((c) => c.id === 'v') as Extract<Project['tracks'][number]['clips'][number], { type: 'video' }>;
    expect(v.colorPreset).toBe('none');
    expect(detectLook(v.filters)?.id).toBe('noir');
    const r = applyOps(p, lookAdjustmentOps(p, 'verao', 1));
    expect(r.errors).toEqual([]);
    const ei = r.project.tracks.findIndex((t) => t.kind === 'effect');
    const vi = r.project.tracks.findIndex((t) => t.id === 'track_video_1');
    const ti = r.project.tracks.findIndex((t) => t.kind === 'text');
    expect(ei).toBeGreaterThan(vi);
    expect(ei).toBeLessThan(ti);
    const adj = r.project.tracks[ei].clips[0];
    expect(adj.type).toBe('adjustment');
    expect(adj.duration).toBe(8);
  });
});

describe('efeitos sonoros', () => {
  it('catálogo com ~16 efeitos', () => {
    expect(SFX_CATALOG.length).toBeGreaterThanOrEqual(24);
  });
  for (const s of SFX_CATALOG) {
    it(`"${s.id}" gera WAV válido com a duração certa e sem silêncio/clip`, () => {
      const sr = 22050;
      const wav = sfxWav(s.id, sr);
      const info = wavInfo(wav)!;
      expect(info).toBeTruthy();
      expect(info.sampleRate).toBe(sr);
      expect(info.channels).toBe(2);
      expect(info.bits).toBe(16);
      expect(info.duration).toBeCloseTo(s.duration, 2);
      expect(wav.byteLength).toBe(44 + Math.round(s.duration * sr) * 2 * 2);
      const [l] = renderSfx(s.id, sr);
      let peak = 0, energy = 0;
      for (let i = 0; i < l.length; i++) { peak = Math.max(peak, Math.abs(l[i])); energy += l[i] * l[i]; }
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(0.9);
      expect(energy / l.length).toBeGreaterThan(1e-4);
      expect(Math.abs(l[0])).toBeLessThan(0.01);
      expect(Math.abs(l[l.length - 1])).toBeLessThan(0.05);
    });
  }
  it('determinístico', () => {
    expect(renderSfx('whoosh', 8000)[0]).toEqual(renderSfx('whoosh', 8000)[0]);
  });
  it('coloca o AudioClip numa trilha de efeitos livre no playhead', () => {
    const asset: MediaAsset = { id: 'a1', kind: 'audio', role: 'music', name: 'Pop.wav', mime: 'audio/wav', size: 1, duration: 0.18, library: true };
    let p = createProject();
    let r = applyOps(p, sfxClipOps(p, asset, 3));
    expect(r.errors).toEqual([]);
    p = r.project;
    const sfxTrack = p.tracks.find((t) => t.name === 'Efeitos sonoros')!;
    expect(sfxTrack.clips[0].start).toBe(3);
    // segundo no mesmo ponto vai p/ outra trilha; em outro ponto reaproveita
    r = applyOps(p, sfxClipOps(p, asset, 3));
    expect(r.project.tracks.filter((t) => /Efeitos sonoros/.test(t.name)).length).toBe(2);
    r = applyOps(p, sfxClipOps(p, asset, 5));
    expect(r.project.tracks.filter((t) => /Efeitos sonoros/.test(t.name)).length).toBe(1);
    expect(r.project.tracks.find((t) => t.name === 'Efeitos sonoros')!.clips.length).toBe(2);
    expect(() => renderSfx('nada')).toThrow();
  });
});

describe('catálogo p/ IA', () => {
  it('lista os ids', () => {
    const s = libraryCatalogForAI();
    expect(s).toContain('impacto-amarelo');
    expect(s).toContain('lt-caixa');
    expect(s).toContain('teal-laranja');
    expect(s).toContain('whoosh');
  });
});

import { matchesQuery, searchLibrary } from './search';
describe('busca única', () => {
  it('ignora acento/caixa e exige todas as palavras', () => {
    expect(matchesQuery('legenda neon', ['Legenda', 'Néon vibrante'])).toBe(true);
    expect(matchesQuery('neon azul', ['Neon'])).toBe(false);
    expect(matchesQuery('', ['x'])).toBe(true);
  });
  it('conta resultados por aba', () => {
    const c = searchLibrary('neon');
    expect(c.legendas).toBeGreaterThan(0);
    expect(c.looks).toBeGreaterThan(0);
    expect(searchLibrary('whoosh').sons).toBe(1);
    expect(searchLibrary('lower third').modelos).toBe(5);
    expect(Object.values(searchLibrary('zzzqqq')).every((n) => n === 0)).toBe(true);
  });
});

describe('modelos com campos vazios', () => {
  const run = (id: string, values: Record<string, string>) => {
    const p = createProject();
    const ops = buildTemplate(id, values, { project: p, at: 0, groupId: 'g' });
    const r = applyOps(p, ops);
    expect(r.errors).toEqual([]);
    return allClips(r.project).filter((c) => c.groupId === 'g');
  };
  it('lt-caixa sem função não desenha a faixa nem o texto da função', () => {
    const full = run('lt-caixa', {});
    const noRole = run('lt-caixa', { funcao: '  ' });
    expect(full.filter((c) => c.type === 'shape').length).toBe(2);
    expect(noRole.filter((c) => c.type === 'shape').length).toBe(1);
    expect(noRole.filter((c) => c.type === 'text').map((c) => (c as TextClip).text)).toEqual(['Ana Souza']);
  });
  it('lt-glass sem função encolhe o cartão e centraliza o nome', () => {
    const full = run('lt-glass', {}), noRole = run('lt-glass', { funcao: '' });
    const box = (cs: typeof full) => cs.find((c) => c.type === 'shape' && (c as ShapeClip).shape === 'rounded-rect') as ShapeClip;
    expect(box(noRole).aspect!).toBeGreaterThan(box(full).aspect!); // mais baixo => mais "largo"
    const name = noRole.find((c) => c.type === 'text') as TextClip;
    expect(name.position.y).toBeCloseTo(0.5 + box(noRole).transform.y, 5);
  });
  it('lt-barra sem função encurta a barra; citação sem autor omite o "—"', () => {
    const bar = (cs: ReturnType<typeof run>) => (cs.find((c) => c.type === 'shape') as ShapeClip).transform.scale;
    expect(bar(run('lt-barra', { funcao: '' }))).toBeLessThan(bar(run('lt-barra', {})));
    expect(run('citacao', { autor: '' }).filter((c) => c.type === 'text').length).toBe(2);
  });
  it('selo/preço antigo/subtítulo vazios removem as formas ligadas', () => {
    expect(run('preco-oferta', { selo: '' }).some((c) => c.type === 'shape')).toBe(false);
    expect(run('preco-riscado', { antes: '' }).some((c) => c.type === 'shape')).toBe(false);
    expect(run('titulo-elegante', { sub: '' }).some((c) => c.type === 'shape')).toBe(false);
  });
  it('modelo sem nenhum texto não gera nada', () => {
    expect(buildTemplate('marca-dagua', { texto: '' }, { project: createProject() })).toEqual([]);
    expect(buildTemplate('lt-minimal', { nome: '', funcao: '' }, { project: createProject() })).toEqual([]);
  });
});

describe('looks em camada (revisão)', () => {
  it('trocar o look no vídeo todo reaproveita a camada em vez de empilhar', () => {
    let p = createProject();
    p = applyOps(p, [{ op: 'add_clip', trackId: 'track_video_1', clip: { id: 'v', type: 'video', assetId: 'x', start: 0, duration: 6, in: 0, speed: 1, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, filters: [] } }]).project;
    p = applyOps(p, lookAdjustmentOps(p, 'noir', 1)).project;
    p = applyOps(p, lookAdjustmentOps(p, 'verao', 0.5)).project;
    const adj = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'adjustment');
    expect(adj.length).toBe(1);
    expect(adj[0].label).toBe('Look · Verão');
    expect(adj[0].type === 'adjustment' && detectLook(adj[0].filters)?.id).toBe('verao');
  });
});
