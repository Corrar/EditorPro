/* legendas antigas falsas (texto do pedido) x transcrição real (plano §1.1) */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyOps } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset, Project } from '../types';
import { demoCaptions } from './demo';
import { captionsAreSpeech, captionsNeedTranscription, isLegacyFakeCaptions } from './legacyCaptions';
import { chunksToCaptions } from './whisper';
import { summarizeProject } from './summary';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'fala.mp4', mime: 'video/mp4', size: 1, duration: 20 };
function withVideo(brief: string): Project {
  const p0 = { ...createProject(), brief };
  return applyOps(p0, [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0, { duration: 20 }), id: 'c1' } }]).project;
}
const SPEECH = { a1: [{ start: 0.5, end: 4.2 }, { start: 4.8, end: 9.6 }, { start: 10.4, end: 15 }, { start: 15.6, end: 19.5 }] };

describe('isLegacyFakeCaptions', () => {
  it('reconhece demoCaptions feitas com o texto do pedido', () => {
    const p = withVideo('Faça um vídeo dinâmico para o TikTok com legendas amarelas e cortes rápidos sobre a minha padaria');
    const segs = demoCaptions(p, SPEECH, p.brief);
    const fake = applyOps(p, [{ op: 'set_captions', segments: segs }]).project;
    expect(isLegacyFakeCaptions(fake)).toBe(true);
    expect(captionsNeedTranscription(fake)).toBe(true);
    expect(captionsAreSpeech(fake)).toBe(false);
    expect((summarizeProject(fake, { a1: src }) as { captions: { transcribed: boolean } }).captions.transcribed).toBe(false);
  });

  it('reconhece a frase de exemplo fixa (pedido curto)', () => {
    const p = withVideo('vídeo');
    const fake = applyOps(p, [{ op: 'set_captions', segments: demoCaptions(p, SPEECH, p.brief) }]).project;
    expect(isLegacyFakeCaptions(fake)).toBe(true);
  });

  it('pega o padrão de tempo (palavras proporcionais, coladas) mesmo se o pedido mudou depois', () => {
    const p = withVideo('Legenda de padaria artesanal com pão quentinho todo dia de manhã cedo');
    const fake = applyOps(p, [{ op: 'set_captions', segments: demoCaptions(p, SPEECH, p.brief) }]).project;
    expect(isLegacyFakeCaptions({ ...fake, brief: 'outra coisa completamente diferente agora' })).toBe(true);
  });

  it('transcrição real do Whisper (fixture medida) NÃO é falsa', () => {
    const FX = path.resolve(__dirname, '../../../docs/fixtures/legendas-modelo/whisper-results/whisper-base_timestamped__q8__app.json');
    if (!fs.existsSync(FX)) return;
    const clips = JSON.parse(fs.readFileSync(FX, 'utf8')).clips as { id: string; duration: number; words: { text: string; timestamp: [number, number] }[] }[];
    for (const c of clips.filter((x) => !x.id.startsWith('N_'))) {
      const p = withVideo('Hoje eu vou mostrar como eu organizo a minha rotina de trabalho em casa');
      const real = applyOps(p, [{ op: 'set_captions', segments: chunksToCaptions(c.words, undefined, c.duration) }]).project;
      expect(isLegacyFakeCaptions(real), c.id).toBe(false);
      expect(captionsAreSpeech(real)).toBe(true);
    }
  });

  it('com source definido nunca é "antiga"', () => {
    const p = withVideo('Faça um vídeo dinâmico para o TikTok com legendas amarelas');
    const segs = demoCaptions(p, SPEECH, p.brief);
    const marked = applyOps(p, [{ op: 'set_captions', segments: segs, source: 'manual' }]).project;
    expect(isLegacyFakeCaptions(marked)).toBe(false);
    expect(captionsAreSpeech(marked)).toBe(false);
    expect(captionsNeedTranscription(marked)).toBe(false);
  });

  it('uma legenda manual curta (sem source) não é confundida', () => {
    const p = withVideo('vídeo da padaria');
    const one = applyOps(p, [{ op: 'set_captions', segments: [{ id: 's1', start: 1, end: 3, text: 'Nova legenda', words: [{ start: 1, end: 2, text: 'Nova' }, { start: 2, end: 3, text: 'legenda' }] }] }]).project;
    expect(isLegacyFakeCaptions(one)).toBe(false);
  });
});
