/* Duração pedida no brief: leitura do texto e ajuste da edição (sem cortar palavra, mantendo o gancho). */
import { describe, expect, it } from 'vitest';
import { allWords, applyOps, projectDuration, type EditOp } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { CaptionSegment, CaptionWord, MediaAsset, Project } from '../types';
import { fitDurationOps, phrasesOf, targetDurationFromText } from './fit';
import { planFirstEdit } from './demo';

describe('targetDurationFromText', () => {
  it.each([
    ['Reels dinâmico de 20s com legendas grandes, cortes rápidos e música animada', 20],
    ['vídeo de 20 segundos', 20],
    ['quero um vídeo de 30 s pro feed', 30],
    ['vídeo de 1 minuto', 60],
    ['um reels de 1 min e 30 s', 90],
    ['até 15s, bem rápido', 15],
    ['Reels de no máximo 45 seg', 45],
    ['meio minuto de vídeo', 30],
    ['vídeo curto de 12,5s', 12.5],
  ])('"%s" -> %s s', (text, want) => expect(targetDurationFromText(text)).toBe(want));

  it.each([
    'corta os primeiros 3 s',
    'corte a cada 2 s com legenda',
    'cortar pausas acima de 1 s',
    'transição de 0,5 s entre os cortes',
    'efeito VHS de 4 a 9 s',
    'vídeo dinâmico com legendas',
    'formato 9:16 para reels',
  ])('"%s" -> sem duração total', (text) => expect(targetDurationFromText(text)).toBeUndefined());

  it('o tempo total vale mesmo com outro tempo antes ("pausas acima de 1 s, vídeo de 20 s")', () => {
    expect(targetDurationFromText('cortar pausas acima de 1 s, vídeo de 20 s')).toBe(20);
  });
});

/* ---------- material parecido com o da QA: fala de 18,7 s + clipe sem fala de 10 s ---------- */

const fala: MediaAsset = { id: 'fala', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 18.7, width: 1080, height: 1920 };
const broll: MediaAsset = { id: 'broll', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 10, width: 1080, height: 1920 };

/** frases → palavras com tempo (0,24 s por palavra, 0,06 s entre palavras, `gap` entre frases) */
function speech(sentences: string[], from = 0.3, gap = 0.5): CaptionSegment[] {
  let t = from;
  let n = 0;
  return sentences.map((s, i) => {
    const words: CaptionWord[] = s.split(' ').map((w) => {
      const word = { id: `w${String(++n).padStart(5, '0')}`, text: w, start: +t.toFixed(3), end: +(t + 0.24).toFixed(3) };
      t += 0.3;
      return word;
    });
    t += gap - 0.06;
    return { id: `s${i}`, start: words[0].start, end: words[words.length - 1].end, text: s, words };
  });
}
const SENT = [
  'Oi gente, hoje eu vou mostrar como fazer um bolo de chocolate muito fácil.',
  'Primeiro, separe três ovos, uma xícara de açúcar e duas xícaras de farinha.',
  'Depois é só misturar tudo e levar ao forno por quarenta minutos.',
  'Se você gostou, deixa o seu like e me segue para mais receitas.',
];

function project(segs: CaptionSegment[], withBroll: boolean, falaDur = 18.7): Project {
  const ops: EditOp[] = [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip({ ...fala, duration: falaDur }, 0), id: 'v1' } }];
  if (withBroll) ops.push({ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(broll, falaDur), id: 'v2' } });
  ops.push({ op: 'set_captions', segments: segs, language: 'pt-BR', source: 'transcription' });
  return applyOps(createProject(), ops).project;
}

/** nenhuma palavra que ficou mudou de tamanho (corte no meio dela encurtaria) */
function wordsIntact(before: Project, after: Project) {
  const dur = new Map(allWords(before).map((w) => [w.id, +(w.end - w.start).toFixed(3)]));
  for (const w of allWords(after)) expect(+(w.end - w.start).toFixed(3)).toBeCloseTo(dur.get(w.id)!, 2);
}

describe('fitDurationOps', () => {
  it('fala 18,7 s + 10 s sem fala, alvo 20 s: encurta o trecho sem fala e mantém TODA a fala', () => {
    const p = project(speech(SENT), true);
    expect(projectDuration(p)).toBeCloseTo(28.7, 1);
    const f = fitDurationOps(p, 20);
    const after = applyOps(p, f.ops).project;
    expect(projectDuration(after)).toBeLessThanOrEqual(20.3);
    expect(projectDuration(after)).toBeGreaterThanOrEqual(19.5);
    expect(f.final).toBeCloseTo(projectDuration(after), 1);
    expect(allWords(after).map((w) => w.text)).toEqual(allWords(p).map((w) => w.text));
    wordsIntact(p, after);
    expect(f.said.join(' ')).toMatch(/sem fala/);
  });

  it('só fala (sem sobra), alvo menor: tira frases INTEIRAS, nunca a 1ª (gancho), sem cortar palavra', () => {
    const many = [...SENT.slice(0, 3), 'Agora coloca a cobertura de chocolate por cima do bolo ainda quente.', 'Espera esfriar um pouco antes de cortar as fatias.', SENT[3]];
    const segs = speech(many, 0.3, 0.6);
    const p = project(segs, false, segs[segs.length - 1].end + 0.3);
    const T = projectDuration(p);
    const target = Math.round(T * 0.6);
    const f = fitDurationOps(p, target);
    const after = applyOps(p, f.ops).project;
    const d = projectDuration(after);
    expect(d).toBeLessThanOrEqual(target + 0.3);
    expect(d).toBeGreaterThan(target - 4.5);
    wordsIntact(p, after);
    // cada frase ficou inteira ou saiu inteira
    const left = new Set(allWords(after).map((w) => w.id));
    for (const ph of phrasesOf(allWords(p))) {
      const kept = ph.words.filter((w) => left.has(w.id)).length;
      expect([0, ph.words.length]).toContain(kept);
    }
    // o gancho (1ª frase) ficou e começa o vídeo
    expect(allWords(after)[0].text).toBe('Oi');
    expect(f.said.join(' ')).toMatch(/frase/);
  });

  it('já cabe: não mexe', () => {
    const p = project(speech(SENT), false);
    expect(fitDurationOps(p, 25).ops).toEqual([]);
  });

  it('sem palavras (sem transcrição): usa os trechos de fala medidos e corta só fora deles', () => {
    const p = applyOps(createProject(), [
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(fala, 0), id: 'v1' } },
      { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(broll, 18.7), id: 'v2' } },
    ] as EditOp[]).project;
    const sp = [{ start: 0.3, end: 5.2 }, { start: 5.8, end: 11 }, { start: 11.6, end: 18.2 }];
    const f = fitDurationOps(p, 20, { speech: sp });
    const d = projectDuration(applyOps(p, f.ops).project);
    expect(d).toBeLessThanOrEqual(20.3);
    for (const op of f.ops) if (op.op === 'ripple_delete') expect(op.start).toBeGreaterThanOrEqual(18.2); // nada da fala sai
  });
});

describe('planFirstEdit respeita a duração pedida', () => {
  it('"Reels dinâmico de 20s": a edição fica com ~20 s (antes 26,5 s) e o texto diz o tamanho', () => {
    const p = project(speech(SENT), true);
    const assets = { fala, broll };
    const plan = planFirstEdit({ project: p, assets, brief: 'Reels dinâmico de 20s com legendas grandes, cortes rápidos e música animada', silencesByAsset: { fala: [], broll: [] } });
    const after = applyOps(p, plan.ops).project;
    expect(projectDuration(after)).toBeLessThanOrEqual(20.3);
    expect(projectDuration(after)).toBeGreaterThan(18);
    expect(plan.reply).toMatch(/20 s/);
    wordsIntact(p, after);
  });
});
