/* Vídeo modelo definitivo + movimento suave (plano 2026-11-19, 1.8 / 2.4 / R1) */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, Keyframe, MediaAsset, Project, ReferenceTemplate, StyleProfile, VideoClip } from '../types';
import { colorPresetFromStats, planFirstEdit, styleFromCuts, zoomOps } from './demo';
import { emphasisZoomOps, hookOps } from './features';
import { styleOps } from './model';
import { edgePxPerFrame } from './motion';
import { smoothKeyframes, sanitizeKeyframes, sanitizeStyleProfile } from './sanitize';
import { motionKeyframes, motionSpecOf, rhythmCutTimes, smoothMotionOps, templateCaptionStyle, templateOps } from './template';
import { sanitizeOps } from './validate';
import { MAX_AI_OPS } from './finalize';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 15 };
const assets = { a1: src };
const base = (dur = 15): Project => applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip({ ...src, duration: dur }, 0), id: 'c1' } }]).project;

/** fala com 1 palavra a cada 0,4 s e respiros de 0,3 s a cada 4 palavras */
function speech(dur: number): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  let t = 0.1, k = 0;
  while (t < dur - 1) {
    const words = [];
    for (let i = 0; i < 4 && t < dur - 0.4; i++, k++) { words.push({ id: `w${k}`, text: `p${k}`, start: +t.toFixed(3), end: +(t + 0.34).toFixed(3) }); t += 0.4; }
    segs.push({ id: `s${segs.length}`, start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(' '), words });
    t += 0.3;
  }
  return segs;
}

/** molde medido do fixture reference.mp4: 10 tomadas de 1,2 s, push-in suave 15%, só cortes secos, legenda amarela em caixa */
const refTemplate: ReferenceTemplate = {
  shots: Array.from({ length: 10 }, (_, i) => ({ start: +(i * 1.2).toFixed(1), end: +((i + 1) * 1.2).toFixed(1) })),
  shotStats: { median: 1.2, p10: 1.2, p90: 1.2 },
  motion: { mode: 'smooth-push', avgZoomPerShot: 1.15, easing: 'easeInOut', direction: 'in', punchFrequency: 0, perShot: [] },
  transitions: [{ kind: 'cut', duration: 0, frequency: 1 }],
  captions: { region: { y0: 0.704, y1: 0.771 }, textColor: '#F3D205', boxColor: '#110E0D', heightPx1920: 80, uppercase: true, wordsPerChunk: 2 },
  color: { r: 0.6, g: 0.47, b: 0.35, sat: 0.684, lum: 0.5, lumSd: 0.2 },
};
const refStyle = (): StyleProfile => styleFromCuts(refTemplate.shots.slice(1).map((s) => s.start), 12, { width: 1080, height: 1920 }, refTemplate.color, refTemplate);

const videoClips = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c): c is VideoClip => c.type === 'video').sort((a, b) => a.start - b.start);
const scaleKfs = (c: VideoClip): Keyframe[] => (c.keyframes ?? []).filter((k) => typeof k.transform.scale === 'number');

describe('1.8 perfil local honesto e cor', () => {
  it('colorPresetFromStats: quente antes de saturado (referência medida: sat 0,684, r−b 0,054 → quente)', () => {
    expect(colorPresetFromStats({ r: 0.6, g: 0.47, b: 0.546, sat: 0.684, lum: 0.5 })).toBe('warm');
    expect(colorPresetFromStats({ r: 0.5, g: 0.5, b: 0.5, sat: 0.7, lum: 0.5 })).toBe('vibrant');
  });
  it('sem molde: corte seco, sem zoom, legenda não medida, sem gancho', () => {
    const st = styleFromCuts([1.2, 2.4, 3.6], 4.8, { width: 1080, height: 1920 });
    expect(st.transitions).toEqual(['cut']);
    expect(st.zoomPunchIns).toBe(false);
    expect(st.captions).toEqual({ present: false });
    expect(st.hook).toBeUndefined();
  });
  it('com molde: copia movimento, legenda e cortes secos', () => {
    const st = refStyle();
    expect(st.motion).toMatchObject({ kind: 'smooth-push', zoomPerShot: 1.15 });
    expect(st.captions).toMatchObject({ present: true, color: '#F3D205', background: '#110E0D', uppercase: true, maxWords: 2 });
    expect(st.transitions).toEqual(['cut']);
    expect(st.template?.shots).toHaveLength(10);
  });
});

describe('1.8 movimento suave por padrão (≤ 8 px/quadro a 30 fps/1080)', () => {
  it('zoomOps suave: todo keyframe de escala com easing e ≤8 px/quadro (clipe único e cortado)', () => {
    for (const p of [base(15), applyOps(base(15), [3, 6, 9, 12].map((at, i) => ({ op: 'split_clip', clipId: i ? `n${i}` : 'c1', at, newId: `n${i + 1}` }) as EditOp)).project]) {
      const r = sanitizeOps(zoomOps(p), p, assets);
      for (const c of videoClips(r.project)) {
        const kfs = scaleKfs(c);
        expect(kfs.length).toBeGreaterThan(0);
        expect(kfs.slice(1).every((k) => k.easing && k.easing !== 'linear')).toBe(true);
        expect(edgePxPerFrame(c.keyframes, c.duration)).toBeLessThanOrEqual(8);
      }
    }
  });
  it('zoom em pancada só quando pedido (modo punch passa de 8 px/quadro)', () => {
    const p = base(15);
    const c = videoClips(applyOps(p, zoomOps(p, false, undefined, 'punch')).project)[0];
    expect(edgePxPerFrame(c.keyframes, c.duration)).toBeGreaterThan(8);
  });
  it('ênfase suave: aproximação na frase inteira, easeInOut, ≤8 px/quadro (antes: 42 px)', () => {
    let p = base(20);
    const segs = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, start: i * 2.4, end: i * 2.4 + 2, text: i === 3 ? 'Isso mudou TUDO!' : i === 5 ? 'Foram 300 clientes' : 'frase comum aqui' }));
    p = applyOps(p, [{ op: 'set_captions', segments: segs, language: 'pt-BR' } as EditOp]).project;
    const { ops, count } = emphasisZoomOps(p);
    expect(count).toBeGreaterThanOrEqual(2);
    const c = videoClips(sanitizeOps(ops, p, assets).project)[0];
    expect(Math.max(...scaleKfs(c).map((k) => k.transform.scale!))).toBeLessThanOrEqual(1.08 + 1e-9);
    expect(edgePxPerFrame(c.keyframes, c.duration)).toBeLessThanOrEqual(8);
  });
  it('gancho: 1,12 → 1 em 1,2 s easeOut (antes 1,25 → 1 em 0,5 s = 25 px/quadro)', () => {
    const p = base(15);
    const op = hookOps(p, 'Olha isso').find((o) => o.op === 'update_clip') as Extract<EditOp, { op: 'update_clip' }>;
    const kfs = op.patch.keyframes as Keyframe[];
    expect(kfs[0].transform.scale).toBe(1.12);
    expect(kfs[1]).toMatchObject({ t: 1.2, easing: 'easeOut' });
    expect(edgePxPerFrame(kfs, 15)).toBeLessThanOrEqual(8);
  });
  it('sanitizeKeyframes: keyframe de câmera da IA sem easing ganha easeInOut (props/opacidade não)', () => {
    const k = sanitizeKeyframes([{ t: 0, transform: { scale: 1 } }, { t: 2, transform: { scale: 1.1 } }, { t: 3, transform: { opacity: 0.5 } }, { t: 4, transform: { x: 0.02 }, easing: 'linear' }], 5)!;
    expect(k[1].easing).toBe('easeInOut');
    expect(k[2].easing).toBeUndefined();
    expect(k[3].easing).toBe('linear');
  });
  it('smoothKeyframes estica rampas abruptas (1→1,2 em 0,15 s vira ≥0,8 s) e respeita o próximo keyframe', () => {
    const out = smoothKeyframes([{ t: 1, transform: { scale: 1 } }, { t: 1.15, transform: { scale: 1.2 } }, { t: 4, transform: { scale: 1 } }], 6);
    expect(out[1].t).toBeGreaterThanOrEqual(1.8 - 1e-9);
    expect(out[1].easing).toBe('easeInOut');
    expect(out[2].t).toBe(4);
    expect(edgePxPerFrame(out, 6)).toBeLessThanOrEqual(8);
  });
  it('smoothMotionOps (caminho Claude) suaviza update_clip com keyframes', () => {
    const p = base(10);
    const ops: EditOp[] = [{ op: 'update_clip', clipId: 'c1', patch: { keyframes: [{ t: 0, transform: { scale: 1.25 } }, { t: 0.3, transform: { scale: 1 } }] } }];
    const out = smoothMotionOps(p, ops) as Extract<EditOp, { op: 'update_clip' }>[];
    expect(edgePxPerFrame(out[0].patch.keyframes as Keyframe[], 10)).toBeLessThanOrEqual(8);
  });
});

describe('1.8 / 2.4 réplica estrita do modelo (R1 no planejador)', () => {
  const run = (style: StyleProfile, opts: { graded?: boolean; brief?: string } = {}) => {
    let p = base(15);
    p = applyOps(p, [{ op: 'set_captions', segments: speech(15), language: 'pt-BR' } as EditOp]).project;
    const plan = planFirstEdit({ project: p, assets, brief: opts.brief ?? 'Vídeo para Reels da minha loja', silencesByAsset: { a1: [] }, style, colorGraded: opts.graded });
    const san = sanitizeOps(plan.ops, p, assets, MAX_AI_OPS);
    return { plan, p: san.project, dropped: san.dropped };
  };
  it('referência de cortes secos 1,2 s: ~12 tomadas (mediana ±20%), zero transições, todo keyframe com easing e ≤8 px/quadro', () => {
    const { p, dropped } = run(refStyle(), { graded: true });
    expect(dropped).toEqual([]);
    const vids = videoClips(p);
    expect(vids.length).toBeGreaterThanOrEqual(10);
    const durs = vids.map((c) => c.duration).sort((a, b) => a - b);
    const med = durs[Math.floor(durs.length / 2)];
    expect(Math.abs(med - 1.2) / 1.2).toBeLessThanOrEqual(0.2);
    expect(vids.every((c) => !c.transitionIn)).toBe(true);
    for (const c of vids) {
      const kfs = scaleKfs(c);
      expect(kfs.length).toBeGreaterThanOrEqual(2);
      expect(kfs.slice(1).every((k) => k.easing === 'easeInOut')).toBe(true);
      expect(edgePxPerFrame(c.keyframes, c.duration)).toBeLessThanOrEqual(8);
      // push-in: termina mais perto que começa
      expect(kfs[kfs.length - 1].transform.scale!).toBeGreaterThan(kfs[0].transform.scale!);
    }
  });
  it('cortes caem nos respiros entre palavras (nunca dentro de uma palavra)', () => {
    const { p } = run(refStyle());
    const words = p.captions.segments.flatMap((s) => s.words ?? []);
    for (const c of videoClips(p).slice(1)) expect(words.some((w) => c.start > w.start + 0.02 && c.start < w.end - 0.02)).toBe(false);
  });
  it('cor casada: nenhum colorPreset; legenda amarela em caixa em y≈0,74 mesmo sem transcrição', () => {
    const { p } = run(refStyle(), { graded: true });
    expect(videoClips(p).every((c) => !c.colorPreset || c.colorPreset === 'none')).toBe(true);
    const p0 = base(15);
    const plan = planFirstEdit({ project: p0, assets, brief: 'vídeo', silencesByAsset: { a1: [] }, style: refStyle(), colorGraded: true });
    const after = applyOps(p0, plan.ops).project;
    expect(after.captions.segments).toHaveLength(0);
    expect(after.captions.style).toMatchObject({ color: '#F3D205', background: '#110E0D', uppercase: true, maxWords: 2 });
    expect(after.captions.style.position.y).toBeCloseTo(0.738, 2);
  });
  it('não inventa: sem gancho dos textos do modelo, sem transição/zoom a mais', () => {
    const st = { ...refStyle(), textOverlays: { present: true, examples: ['OFERTA RELÂMPAGO'] }, transitions: ['cut', 'zoom-in'] } as StyleProfile;
    const { p } = run(st);
    expect(p.tracks.flatMap((t) => t.clips).some((c) => c.type === 'text' && /OFERTA/.test(c.text))).toBe(false);
    expect(videoClips(p).every((c) => !c.transitionIn)).toBe(true); // molde medido = só cortes secos
  });
  it('punch.mp4 como modelo: zoom em pancada', () => {
    const t: ReferenceTemplate = { ...refTemplate, motion: { mode: 'punch', avgZoomPerShot: 1.15, easing: 'easeOut', direction: 'in', punchFrequency: 1, perShot: [] } };
    const { p } = run(styleFromCuts([], 12, {}, refTemplate.color, t));
    expect(videoClips(p).some((c) => edgePxPerFrame(c.keyframes, c.duration) > 8)).toBe(true);
  });
  it('modelo parado: nenhuma câmera inventada', () => {
    const t: ReferenceTemplate = { ...refTemplate, motion: { mode: 'static', avgZoomPerShot: 1, easing: 'easeInOut', perShot: [] } };
    const { p } = run(styleFromCuts([], 12, {}, refTemplate.color, t));
    expect(videoClips(p).every((c) => !scaleKfs(c).length)).toBe(true);
  });
  it('rhythmCutTimes cicla as durações do modelo', () => {
    const p = applyOps(base(15), [{ op: 'set_captions', segments: speech(15), language: 'pt-BR' } as EditOp]).project;
    const cuts = rhythmCutTimes(p, [1, 2], { start: 0, end: 15 });
    const d = cuts.map((c, i) => c - (i ? cuts[i - 1] : 0));
    expect(Math.abs(d[0] - 1)).toBeLessThan(0.45);
    expect(Math.abs(d[1] - 2)).toBeLessThan(0.9);
  });
  it('styleOps com cor casada tira presets antigos (não empilha dois looks)', () => {
    let p = base(15);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'vibrant' } }]).project;
    const r = styleOps(p, refStyle(), 'all', { graded: true });
    const after = sanitizeOps(r.ops, p, assets, MAX_AI_OPS).project;
    expect(videoClips(after).every((c) => c.colorPreset === 'none')).toBe(true);
    expect(videoClips(after).every((c) => !c.transitionIn)).toBe(true);
  });
  it('motionSpecOf: sem medição = aproximação suave alternada; pedido "punch" = pancada', () => {
    expect(motionSpecOf()).toMatchObject({ mode: 'push-pull', zoom: 1.06, easing: 'easeInOut' });
    expect(motionSpecOf(refStyle(), true).mode).toBe('punch');
    expect(motionKeyframes(1.2, motionSpecOf(refStyle()), 0).at(-1)).toMatchObject({ easing: 'easeInOut' });
  });
  it('templateCaptionStyle e templateOps sem cortes (clipe curto) não quebram', () => {
    expect(templateCaptionStyle(refTemplate)).toMatchObject({ color: '#F3D205', background: '#110E0D' });
    expect(templateOps(base(1), refStyle()).ops.every((o) => o.op !== 'split_clip')).toBe(true);
  });
});

describe('2.2 contrato StyleProfile.template/motion (sanitize)', () => {
  it('sanitizeStyleProfile mantém e limita o molde', () => {
    const st = sanitizeStyleProfile({ ...refStyle(), template: { ...refTemplate, captions: { ...refTemplate.captions, textColor: 'amarelo' }, motion: { ...refTemplate.motion, avgZoomPerShot: 9 } } })!;
    expect(st.template?.shots).toHaveLength(10);
    expect(st.template?.motion.avgZoomPerShot).toBe(1.6);
    expect(st.template?.captions).toBeUndefined(); // cor inválida: faixa descartada
    expect(st.motion?.kind).toBe('smooth-push');
    expect(sanitizeStyleProfile({ summary: 'x', template: { shots: [] } })?.template).toBeUndefined();
  });
});

describe('2.5 fidelidade ao modelo', () => {
  const graded = (p: Project) => applyOps(p, videoClips(p).map((c) => ({ op: 'update_clip', clipId: c.id, patch: { colorGrade: { exposure: 0.1 } } }) as EditOp)).project;
  it('réplica do planejador: ≥0,8 em todos os aspectos (R2)', async () => {
    const { fidelityOf, fidelityLine } = await import('./fidelity');
    let p = applyOps(base(15), [{ op: 'set_captions', segments: speech(15), language: 'pt-BR' } as EditOp]).project;
    p = graded(p);
    const plan = planFirstEdit({ project: p, assets, brief: 'vídeo', silencesByAsset: { a1: [] }, style: refStyle(), colorGraded: true });
    const after = sanitizeOps(plan.ops, p, assets, MAX_AI_OPS).project;
    const f = fidelityOf(after, refStyle(), { r: 0.6, g: 0.47, b: 0.35 })!;
    expect(f.min).toBeGreaterThanOrEqual(0.8);
    expect(fidelityLine(f)).toMatch(/^Fidelidade ao modelo: ritmo \d+%, movimento \d+%, transições \d+%, legenda \d+%, cor \d+%$/);
  });
  it('edição antiga (1 clipe, pancada, transição inventada, look vibrante): nota baixa e o conserto sobe', async () => {
    const { fidelityOf, failing, repairOps } = await import('./fidelity');
    let p = applyOps(base(15), [{ op: 'set_captions', segments: speech(15), language: 'pt-BR' } as EditOp]).project;
    p = applyOps(p, [...zoomOps(p, true, undefined, 'punch'), { op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'vibrant' } }]).project;
    const f = fidelityOf(p, refStyle())!;
    const bad = failing(f);
    expect(bad).toEqual(expect.arrayContaining(['ritmo', 'movimento', 'legenda', 'cor']));
    const fixed = sanitizeOps(repairOps(p, refStyle(), bad), p, assets, MAX_AI_OPS).project;
    const g = fidelityOf(graded(fixed), refStyle())!;
    expect(g.scores.ritmo).toBeGreaterThanOrEqual(0.8);
    expect(g.scores.movimento).toBeGreaterThanOrEqual(0.8);
    expect(g.scores.legenda).toBeGreaterThanOrEqual(0.8);
    expect(g.scores.cor).toBeGreaterThanOrEqual(0.8);
  });
  it('transição a mais num modelo de cortes secos derruba "transições"', async () => {
    const { fidelityOf } = await import('./fidelity');
    let p = applyOps(base(15), [{ op: 'set_captions', segments: speech(15), language: 'pt-BR' } as EditOp]).project;
    const r = templateOps(p, refStyle());
    p = applyOps(p, r.ops).project;
    p = applyOps(p, videoClips(p).slice(1).map((c) => ({ op: 'update_clip', clipId: c.id, patch: { transitionIn: { kind: 'zoom-in', duration: 0.3 } } }) as EditOp)).project;
    expect(fidelityOf(p, refStyle())!.scores.transicoes).toBeLessThan(0.5);
  });
});
