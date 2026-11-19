/* a IA não reescreve o texto da legenda (é a fala); correção pedida mantém os tempos reais (plano §1.6) */
import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from '../ops';
import { createProject } from '../defaults';
import type { Project } from '../types';
import { guardCaptionText, sanitizeOps } from './validate';
import { alignWordTimes } from './words';

const words = [
  { id: 'w00001', start: 1.0, end: 1.3, text: 'Oi' },
  { id: 'w00002', start: 1.35, end: 1.8, text: 'gente,' },
  { id: 'w00003', start: 2.4, end: 2.7, text: 'hoje' },
  { id: 'w00004', start: 2.7, end: 2.9, text: 'eu' },
  { id: 'w00005', start: 2.9, end: 3.1, text: 'vou' },
  { id: 'w00006', start: 3.1, end: 3.6, text: 'mostar' },
];
const proj = (): Project => applyOps(createProject(), [{ op: 'set_captions', segments: [{ id: 's1', start: 1, end: 3.6, text: words.map((w) => w.text).join(' '), words }], source: 'transcription' }]).project;
const fix = (text: string): EditOp => ({ op: 'update_caption', segmentId: 's1', patch: { text } });

describe('guardCaptionText', () => {
  it('1ª edição / conferência: texto da legenda não muda (tempo/ênfase passam)', () => {
    const ops: EditOp[] = [fix('Olá pessoal hoje vou mostrar'), { op: 'update_caption', segmentId: 's1', patch: { text: 'x', emphasis: ['hoje'] } }];
    expect(guardCaptionText(ops, { mode: 'first' })).toEqual([{ op: 'update_caption', segmentId: 's1', patch: { emphasis: ['hoje'] } }]);
    expect(guardCaptionText(ops, { mode: 'review' }).length).toBe(1);
  });
  it('chat sem pedido de correção: texto cai', () => {
    expect(guardCaptionText([fix('Olá pessoal')], { mode: 'chat', userText: 'deixa a legenda amarela' })).toEqual([]);
  });
  it('chat pedindo correção ou apontando a legenda: passa', () => {
    expect(guardCaptionText([fix('Oi gente, hoje eu vou mostrar')], { mode: 'chat', userText: 'corrige a palavra mostar' }).length).toBe(1);
    expect(guardCaptionText([fix('Oi gente, hoje eu vou mostrar')], { mode: 'chat', userText: 'arruma', segmentId: 's1' }).length).toBe(1);
    expect(guardCaptionText([fix('Oi gente, hoje eu vou mostrar')], { mode: 'chat', userText: 'arruma', segmentId: 's9' })).toEqual([]);
  });
});

describe('correção de texto mantém os tempos da fala', () => {
  it('mesma quantidade: tempos e ids iguais', () => {
    const r = sanitizeOps([fix('Oi gente, hoje eu vou mostrar')], proj(), {});
    const w = (r.ops[0] as Extract<EditOp, { op: 'update_caption' }>).patch.words!;
    expect(w.map((x) => [x.id, x.start, x.end])).toEqual(words.map((x) => [x.id, x.start, x.end]));
    expect(w[5].text).toBe('mostrar');
  });
  it('palavra a mais/a menos: as outras palavras ficam no tempo real (sem redistribuir)', () => {
    const r = sanitizeOps([fix('Oi gente, hoje eu vou te mostrar')], proj(), {});
    const w = (r.ops[0] as Extract<EditOp, { op: 'update_caption' }>).patch.words!;
    expect(w.map((x) => x.text)).toEqual(['Oi', 'gente,', 'hoje', 'eu', 'vou', 'te', 'mostrar']);
    expect(w[2]).toMatchObject({ id: 'w00003', start: 2.4, end: 2.7 }); // "hoje" não se mexeu
    expect(w[6]).toMatchObject({ id: 'w00006', start: 3.1, end: 3.6 });
    expect(w[5].start).toBeGreaterThanOrEqual(2.9);
    expect(w[5].end).toBeLessThanOrEqual(3.1);
    const r2 = alignWordTimes(words, ['Oi', 'hoje', 'eu', 'vou', 'mostrar'], () => 'wx');
    expect(r2.map((x) => x.start)).toEqual([1.0, 2.4, 2.7, 2.9, 3.1]);
  });
});
