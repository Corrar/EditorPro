import { describe, expect, it } from 'vitest';
import type { CaptionSegment, Project, Track, VideoClip } from '../types';
import { DEFAULT_TRANSFORM } from '../types';
import { createProject } from '../defaults';
import { ease, interpolateTransform } from './easing';
import { sourceTime, trackLayers, fadeOpacity, activeMediaClips } from './timing';
import { resolveFilters, presetFilters, COLOR_PRESETS } from './filters';
import { transitionVisual } from './transitions';
import { chunkCaptions, chunkAt, segmentWords, wordStates, captionLook, normWord } from './captions';
import { layoutWords, splitText, textAnimState, fontPx } from './text';
import { clipGainAt, voiceAt, DUCK_GAIN } from './audio';

const vclip = (id: string, start: number, duration: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, type: 'video', assetId: 'a1', start, duration, in: 0, speed: 1, volume: 1,
  transform: { ...DEFAULT_TRANSFORM }, filters: [], ...extra,
});
const track = (clips: VideoClip[], extra: Partial<Track> = {}): Track => ({ id: 't', kind: 'video', name: 'V', clips, ...extra });

describe('easing / keyframes', () => {
  it('easings vão de 0 a 1', () => {
    for (const k of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(k, 0)).toBeCloseTo(0);
      expect(ease(k, 1)).toBeCloseTo(1);
    }
    expect(ease('easeIn', 0.5)).toBeLessThan(0.5);
    expect(ease('easeOut', 0.5)).toBeGreaterThan(0.5);
  });
  it('sem keyframes usa o transform base', () => {
    expect(interpolateTransform({ ...DEFAULT_TRANSFORM, scale: 1.2 }, undefined, 3).scale).toBe(1.2);
  });
  it('interpola por propriedade e segura nas pontas', () => {
    const kf = [
      { t: 0, transform: { scale: 1 } },
      { t: 2, transform: { scale: 1.2, x: 0.1 } },
    ];
    const base = DEFAULT_TRANSFORM;
    expect(interpolateTransform(base, kf, -1).scale).toBe(1);
    expect(interpolateTransform(base, kf, 1).scale).toBeCloseTo(1.1);
    expect(interpolateTransform(base, kf, 5).scale).toBeCloseTo(1.2);
    // x só tem um keyframe: valor constante
    expect(interpolateTransform(base, kf, 0).x).toBeCloseTo(0.1);
    expect(interpolateTransform(base, kf, 0).opacity).toBe(1);
  });
  it('easing do keyframe de destino é aplicado', () => {
    const kf = [{ t: 0, transform: { scale: 1 } }, { t: 1, transform: { scale: 2 }, easing: 'easeIn' as const }];
    expect(interpolateTransform(DEFAULT_TRANSFORM, kf, 0.5).scale).toBeCloseTo(1.125);
  });
});

describe('timing', () => {
  it('tempo de origem considera in e speed', () => {
    const c = vclip('c', 10, 5, { in: 2, speed: 2 });
    expect(sourceTime(c, 10)).toBe(2);
    expect(sourceTime(c, 11.5)).toBe(5);
  });
  it('fadeIn/fadeOut', () => {
    const c = vclip('c', 0, 4, { fadeIn: 1, fadeOut: 1 });
    expect(fadeOpacity(c, 0)).toBe(0);
    expect(fadeOpacity(c, 0.5)).toBeCloseTo(0.5);
    expect(fadeOpacity(c, 2)).toBe(1);
    expect(fadeOpacity(c, 3.5)).toBeCloseTo(0.5);
  });
  it('transição: clipe anterior continua como saída', () => {
    const a = vclip('a', 0, 3);
    const b = vclip('b', 3, 3, { transitionIn: { kind: 'crossfade', duration: 1 } });
    const tr = track([a, b]);
    expect(trackLayers(tr, 2).map((l) => l.clip.id)).toEqual(['a']);
    const mid = trackLayers(tr, 3.5);
    expect(mid.map((l) => [l.clip.id, l.transition?.role])).toEqual([['a', 'out'], ['b', 'in']]);
    expect(mid[0].transition?.progress).toBeCloseTo(0.5);
    expect(trackLayers(tr, 4.5).map((l) => l.clip.id)).toEqual(['b']);
  });
  it('sem clipe colado antes, a transição entra sozinha', () => {
    const a = vclip('a', 0, 2);
    const b = vclip('b', 3, 3, { transitionIn: { kind: 'fade', duration: 0.5 } });
    expect(trackLayers(track([a, b]), 3.2).map((l) => l.clip.id)).toEqual(['b']);
  });
  it('trilha oculta não desenha; mídia ativa inclui a saída', () => {
    const a = vclip('a', 0, 3);
    const b = vclip('b', 3, 3, { transitionIn: { kind: 'whip', duration: 0.4 } });
    expect(trackLayers(track([a, b], { hidden: true }), 1)).toEqual([]);
    const p: Project = { ...createProject(), tracks: [track([a, b])] };
    expect(activeMediaClips(p, 3.1).map((x) => x.clip.id)).toEqual(['a', 'b']);
  });
});

describe('filtros', () => {
  it('neutro = none', () => {
    expect(resolveFilters([], 'none').css).toBe('none');
  });
  it('soma ajustes do preset e do clipe', () => {
    const r = resolveFilters([{ kind: 'contrast', value: 0.1 }, { kind: 'blur', value: 0.5 }], 'cinematic');
    expect(r.css).toContain('contrast(1.28)');
    expect(r.css).toContain('blur(12px)');
    expect(r.vignette).toBeCloseTo(0.45);
    expect(r.temperature).toBeCloseTo(0.12);
  });
  it('todos os presets existem', () => {
    for (const k of Object.keys(COLOR_PRESETS)) expect(Array.isArray(presetFilters(k as never))).toBe(true);
    expect(resolveFilters([], 'bw').css).toContain('grayscale(1)');
  });
});

describe('transições', () => {
  it('crossfade: entrada sobe de 0 a 1, saída opaca', () => {
    expect(transitionVisual('crossfade', 0, 'in').opacity).toBeCloseTo(0);
    expect(transitionVisual('crossfade', 1, 'in').opacity).toBeCloseTo(1);
    expect(transitionVisual('crossfade', 0.5, 'out').opacity).toBe(1);
  });
  it('slide-left: entrada vem da direita', () => {
    expect(transitionVisual('slide-left', 0, 'in').dx).toBeCloseTo(1);
    expect(transitionVisual('slide-left', 1, 'in').dx).toBeCloseTo(0);
    expect(transitionVisual('slide-left', 1, 'out').dx).toBeCloseTo(-1);
  });
  it('flash atinge o pico no meio', () => {
    expect(transitionVisual('flash', 0.5, 'in').flash).toBeCloseTo(1);
    expect(transitionVisual('flash', 0, 'in').flash).toBeCloseTo(0);
  });
});

describe('legendas', () => {
  const seg = (id: string, start: number, end: number, text: string, extra: Partial<CaptionSegment> = {}): CaptionSegment =>
    ({ id, start, end, text, ...extra });

  it('distribui tempo proporcional sem words', () => {
    const w = segmentWords(seg('s', 0, 3, 'aa bbbb c'));
    expect(w).toHaveLength(3);
    expect(w[0].start).toBe(0);
    expect(w[2].end).toBeCloseTo(3);
    expect(w[1].end - w[1].start).toBeGreaterThan(w[0].end - w[0].start);
  });
  it('agrupa em blocos de maxWords contínuos', () => {
    const s = seg('s', 1, 4, 'um dois tres quatro cinco', {
      words: [
        { start: 1, end: 1.4, text: 'um' }, { start: 1.5, end: 2, text: 'dois' }, { start: 2.1, end: 2.5, text: 'tres' },
        { start: 2.8, end: 3.2, text: 'quatro' }, { start: 3.3, end: 3.8, text: 'cinco' },
      ],
    });
    const ch = chunkCaptions([s], 2);
    expect(ch.map((c) => c.words.map((w) => w.text).join(' '))).toEqual(['um dois', 'tres quatro', 'cinco']);
    expect(ch[0].end).toBe(2.1);
    expect(ch[2].end).toBe(4);
    expect(chunkAt(ch, 2.05)?.words[0].text).toBe('um');
    expect(chunkAt(ch, 4.1)).toBeNull();
  });
  it('quebra em fim de frase e marca ênfase sem acento/pontuação', () => {
    const ch = chunkCaptions([seg('s', 0, 4, 'Olá. Isso é INCRÍVEL!', { emphasis: ['incrivel'] })], 3);
    expect(ch[0].words.map((w) => w.text)).toEqual(['Olá.']);
    expect(ch[1].words.find((w) => w.text === 'INCRÍVEL!')?.emphasis).toBe(true);
    expect(normWord('“Café,”')).toBe('cafe');
  });
  it('karaokê destaca faladas + ativa; bold-pop só a ativa', () => {
    const [c] = chunkCaptions([seg('s', 0, 3, 'a b c', { words: [
      { start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }, { start: 2, end: 3, text: 'c' }] })], 3);
    expect(wordStates(c, 1.5, captionLook('karaoke')).map((s) => s.highlighted)).toEqual([true, true, false]);
    expect(wordStates(c, 1.5, captionLook('bold-pop')).map((s) => s.highlighted)).toEqual([false, true, false]);
    expect(wordStates(c, 1.5, captionLook('classic')).map((s) => s.highlighted)).toEqual([false, false, false]);
  });
});

describe('texto', () => {
  const measure = (s: string) => s.length * 10;
  it('quebra linhas pelo tamanho e por \\n', () => {
    const lines = layoutWords(['aaaa', 'bbbb', 'cc'], measure, 95);
    expect(lines.map((l) => l.words.map((w) => w.text))).toEqual([['aaaa', 'bbbb'], ['cc']]);
    expect(lines[0].width).toBe(90);
    const { words, breaks } = splitText('oi\ntudo bem');
    expect(words).toEqual(['oi', 'tudo', 'bem']);
    expect(layoutWords(words, measure, 1000, breaks)).toHaveLength(2);
  });
  it('animações', () => {
    expect(textAnimState('pop', 0, 2, 5).scale).toBeLessThan(1);
    expect(textAnimState('pop', 1, 2, 5).scale).toBeCloseTo(1);
    expect(textAnimState('fade', 0, 2, 5).opacity).toBe(0);
    expect(textAnimState('fade', 1.99, 2, 5).opacity).toBeLessThan(0.1);
    expect(textAnimState('typewriter', 0, 2, 10).visibleChars).toBe(0);
    expect(textAnimState('typewriter', 1.9, 2, 10).visibleChars).toBe(Infinity);
    expect(textAnimState('slide-up', 0, 2, 5).dy).toBeGreaterThan(0);
    expect(textAnimState('none', 0, 2, 5)).toMatchObject({ opacity: 1, scale: 1, dy: 0 });
    expect(fontPx(96, 960)).toBe(48);
  });
});

describe('áudio', () => {
  it('ganho com fades, mudo e ducking', () => {
    const p0 = createProject();
    const music = { id: 'm', type: 'audio' as const, assetId: 'x', start: 0, duration: 10, in: 0, speed: 1, volume: 0.8, fadeIn: 2, duckUnderVoice: true };
    const at: Track = { id: 'ta', kind: 'audio', name: 'A', clips: [music] };
    const p: Project = { ...p0, tracks: [at], captions: { ...p0.captions, segments: [{ id: 's', start: 5, end: 6, text: 'oi' }] } };
    expect(clipGainAt(p, at, music, 1)).toBeCloseTo(0.4);
    expect(clipGainAt(p, at, music, 3)).toBeCloseTo(0.8);
    expect(voiceAt(p, 5.5)).toBe(true);
    expect(clipGainAt(p, at, music, 5.5)).toBeCloseTo(0.8 * DUCK_GAIN);
    expect(clipGainAt(p, at, music, 10)).toBe(0);
    expect(clipGainAt(p, { ...at, muted: true }, music, 3)).toBe(0);
  });
});
