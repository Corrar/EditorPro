/* Revisão r3 (2ª rodada) — vídeo-modelo definitivo: um teste por bug confirmado */
import { describe, expect, it, vi } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, MediaAsset, Project, ReferenceTemplate } from '../types';
import { styleFromCuts } from './demo';
import { fidelityOf } from './fidelity';
import { templateLengths, templateOps } from './template';
import { resolveDuration } from './frames';
import { analyzeReference, MAX_BODY } from './client';
import { MAX_REFERENCE_FRAMES } from './sanitize';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 10, width: 1080, height: 1920 };
const base = (dur = 10): Project => applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip({ ...src, duration: dur }, 0), id: 'c1' } }]).project;
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
const withSpeech = (dur = 10) => applyOps(base(dur), [{ op: 'set_captions', segments: speech(dur), language: 'pt-BR' } as EditOp]).project;
const color = { r: 0.5, g: 0.5, b: 0.5, sat: 0.3, lum: 0.5, lumSd: 0.2 };

/** molde de uma tomada só (modelo sem cortes): o que motion.ts devolve para um vídeo de `dur` s sem corte */
const oneShot = (dur: number): ReferenceTemplate => ({
  shots: [{ start: 0, end: dur }], shotStats: { median: dur, p10: dur, p90: dur },
  motion: { mode: 'static', avgZoomPerShot: 1, easing: 'easeInOut', direction: 'in', punchFrequency: 0, perShot: [{ start: 0, end: dur, zoomTotal: 1, panX: 0, panY: 0, peakOverMean: 1, easing: 'easeInOut', punches: 0 }] },
  transitions: [{ kind: 'cut', duration: 0, frequency: 0 }], color,
});

describe('modelo sem cortes (uma tomada só)', () => {
  it('não picota o material no tamanho do modelo (antes: modelo de 0,4 s → 24 cortes de 0,4 s num vídeo de 10 s)', () => {
    const st = styleFromCuts([], 0.4, { width: 720, height: 1280 }, color, oneShot(0.4));
    expect(templateLengths(st)).toEqual([]);
    const { ops } = templateOps(withSpeech(10), st);
    expect(ops.filter((o) => o.op === 'split_clip')).toHaveLength(0);
  });
  it('modelo de 6 s sem corte num material de 10 s: nenhum corte (antes: 1 corte "no ritmo")', () => {
    const st = styleFromCuts([], 6, { width: 720, height: 1280 }, color, oneShot(6));
    expect(templateOps(withSpeech(10), st).ops.filter((o) => o.op === 'split_clip')).toHaveLength(0);
  });
  it('fidelidade: material sem cortes segue o modelo sem cortes (antes: ritmo 30% e conserto à toa)', () => {
    const st = styleFromCuts([], 0.4, { width: 720, height: 1280 }, color, oneShot(0.4));
    const f = fidelityOf(withSpeech(10), st, { r: 0.5, g: 0.5, b: 0.5 })!;
    expect(f.scores.ritmo).toBeGreaterThanOrEqual(0.8);
    // picotar um modelo sem cortes continua sendo infiel
    let p = withSpeech(10);
    for (let i = 1; i < 10; i++) p = applyOps(p, [{ op: 'split_clip', clipId: p.tracks[0].clips[p.tracks[0].clips.length - 1].id, at: i, newId: `x${i}` } as EditOp]).project;
    const st6 = styleFromCuts([], 6, {}, color, oneShot(6));
    expect(fidelityOf(p, st6, { r: 0.5, g: 0.5, b: 0.5 })!.scores.ritmo).toBeLessThan(0.8);
  });
  it('modelo curtinho de uma tomada não vira "muito rápido" (o Claude cortaria a cada 0,4 s)', () => {
    expect(styleFromCuts([], 0.4, {}, color, oneShot(0.4)).pacing).toBe('slow');
    expect(styleFromCuts([], 0.4, {}, color).pacing).toBe('slow');
  });
});

describe('caminho Claude: quadros do modelo cabem na rota', () => {
  /** como sampleReference: até 40 quadros comuns + 14 sondas rotuladas (cortes, tomadas e 2 recortes da legenda) */
  const sample = (plainKB: number, probeKB: number) => {
    const jpg = (kb: number, i: number) => `${i}`.padEnd(kb * 1000, 'A');
    const plain = Array.from({ length: 40 }, (_, i) => ({ t: i * 1.5, data: jpg(plainKB, i), mediaType: 'image/jpeg' as const }));
    const probes = Array.from({ length: 14 }, (_, i) => ({ t: i, data: jpg(probeKB, 100 + i), mediaType: 'image/jpeg' as const, label: i >= 12 ? 'Recorte da FAIXA DE LEGENDA em resolução cheia' : `ANTES do corte ${i}` }));
    return { frames: [...plain, ...probes], metrics: { duration: 60, cuts: [], avgShotLength: 2, pacing: 'fast' as const, width: 720, height: 1280 }, localStyle: styleFromCuts([], 60) };
  };
  const posted = async (s: ReturnType<typeof sample>) => {
    let body = '';
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ style: s.localStyle }), { status: 200 }); });
    try { await analyzeReference(s as never); } finally { vi.unstubAllGlobals(); }
    return { body, frames: JSON.parse(body).frames as { label?: string }[] };
  };
  it('modelo longo: ≤48 quadros (a rota corta o resto) e os recortes da legenda vão junto (antes: 54 → a rota jogava fora os recortes)', async () => {
    const { frames } = await posted(sample(40, 20));
    expect(frames.length).toBeLessThanOrEqual(MAX_REFERENCE_FRAMES);
    expect(frames.filter((f) => f.label?.includes('FAIXA DE LEGENDA'))).toHaveLength(2);
    expect(frames.filter((f) => f.label).length).toBe(14);
  });
  it('quadros pesados: corpo < limite, mantendo as sondas rotuladas (antes: descartava sondas alternadas)', async () => {
    const { body, frames } = await posted(sample(110, 40));
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(frames.filter((f) => f.label?.includes('FAIXA DE LEGENDA'))).toHaveLength(2);
  });
});

/** <video> falso: WebM do MediaRecorder (duration = Infinity até pular para o fim) */
function fakeWebm(real: number, opts: { never?: boolean } = {}) {
  const ls = new Map<string, Set<() => void>>();
  let t = 0;
  const v = {
    duration: Infinity as number,
    get currentTime() { return t; },
    set currentTime(x: number) {
      t = opts.never ? x : Math.min(x, real);
      setTimeout(() => {
        if (!opts.never && x > real) { v.duration = real; ls.get('durationchange')?.forEach((f) => f()); }
        ls.get('seeked')?.forEach((f) => f());
      }, 1);
    },
    addEventListener: (e: string, f: () => void) => { if (!ls.has(e)) ls.set(e, new Set()); ls.get(e)!.add(f); },
    removeEventListener: (e: string, f: () => void) => { ls.get(e)?.delete(f); },
  };
  return v;
}

describe('WebM gravado no navegador (sem duração)', () => {
  it('acha a duração de verdade e volta ao começo (antes: duração 0 → "Não consegui ler o vídeo-exemplo")', async () => {
    const v = fakeWebm(5.967);
    expect(await resolveDuration(v as never, 500)).toBeCloseTo(5.967, 3);
    expect(v.currentTime).toBe(0);
  });
  it('duração normal: não mexe no vídeo', async () => {
    const v = fakeWebm(3);
    v.duration = 3;
    expect(await resolveDuration(v as never, 500)).toBe(3);
  });
  it('navegador que nunca acha o fim: desiste no prazo com 0 (não trava)', async () => {
    const v = fakeWebm(3, { never: true });
    expect(await resolveDuration(v as never, 50)).toBe(0);
  });
});
