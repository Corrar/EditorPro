import { describe, expect, it } from 'vitest';
import { asksForMusic, backgroundMusicClips, catalogMusicVolume, chatMusicRequest, needsCatalogMusic, userMusic } from './catalogMusic';
import { createProject, makeAudioClip } from '../defaults';
import { applyOp } from '../ops';
import type { MediaAsset } from '../types';

const lib: MediaAsset = { id: 'm1', kind: 'audio', role: 'music', name: 'Sol de Verão.wav', mime: 'audio/wav', size: 1, duration: 30, library: true };
const sfx: MediaAsset = { id: 's1', kind: 'audio', role: 'music', name: 'Whoosh.wav', mime: 'audio/wav', size: 1, duration: 0.8, library: true };
const mine: MediaAsset = { id: 'u1', kind: 'audio', role: 'music', name: 'minha.mp3', mime: 'audio/mpeg', size: 1, duration: 60 };

describe('catálogo de músicas na IA', () => {
  it('entende pedido de música e "sem música"', () => {
    expect(asksForMusic('Vídeo dinâmico com música animada')).toBe(true);
    expect(asksForMusic('trilha épica no fundo')).toBe(true);
    expect(asksForMusic('corte os silêncios, sem música')).toBe(false);
    expect(asksForMusic('legendas grandes')).toBe(false);
  });

  it('no chat separa pôr e trocar', () => {
    expect(chatMusicRequest('coloca uma música calma')).toBe('add');
    expect(chatMusicRequest('Põe uma trilha de suspense')).toBe('add');
    expect(chatMusicRequest('troca a música por outra mais animada')).toBe('swap');
    expect(chatMusicRequest('abaixa o volume da música')).toBeNull();
    expect(chatMusicRequest('tira a legenda')).toBeNull();
  });

  it('só busca no catálogo sem música do usuário e sem trilha na timeline', () => {
    const p = createProject();
    expect(needsCatalogMusic('com música', p, {})).toBe(true);
    expect(needsCatalogMusic('com música', p, { u1: mine })).toBe(false);
    expect(userMusic({ m1: lib, u1: mine }).map((a) => a.id)).toEqual(['u1']);
    // efeito sonoro curto não conta como trilha
    const withSfx = applyOp(p, { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(sfx, 0), id: 'c1', duration: 0.8 } });
    expect(backgroundMusicClips(withSfx, { s1: sfx })).toHaveLength(0);
    expect(needsCatalogMusic('com música', withSfx, { s1: sfx })).toBe(true);
    const withMusic = applyOp(p, { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(lib, 0), id: 'c2', duration: 30 } });
    expect(needsCatalogMusic('com música', withMusic, { m1: lib })).toBe(false);
  });

  it('volume baixo com fala, cheio sem fala', () => {
    const p = createProject();
    expect(catalogMusicVolume(p)).toBe(0.75);
    const falado = { ...p, captions: { ...p.captions, segments: [{ id: 's', start: 0, end: 1, text: 'oi' }] } };
    expect(catalogMusicVolume(falado as typeof p)).toBe(0.3);
  });
});
