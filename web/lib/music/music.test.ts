import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';
import { MUSIC_CATALOG, musicTrack, trackStyle } from './catalog';
import { GENRE_LABELS } from './styles';
import { CEILING, beatMarkers, barMarkers, musicTiming, planSections, renderMusicPCM } from './engine';
import { lufs, peakOf } from './dsp';
import { beatMarkerOps, fitMusicDuration, musicClipOps } from './ops';
import { matchesMusic, pickMusic } from './pick';
import { chordOf, voiceChord, SCALES } from './theory';
import { musicWav } from './wav';
import { wavInfo } from '../library/sfx';
import { cacheKey, previewDuration } from './render';

const SR = 22050; // testes rápidos (caminho de taxa cheia); 44,1 kHz cobre o caminho de meia taxa

function hash(ch: Float32Array[]): number {
  let h = 0;
  for (const c of ch) for (let i = 0; i < c.length; i += 7) h = (h * 31 + Math.round(c[i] * 1e6)) | 0;
  return h;
}

const asset = (id: string, duration: number, kind: MediaAsset['kind'] = 'audio'): MediaAsset => ({
  id, kind, role: kind === 'audio' ? 'music' : 'source', name: `${id}.wav`, mime: kind === 'audio' ? 'audio/wav' : 'video/mp4', size: 1, duration, url: 'blob:x',
});

describe('catálogo', () => {
  it('tem ≥ 40 faixas em ≥ 10 gêneros, ids únicos e campos válidos', () => {
    expect(MUSIC_CATALOG.length).toBeGreaterThanOrEqual(40);
    const genres = new Set(MUSIC_CATALOG.map((t) => t.genre));
    expect(genres.size).toBeGreaterThanOrEqual(10);
    expect(genres.size).toBe(Object.keys(GENRE_LABELS).length);
    expect(new Set(MUSIC_CATALOG.map((t) => t.id)).size).toBe(MUSIC_CATALOG.length);
    expect(new Set(MUSIC_CATALOG.map((t) => t.seed)).size).toBe(MUSIC_CATALOG.length);
    for (const t of MUSIC_CATALOG) {
      expect(t.bpm).toBeGreaterThanOrEqual(60);
      expect(t.bpm).toBeLessThanOrEqual(150);
      expect(['baixa', 'media', 'alta']).toContain(t.energy);
      expect([30, 60]).toContain(t.duration);
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.key).toBeGreaterThanOrEqual(0);
      expect(t.key).toBeLessThan(12);
      const st = trackStyle(t);
      expect(st.progA.length).toBeGreaterThan(0);
    }
  });
});

describe('teoria', () => {
  it('voiceChord devolve só notas do acorde dentro da faixa', () => {
    const ch = chordOf('major', 4, 4); // V7
    const v = voiceChord(ch, 48, 53, 74);
    expect(v.length).toBe(4);
    const pcs = ch.semis.map((s) => (48 + s) % 12);
    for (const m of v) {
      expect(pcs).toContain(m % 12);
      expect(m).toBeGreaterThanOrEqual(53);
      expect(m).toBeLessThanOrEqual(78);
    }
    expect(SCALES.minor[2]).toBe(3);
  });
});

describe('forma e tempo', () => {
  it('compassos inteiros cabem exatamente na duração e o BPM fica perto do original', () => {
    for (const t of MUSIC_CATALOG) {
      for (const d of [7.5, 30, 47.3, 60]) {
        const tm = musicTiming(t, d);
        expect(Math.abs(tm.bars * tm.barLen - d)).toBeLessThan(1e-9);
        if (d >= 15) expect(Math.abs(tm.bpm / t.bpm - 1)).toBeLessThan(0.1);
        expect(tm.sections.length).toBe(tm.bars);
        expect(tm.sections[tm.bars - 1]).toBe('end');
      }
    }
  });

  it('seções: intro, A/B alternando e final; loop sem intro/final', () => {
    const s = planSections(15, false, 2);
    expect(s[0]).toBe('intro');
    expect(s[s.length - 1]).toBe('end');
    expect(s[s.length - 2]).toBe('B');
    expect(s).toContain('A');
    const l = planSections(16, true, 2);
    expect(l).not.toContain('intro');
    expect(l).not.toContain('end');
    expect(l.filter((x) => x === 'A').length).toBe(8);
  });

  it('beatMarkers coerente com o BPM (espaçamento 60/bpm, 4 por compasso)', () => {
    const t = musicTrack('pulso-noturno')!;
    const d = 30;
    const tm = musicTiming(t, d);
    const beats = beatMarkers(t.id, d);
    expect(beats.length).toBe(tm.bars * 4);
    expect(beats[0]).toBe(0);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeCloseTo(60 / tm.bpm, 3);
    expect(beats[beats.length - 1]).toBeLessThan(d);
    expect(barMarkers(t.id, d).length).toBe(tm.bars);
    // loop: múltiplo de 4 compassos quando cabe
    expect(musicTiming(t, 30, { loop: true }).bars % 4).toBe(0);
  });
});

describe('render', () => {
  it('determinístico pela semente (mesma faixa = mesmo PCM; faixas diferentes diferem)', () => {
    const a = renderMusicPCM('cafe-da-tarde', { duration: 6, sampleRate: SR });
    const b = renderMusicPCM('cafe-da-tarde', { duration: 6, sampleRate: SR });
    expect(hash(a)).toBe(hash(b));
    expect(a[0].every((v, i) => v === b[0][i])).toBe(true);
    const c = renderMusicPCM('domingo-lento', { duration: 6, sampleRate: SR });
    expect(hash(c)).not.toBe(hash(a));
  });

  it('duração exata em amostras', () => {
    for (const d of [3.3, 10, 17.77]) {
      const ch = renderMusicPCM('sol-de-verao', { duration: d, sampleRate: SR });
      expect(ch.length).toBe(2);
      expect(ch[0].length).toBe(Math.round(d * SR));
      expect(ch[1].length).toBe(Math.round(d * SR));
    }
    const wav = musicWav('nevoa', { duration: 4, sampleRate: SR });
    const info = wavInfo(wav)!;
    expect(info.channels).toBe(2);
    expect(info.duration).toBeCloseTo(4, 3);
  });

  it('um de cada gênero: sem clipping (≤ −1 dBFS), sem DC, loudness ~ −14 LUFS e sem NaN', () => {
    const seen = new Set<string>();
    for (const t of MUSIC_CATALOG) {
      if (seen.has(t.genre)) continue;
      seen.add(t.genre);
      const ch = renderMusicPCM(t, { duration: 12, sampleRate: SR });
      const pk = peakOf(ch);
      expect(Number.isFinite(pk)).toBe(true);
      expect(pk).toBeLessThanOrEqual(CEILING + 1e-6);
      expect(20 * Math.log10(pk)).toBeLessThanOrEqual(-1);
      let dc = 0;
      for (const c of ch) for (let i = 0; i < c.length; i++) dc += c[i];
      expect(Math.abs(dc / (ch[0].length * 2))).toBeLessThan(2e-3);
      const L = lufs(ch, SR);
      expect(L).toBeGreaterThan(-16.5);
      expect(L).toBeLessThan(-12.5);
    }
  });

  it('44,1 kHz (meia taxa + reamostragem): pico e loudness dentro da meta', () => {
    const ch = renderMusicPCM('rua-de-concreto', { duration: 10, sampleRate: 44100 });
    expect(ch[0].length).toBe(441000);
    expect(peakOf(ch)).toBeLessThanOrEqual(CEILING + 1e-6);
    expect(Math.abs(lufs(ch, 44100) + 14)).toBeLessThan(1.5);
  });

  it('final com fade: começa e termina em silêncio (sem estalo)', () => {
    const ch = renderMusicPCM('batalha-final', { duration: 9, sampleRate: SR });
    for (const c of ch) {
      expect(Math.abs(c[0])).toBeLessThan(1e-3);
      expect(c[c.length - 1]).toBe(0);
      let tail = 0;
      for (let i = c.length - 200; i < c.length; i++) tail = Math.max(tail, Math.abs(c[i]));
      expect(tail).toBeLessThan(0.01);
    }
  });

  it('loop sem emenda: a passagem fim→começo não tem salto maior que o normal do sinal', () => {
    for (const id of ['pulso-noturno', 'cafe-da-tarde', 'nevoa', 'batalha-final']) {
      const ch = renderMusicPCM(id, { duration: 8, sampleRate: SR, loop: true });
      for (const c of ch) {
        const n = c.length;
        const diffs: number[] = [];
        for (let i = 1; i < n; i++) diffs.push(Math.abs(c[i] - c[i - 1]));
        diffs.sort((a, b) => a - b);
        const p999 = diffs[Math.floor(diffs.length * 0.999)];
        const jump = Math.abs(c[0] - c[n - 1]);
        expect(jump).toBeLessThanOrEqual(p999);
        // e a energia não despenca na borda (sem fade escondido)
        let a = 0, b = 0;
        for (let i = 0; i < 2000; i++) { a += Math.abs(c[i]); b += Math.abs(c[n - 1 - i]); }
        expect(a).toBeGreaterThan(0.5);
        expect(b).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('projeto', () => {
  it('fitMusicDuration vai até o fim do vídeo (ou 30 s sem vídeo)', () => {
    const p0 = createProject();
    expect(fitMusicDuration(p0, 0)).toBe(30);
    const v = asset('vid', 12, 'video');
    const { project } = applyOps(p0, [{ op: 'add_clip', trackId: 'tv', clip: makeVideoClip(v, 0, { id: 'c1', duration: 12 }) }]);
    expect(fitMusicDuration(project, 2)).toBe(10);
    expect(fitMusicDuration(project, 0)).toBe(12);
  });

  it('musicClipOps: cria a trilha "Música", põe o clipe no cursor com fade/ducking e reaproveita a trilha livre', () => {
    const p0 = createProject();
    const a = asset('m1', 20);
    const ops = musicClipOps(p0, a, 1.5, { duration: 20, volume: 0.7, fadeIn: 0.5, fadeOut: 2 });
    // o projeto novo já tem a trilha "Música" vazia → usa ela
    expect(ops.length).toBe(1);
    expect(ops[0].op === 'add_clip' && ops[0].trackId).toBe('track_audio_1');
    // sem trilha de música → cria
    const bare = { ...p0, tracks: p0.tracks.filter((t) => t.kind !== 'audio') };
    const opsNew = musicClipOps(bare, a, 0);
    expect(opsNew[0].op === 'add_track' && opsNew[0].track.name).toBe('Música');
    const { project, errors } = applyOps(p0, ops);
    expect(errors).toEqual([]);
    const tr = project.tracks.find((t) => t.name === 'Música')!;
    expect(tr.kind).toBe('audio');
    const c = tr.clips[0];
    expect(c.type).toBe('audio');
    if (c.type !== 'audio') throw new Error();
    expect(c.start).toBe(1.5);
    expect(c.duration).toBe(20);
    expect(c.volume).toBe(0.7);
    expect(c.fadeIn).toBe(0.5);
    expect(c.fadeOut).toBe(2);
    expect(c.duckUnderVoice).toBe(true);
    expect(c.assetId).toBe('m1');
    // mesmo trecho ocupado → nova trilha "Música 2"
    const ops2 = musicClipOps(project, asset('m2', 10), 5);
    expect(ops2[0].op).toBe('add_track');
    if (ops2[0].op === 'add_track') expect(ops2[0].track.name).toBe('Música 2');
    // depois do fim → reaproveita a trilha
    const ops3 = musicClipOps(project, asset('m3', 10), 30);
    expect(ops3.length).toBe(1);
    expect(ops3[0].op === 'add_clip' && ops3[0].trackId).toBe(tr.id);
    // duração limitada ao asset
    const ops4 = musicClipOps(project, asset('m4', 8), 40, { duration: 30, duck: false });
    const add = ops4.find((o) => o.op === 'add_clip');
    expect(add && add.op === 'add_clip' && add.clip.duration).toBe(8);
    expect(add && add.op === 'add_clip' && add.clip.type === 'audio' && add.clip.duckUnderVoice).toBe(false);
  });

  it('beatMarkerOps cria marcadores kind "beat" deslocados pelo início do clipe, sem duplicar', () => {
    const p0 = createProject();
    const beats = beatMarkers('pulso-noturno', 8);
    const ops = beatMarkerOps(p0, beats, 2);
    expect(ops.length).toBe(beats.length);
    const { project } = applyOps(p0, ops);
    expect(project.markers?.every((m) => m.kind === 'beat')).toBe(true);
    expect(project.markers?.[0].t).toBe(2);
    expect(beatMarkerOps(project, beats, 2).length).toBe(0);
    expect(beatMarkerOps(p0, beats, 0, { every: 4 }).length).toBe(Math.ceil(beats.length / 4));
  });
});

describe('IA e busca', () => {
  it('pickMusic escolhe pelo humor/energia e sempre devolve id válido', () => {
    const anim = musicTrack(pickMusic({ mood: 'música animada' }))!;
    expect(anim.energy).toBe('alta');
    expect(['feliz', 'divertida', 'energetica']).toContain(anim.mood);
    const calm = musicTrack(pickMusic({ mood: 'calma', duration: 40 }))!;
    expect(calm.energy).toBe('baixa');
    expect(['ambiente', 'lofi', 'acustica']).toContain(calm.genre);
    expect(musicTrack(pickMusic({ mood: 'épica' }))!.genre).toBe('cinematica');
    expect(musicTrack(pickMusic({ mood: 'suspense', energy: 'baixa' }))!.genre).toBe('suspense');
    expect(musicTrack(pickMusic({ mood: 'romântica para casamento' }))!.genre).toBe('romantica');
    expect(musicTrack(pickMusic({ mood: 'lo-fi para estudar' }))!.genre).toBe('lofi');
    expect(musicTrack(pickMusic({ mood: 'qualquer coisa estranha xyz' }))).toBeTruthy();
    expect(musicTrack(pickMusic())).toBeTruthy();
    const first = pickMusic({ mood: 'animada' });
    expect(pickMusic({ mood: 'animada', exclude: [first] })).not.toBe(first);
  });

  it('matchesMusic busca sem acento em nome, gênero, humor e tags', () => {
    const t = musicTrack('cafe-da-tarde')!;
    expect(matchesMusic(t, 'cafe')).toBe(true);
    expect(matchesMusic(t, 'lofi')).toBe(true);
    expect(matchesMusic(t, 'relaxante')).toBe(true);
    expect(matchesMusic(t, 'trap')).toBe(false);
  });

  it('cacheKey e prévia', () => {
    expect(cacheKey('nevoa', { duration: 30 })).not.toBe(cacheKey('nevoa', { duration: 31 }));
    expect(cacheKey('nevoa', { duration: 30, loop: true })).not.toBe(cacheKey('nevoa', { duration: 30 }));
    for (const t of MUSIC_CATALOG) expect(previewDuration(t)).toBeLessThanOrEqual(16.5);
  });
});
