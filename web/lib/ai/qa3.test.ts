/* QA r3 (rodada 3): "deixa mais dinâmico" muda de verdade (e diz só o que mudou) e
   "corta os silêncios" depois da 1ª edição explica que as pausas já saíram. */
import { describe, expect, it } from 'vitest';
import { allWords, applyOps, projectDuration, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, CaptionWord, MediaAsset, MotionMode, Project, ReferenceTemplate, StyleProfile, TransitionKind, VideoClip } from '../types';
import { chatIntent, dynamicOps, effectiveOps, pausesAlreadyCut } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 30, width: 1080, height: 1920 };
const assets = { a1: src };

/** `n` frases de 5 palavras (0,24 s + 0,06 s), `gap` entre frases */
function words(n: number, gap: number, from = 0.2): CaptionSegment[] {
  let t = from, k = 0;
  return Array.from({ length: n }, (_, i) => {
    const ws: CaptionWord[] = Array.from({ length: 5 }, (_, j) => {
      const w = { id: `w${++k}`, text: j === 4 ? 'fim.' : `p${k}`, start: +t.toFixed(3), end: +(t + 0.24).toFixed(3) };
      t += 0.3;
      return w;
    });
    t += gap - 0.06;
    return { id: `s${i}`, start: ws[0].start, end: ws[4].end, text: ws.map((w) => w.text).join(' '), words: ws };
  });
}

function tpl(mode: MotionMode, transitions: { kind: TransitionKind; duration: number; frequency: number }[] = [{ kind: 'cut', duration: 0, frequency: 1 }], captions = false): StyleProfile {
  const template = {
    shots: [{ start: 0, end: 1.2 }, { start: 1.2, end: 2.4 }, { start: 2.4, end: 3.6 }],
    shotStats: { median: 1.2, p10: 1, p90: 1.4 },
    motion: { mode, avgZoomPerShot: mode === 'static' ? 1 : 1.05, easing: 'easeInOut', direction: 'in', perShot: [] },
    transitions,
    color: { r: 120, g: 110, b: 100, sat: 0.3, lum: 0.5 },
    ...(captions ? { captions: { region: { y0: 0.7, y1: 0.78 }, textColor: '#FFFFFF', boxColor: null, heightPx1920: 60, wordsPerChunk: 2 } } : {}),
  } as ReferenceTemplate;
  return { summary: 'modelo', pacing: 'fast', avgShotLength: 1.2, transitions: [], zoomPunchIns: false, template };
}

/** projeto com `shots` tomadas iguais (com ou sem movimento), legendas e estilo opcional */
function project(o: { shots: number; dur: number; segs: CaptionSegment[]; moving?: boolean; style?: StyleProfile; maxWords?: number }): Project {
  const len = o.dur / o.shots;
  const ops: EditOp[] = Array.from({ length: o.shots }, (_, i) => ({
    op: 'add_clip' as const, trackId: 'track_video_1',
    clip: { ...makeVideoClip(src, +(i * len).toFixed(3), { in: +(i * len).toFixed(3), duration: +len.toFixed(3) }), id: `c${i}`, ...(o.moving ? { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: +len.toFixed(3), transform: { scale: 1.05 }, easing: 'easeInOut' as const }] } : {}) } as VideoClip,
  }));
  ops.push({ op: 'set_captions', segments: o.segs, language: 'pt-BR', source: 'transcription' });
  ops.push({ op: 'set_caption_style', style: { maxWords: o.maxWords ?? 2 } });
  if (o.style) ops.push({ op: 'set_project', patch: { style: o.style } });
  return applyOps(createProject(), ops).project;
}

const intact = (a: Project, b: Project) => {
  const d = new Map(allWords(a).map((w) => [w.id, +(w.end - w.start).toFixed(3)]));
  expect(allWords(b).map((w) => w.text)).toEqual(allWords(a).map((w) => w.text));
  for (const w of allWords(b)) expect(+(w.end - w.start).toFixed(3)).toBeCloseTo(d.get(w.id)!, 2);
};

describe('"deixa mais dinâmico"', () => {
  it('projeto da QA (modelo suave, 22 tomadas com movimento, legenda TikTok): antes "zoom suave + legendas rápidas" sem mudar nada; agora aperta os respiros e diz isso', () => {
    const segs = words(4, 0.45);
    const p = project({ shots: 22, dur: segs[3].end + 0.3, segs, moving: true, style: tpl('smooth-push') });
    const r = chatIntent('deixa mais dinâmico', { project: p, assets });
    const after = applyOps(p, r.ops).project;
    expect(r.ops.length).toBeGreaterThan(0);
    expect(r.ops.every((o) => o.op === 'cut_pauses')).toBe(true); // nada de zoom/legenda repetidos
    expect(projectDuration(after)).toBeLessThan(projectDuration(p));
    expect(r.reply).toMatch(/apertei 3 respiros/);
    expect(r.reply).not.toMatch(/zoom|legendas rápidas/);
    intact(p, after);
  });

  it('já no máximo (respiros curtos, legenda rápida, tudo com movimento): diz com honestidade e não mexe', () => {
    const segs = words(4, 0.2);
    const p = project({ shots: 6, dur: segs[3].end + 0.3, segs, moving: true, style: tpl('smooth-push') });
    const r = chatIntent('deixa mais dinâmico', { project: p, assets });
    expect(r.ops).toEqual([]);
    expect(r.reply).not.toMatch(/^Feito/);
    expect(r.reply).toMatch(/^Já está no ritmo mais dinâmico/);
    expect(r.reply).toMatch(/modelo/);
  });

  it('projeto real da QA (fala até 15,5 s + 10 s de b-roll sem fala, respiros ≤ 0,24 s): encurta o trecho sem fala para 3 s', () => {
    const segs = words(4, 0.2);
    const end = segs[3].end;
    const p = project({ shots: 22, dur: end + 10.2, segs, moving: true, style: tpl('smooth-push') });
    const r = chatIntent('deixa mais dinâmico', { project: p, assets });
    const after = applyOps(p, r.ops).project;
    expect(projectDuration(after)).toBeCloseTo(end + 0.15 + 3, 1);
    expect(r.reply).toMatch(/^Feito: encurtei o trecho sem fala \(7,\d s a menos\)/);
    intact(p, after);
  });

  it('brief pediu 20 s e o vídeo já tem 20 s: não encurta abaixo do pedido e explica', () => {
    const segs = words(4, 0.2);
    const end = segs[3].end;
    const p0 = project({ shots: 10, dur: 20, segs, moving: true, style: tpl('smooth-push') });
    const p = applyOps(p0, [{ op: 'set_project', patch: { brief: 'Reels dinâmico de 20s' } }]).project;
    expect(20 - end).toBeGreaterThan(4); // há trecho sem fala longo
    const r = chatIntent('deixa mais dinâmico', { project: p, assets });
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/já está nos 20 s que você pediu/);
  });

  it('sem modelo, tomada longa e parada, legenda de frase: corta no ritmo, dá aproximação SUAVE e legenda em blocos curtos', () => {
    const segs = words(6, 0.2);
    const p = project({ shots: 1, dur: segs[5].end + 0.3, segs, maxWords: 6 });
    const d = dynamicOps(p);
    const after = applyOps(p, d.ops).project;
    const clips = after.tracks[0].clips as VideoClip[];
    expect(clips.length).toBeGreaterThan(2);
    expect(clips.every((c) => (c.keyframes ?? []).length >= 2)).toBe(true);
    // suave: no máximo 8% de zoom, sem pancada (rampa da tomada inteira)
    for (const c of clips) for (const k of c.keyframes ?? []) expect(k.transform.scale ?? 1).toBeLessThanOrEqual(1.081);
    expect(after.captions.style.rhythm).toBe('punch');
    expect(after.captions.style.maxWords).toBe(3);
    expect(clips.some((c) => c.transitionIn)).toBe(false); // sem modelo: sem transição inventada
    expect(d.said.join(' ')).toMatch(/corte.*aproximação suave.*/s);
    intact(p, after);
  });

  it('modelo de câmera parada: tomada parada continua parada', () => {
    const segs = words(3, 0.2);
    const p = project({ shots: 4, dur: segs[2].end + 0.3, segs, style: tpl('static') });
    const d = dynamicOps(p);
    expect(d.ops.some((o) => o.op === 'update_clip' && 'keyframes' in o.patch)).toBe(false);
  });

  it('modelo com transição: põe a do modelo nos cortes que não têm; modelo com legenda: não troca a legenda dele', () => {
    const segs = words(3, 0.2);
    const p = project({ shots: 4, dur: segs[2].end + 0.3, segs, moving: true, maxWords: 6, style: tpl('smooth-push', [{ kind: 'crossfade', duration: 0.3, frequency: 1 }], true) });
    const d = dynamicOps(p);
    const after = applyOps(p, d.ops).project;
    expect((after.tracks[0].clips as VideoClip[]).slice(1).every((c) => c.transitionIn?.kind === 'crossfade')).toBe(true);
    expect(after.captions.style.maxWords).toBe(6);
    expect(d.said.join(' ')).toMatch(/3 transições do modelo/);
  });

  it('effectiveOps descarta op que não muda nada', () => {
    const segs = words(2, 0.2);
    const p = project({ shots: 2, dur: 4, segs });
    const same: EditOp = { op: 'set_caption_style', style: { maxWords: 2 } };
    const diff: EditOp = { op: 'set_caption_style', style: { maxWords: 3 } };
    expect(effectiveOps(p, [same, diff]).ops).toEqual([diff]);
  });
});

describe('"corta os silêncios" depois da 1ª edição', () => {
  it('as pausas do áudio já não estão na timeline: diz que já foram cortadas (antes: "Não encontrei pausas")', () => {
    const segs = words(2, 0.2);
    // a timeline usa só 0–3 s da mídia; a pausa medida (8–9 s da mídia) já saiu
    const p = project({ shots: 1, dur: 3, segs });
    const silences = { a1: [{ start: 8, end: 9 }] };
    expect(pausesAlreadyCut(silences)).toBe(true);
    const r = chatIntent('corta os silêncios', { project: p, assets, silencesByAsset: silences });
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/^As pausas já foram cortadas/);
  });

  it('áudio sem pausa nenhuma: diz que não achou pausas longas e como apertar mais', () => {
    const p = project({ shots: 1, dur: 3, segs: words(2, 0.2) });
    const r = chatIntent('corta os silêncios', { project: p, assets, silencesByAsset: { a1: [] } });
    expect(r.reply).toMatch(/não encontrei pausas longas/i);
    expect(r.reply).toMatch(/corta todas as pausas/);
  });
});
