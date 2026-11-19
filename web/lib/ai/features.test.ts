import { describe, expect, it } from 'vitest';
import { allWords, applyOps, findClip, projectDuration, type EditOp } from '../ops';
import { createProject, makeAudioClip, makeVideoClip } from '../defaults';
import type { AdjustmentClip, CaptionSegment, MediaAsset, Project, StickerClip, VideoClip } from '../types';
import { sanitizeOps } from './validate';
import { summarizeProject } from './summary';
import {
  assignWordIds, beatMarkerOps, beatSyncOps, chapterOps, fillerOps, highlightOps, hookFromTranscript, isFiller, reframeKeyframes,
  reframeOps, reframeX, timelineBeats,
} from './features';
import { chatIntent, rangeFromText } from './demo';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'bruto.mp4', mime: 'video/mp4', size: 1, duration: 20, width: 1920, height: 1080 };
const music: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'trilha.mp3', mime: 'audio/mpeg', size: 1, duration: 60, beats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] };
const assets = { a1: src, m1: music };

/** legendas a partir de [texto, início, fim] por palavra */
function caps(words: [string, number, number][], perSeg = 4): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  for (let i = 0; i < words.length; i += perSeg) {
    const ws = words.slice(i, i + perSeg).map(([text, start, end]) => ({ text, start, end }));
    segs.push({ id: `s${i}`, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.text).join(' '), words: ws });
  }
  return segs;
}

function base(words?: [string, number, number][]): Project {
  const p = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' } }]).project;
  if (!words) return p;
  const v = sanitizeOps([{ op: 'set_captions', segments: caps(words) }], p, assets);
  return v.project;
}

const SPEECH: [string, number, number][] = [
  ['Olá', 0.5, 0.8], ['pessoal,', 0.8, 1.2], ['né,', 1.3, 1.6], ['hoje', 2.0, 2.3], ['eu', 2.3, 2.4], ['vou', 2.4, 2.6], ['mostrar', 2.6, 3.0],
  ['éé', 3.4, 4.0], ['tipo,', 4.3, 4.6], ['assim', 4.6, 4.9], ['três', 5.2, 5.5], ['dicas', 5.5, 5.9], ['que', 5.9, 6.0], ['é', 6.0, 6.1],
  ['muito', 6.1, 6.4], ['importante!', 6.4, 7.0], ['hum', 8.0, 8.5], ['primeiro', 9.0, 9.5], ['preço', 9.5, 10.0], ['baixo.', 10.0, 10.5],
];

describe('ids de palavra', () => {
  it('set_captions numera as palavras w00001… e o resumo manda a transcrição com ids', () => {
    const p = base(SPEECH);
    const words = allWords(p);
    expect(words[0].id).toBe('w00001');
    expect(words[19].id).toBe('w00020');
    const s = JSON.stringify(summarizeProject(p, assets));
    expect(s).toContain('[w00003 1.30-1.60] né,');
  });

  it('assignWordIds é sequencial entre segmentos', () => {
    const segs = assignWordIds(caps(SPEECH.slice(0, 6), 3));
    expect(segs[1].words![0].id).toBe('w00004');
  });
});

describe('vícios de linguagem', () => {
  it('"é" verbo fica; "éé", "né", "tipo, assim" e "hum" saem', () => {
    const p = base(SPEECH);
    const w = allWords(p);
    expect(isFiller(w, 13)).toBe(false); // "é" no meio da frase
    const { ops, count } = fillerOps(p);
    expect(count).toBe(5);
    expect(ops.every((o) => o.op === 'remove_words')).toBe(true);
    const v = sanitizeOps(ops, p, assets);
    expect(v.dropped).toEqual([]);
    // (o ripple corta as palavras; o texto do segmento é recalculado pelo engine a partir de `words`)
    const text = allWords(v.project).map((w) => w.text).join(' ');
    expect(text).not.toMatch(/né|éé|tipo|hum/);
    expect(text).toContain('que é muito importante!');
    expect(projectDuration(v.project)).toBeLessThan(20);
  });

  it('funciona pelo chat do modo demo', () => {
    const r = chatIntent('corta os vícios de linguagem', { project: base(SPEECH), assets });
    expect(r.ops.length).toBe(3); // "éé tipo, assim" é uma sequência só
    expect(r.reply).toMatch(/vícios/);
  });
});

describe('destaques, capítulos e gancho', () => {
  it('highlightOps mantém ~N s com as frases mais fortes, em ordem', () => {
    const p = base(SPEECH);
    const h = highlightOps(p, 5);
    expect(h.ops.length).toBeGreaterThan(0);
    const after = sanitizeOps(h.ops, p, assets).project;
    expect(projectDuration(after)).toBeLessThan(9);
    expect(allWords(after).map((w) => w.text).join(' ')).toContain('importante!');
  });

  it('chapterOps cria marcadores de capítulo começando em 0', () => {
    const ops = chapterOps(base(SPEECH), 3);
    expect(ops.length).toBeGreaterThanOrEqual(2);
    const m = (ops[0] as Extract<EditOp, { op: 'add_marker' }>).marker;
    expect(m).toMatchObject({ kind: 'chapter', t: 0 });
    expect(m.label).toMatch(/^1\. Olá/);
  });

  it('hookFromTranscript escolhe uma frase forte', () => {
    expect(hookFromTranscript(base(SPEECH))).toBeTruthy();
  });
});

describe('batidas', () => {
  const withMusic = () => applyOps(base(), [{ op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(music, 0, { duration: 20 }), id: 'mus', in: 2 } }]).project;

  it('timelineBeats converte batidas da mídia p/ timeline (in/start)', () => {
    const b = timelineBeats(withMusic(), assets);
    expect(b[0]).toBe(1); // batida 3 s da mídia com in=2
  });

  it('beatSyncOps corta o vídeo nas batidas (≥ minGap) com zoom alternado', () => {
    const p = withMusic();
    const { ops, cuts } = beatSyncOps(p, assets, 2);
    expect(cuts).toBeGreaterThan(5);
    const v = sanitizeOps(ops, p, assets);
    expect(v.dropped).toEqual([]);
    const clips = v.project.tracks[0].clips as VideoClip[];
    expect(clips.length).toBe(cuts + 1);
    expect(clips[1].transform.scale).toBe(1.12);
  });

  it('beatMarkerOps e pedido do chat "marca as batidas"', () => {
    expect(beatMarkerOps(withMusic(), assets).length).toBe(17);
    const r = chatIntent('marca as batidas da música', { project: withMusic(), assets });
    expect(r.ops.every((o) => o.op === 'add_marker')).toBe(true);
  });
});

describe('auto-reframe', () => {
  it('reframeX centraliza o assunto sem mostrar bordas', () => {
    const src = 16 / 9, out = 9 / 16;
    expect(reframeX(0.5, src, out)).toBe(0);
    const x = reframeX(0.8, src, out);
    expect(x).toBeLessThan(0); // assunto à direita -> imagem vai p/ a esquerda
    expect(Math.abs(reframeX(1, src, out))).toBeLessThanOrEqual(((src / out) - 1) / 2 + 1e-9);
  });

  it('reframeOps gera keyframes de x para mídia mais larga que o quadro', () => {
    const p = base();
    const ops = reframeOps(p, assets, { a1: [{ t: 0, x: 0.3 }, { t: 5, x: 0.35 }, { t: 10, x: 0.7 }, { t: 15, x: 0.72 }] });
    expect(ops).toHaveLength(1);
    const kf = (ops[0] as Extract<EditOp, { op: 'update_clip' }>).patch.keyframes as { t: number; transform: { x: number } }[];
    expect(kf[0].transform.x).toBeGreaterThan(0);
    expect(kf[kf.length - 1].transform.x).toBeLessThan(0);
    expect(sanitizeOps(ops, p, assets).dropped).toEqual([]);
    expect(reframeKeyframes(p.tracks[0].clips[0] as VideoClip, [], 16 / 9, 9 / 16)).toEqual([{ t: 0, transform: { x: 0 } }]);
  });
});

describe('demo: comandos estilo CapCut', () => {
  it('efeito VHS nos primeiros 3 s vira camada de ajuste', () => {
    const p = base();
    const r = chatIntent('coloca efeito VHS nos primeiros 3 segundos', { project: p, assets });
    const after = sanitizeOps(r.ops, p, assets);
    expect(after.dropped).toEqual([]);
    const adj = after.project.tracks.find((t) => t.kind === 'effect')!.clips[0] as AdjustmentClip;
    expect(adj).toMatchObject({ type: 'adjustment', start: 0, duration: 3 });
    expect(adj.effects![0].kind).toBe('vhs');
    expect(projectDuration(after.project)).toBe(20); // nada foi cortado
  });

  it('transição de giro, câmera lenta, curva herói, voz de robô, remover fundo', () => {
    let p = applyOps(base(), [{ op: 'split_clip', clipId: 'c1', at: 10, newId: 'c2' }]).project;
    const run = (txt: string) => { const r = chatIntent(txt, { project: p, assets }); p = sanitizeOps(r.ops, p, assets).project; return r; };
    run('troca a transição para uma de giro');
    expect((findClip(p, 'c2')!.clip as VideoClip).transitionIn?.kind).toBe('spin');
    run('acelera em curva herói');
    expect((findClip(p, 'c1')!.clip as VideoClip).speedPreset).toBe('hero');
    expect((findClip(p, 'c1')!.clip as VideoClip).speed).toBe(1);
    run('deixa em câmera lenta');
    expect((findClip(p, 'c1')!.clip as VideoClip).speed).toBe(0.5);
    run('coloca voz de robô');
    expect((findClip(p, 'c1')!.clip as VideoClip).audioEffects?.[0].kind).toBe('robot');
    run('remove o fundo');
    expect((findClip(p, 'c2')!.clip as VideoClip).removeBackground).toBe(true);
  });

  it('emoji de fogo no ponto apontado', () => {
    const p = base();
    const r = chatIntent('adiciona emoji de fogo aqui', { project: p, assets, target: { label: 'ponto', point: { x: 0.8, y: 0.2, t: 4 } } });
    const after = sanitizeOps(r.ops, p, assets).project;
    const st = after.tracks.find((t) => t.kind === 'overlay')!.clips[0] as StickerClip;
    expect(st).toMatchObject({ type: 'sticker', emoji: '🔥', start: 4 });
    expect(st.transform.x).toBeCloseTo(0.3);
  });

  it('contexto de clipe restringe a mudança', () => {
    const p = applyOps(base(), [{ op: 'split_clip', clipId: 'c1', at: 10, newId: 'c2' }]).project;
    const r = chatIntent('deixa preto e branco', { project: p, assets, target: { label: 'Clipe 2', clipIds: ['c2'] } });
    const after = sanitizeOps(r.ops, p, assets).project;
    expect((findClip(after, 'c1')!.clip as VideoClip).colorPreset).toBeUndefined();
    expect((findClip(after, 'c2')!.clip as VideoClip).colorPreset).toBe('bw');
  });

  it('câmera lenta só no clipe apontado empurra os seguintes', () => {
    const p = applyOps(base(), [{ op: 'split_clip', clipId: 'c1', at: 10, newId: 'c2' }]).project;
    const r = chatIntent('deixa em câmera lenta', { project: p, assets, target: { label: 'Clipe 1', clipIds: ['c1'] } });
    const after = sanitizeOps(r.ops, p, assets);
    expect(after.dropped).toEqual([]);
    expect((findClip(after.project, 'c1')!.clip as VideoClip).speed).toBe(0.5);
    expect((findClip(after.project, 'c2')!.clip as VideoClip)).toMatchObject({ speed: 1, start: 20 });
    expect(projectDuration(after.project)).toBe(30);
  });

  it('rangeFromText', () => {
    expect(rangeFromText('nos ultimos 2 s', 10)).toEqual({ start: 8, end: 10 });
    expect(rangeFromText('de 4 a 9 segundos', 20)).toEqual({ start: 4, end: 9 });
  });
});
