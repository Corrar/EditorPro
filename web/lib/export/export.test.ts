import { describe, expect, it } from 'vitest';
import type { MediaAsset, Project } from '../types';
import { createProject, makeAudioClip, makeTextClip, makeVideoClip } from '../defaults';
import { toSRT, toVTT, wrapCue } from './subtitles';
import { toFCPXML, rational, timebase, fcpColor } from './fcpxml';
import { exportSize, videoBitrate, safeFileName } from './index';

const asset = (id: string, kind: MediaAsset['kind'], duration: number): MediaAsset => ({
  id, kind, role: 'source', name: `${id} & cia.mp4`, mime: 'video/mp4', size: 1, duration, width: 1080, height: 1920,
});

function sample(): { p: Project; assets: Record<string, MediaAsset> } {
  const a = asset('a', 'video', 10);
  const m = { ...asset('m', 'audio', 30), name: 'musica.mp3' };
  const p0 = createProject({ name: 'Meu Vídeo' });
  const v1 = makeVideoClip(a, 0, { id: 'v1', duration: 3, in: 1 });
  const v2 = makeVideoClip(a, 4, { id: 'v2', duration: 2, in: 5, speed: 2, volume: 0.5 });
  const t1 = makeTextClip('Olá <mundo>', 0.5, 2, { id: 't1' });
  const mu = makeAudioClip(m, 0, { id: 'mu', duration: 6 });
  const p: Project = {
    ...p0,
    tracks: [
      { ...p0.tracks[0], clips: [v1, v2] },
      { ...p0.tracks[1], clips: [t1] },
      { ...p0.tracks[2], clips: [mu] },
    ],
    captions: {
      ...p0.captions,
      enabled: true,
      segments: [
        { id: 's2', start: 3.25, end: 5, text: 'segunda frase' },
        { id: 's1', start: 0, end: 1.5, text: 'Primeira frase da legenda' },
      ],
    },
  };
  return { p, assets: { a, m } };
}

/** verificador mínimo de XML bem-formado (tags balanceadas) */
function balanced(xml: string): boolean {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '');
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0 && !/<[^>]*<|&(?!amp;|lt;|gt;|quot;|apos;)/.test(body.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''));
}

describe('legendas SRT/VTT', () => {
  it('SRT ordenado com vírgula nos milissegundos', () => {
    const srt = toSRT(sample().p);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nPrimeira frase da legenda\n\n2\n00:00:03,250 --> 00:00:05,000\nsegunda frase\n');
  });
  it('VTT com cabeçalho e ponto', () => {
    const vtt = toVTT(sample().p);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.500')).toBe(true);
  });
  it('sem legendas usa os textos', () => {
    const { p } = sample();
    const srt = toSRT({ ...p, captions: { ...p.captions, segments: [] } });
    expect(srt).toContain('00:00:00,500 --> 00:00:02,500\nOlá <mundo>');
  });
  it('quebra cue longa em 2 linhas equilibradas', () => {
    const w = wrapCue('esta é uma legenda bem comprida que passa do limite de caracteres');
    expect(w.split('\n')).toHaveLength(2);
  });
});

describe('FCPXML', () => {
  it('tempo racional alinhado a quadro', () => {
    expect(rational(0, 30)).toBe('0s');
    expect(rational(1, 30)).toBe('1s');
    expect(rational(1.5, 30)).toBe('3/2s');
    expect(rational(0.1, 30)).toBe('1/10s');
    expect(rational(1 / 30, 30)).toBe('1/30s');
    expect(timebase(29.97)).toEqual({ num: 1001, den: 30000 });
    expect(rational(1001 / 30000, 29.97)).toBe('1001/30000s');
  });
  it('cores', () => {
    expect(fcpColor('#FFFFFF')).toBe('1.000 1.000 1.000 1');
    expect(fcpColor('#000')).toBe('0.000 0.000 0.000 1');
  });
  it('documento válido com spine, gaps, títulos e áudio conectado', () => {
    const { p, assets } = sample();
    const xml = toFCPXML(p, assets);
    expect(xml).toContain('<fcpxml version="1.9">');
    expect(balanced(xml)).toBe(true);
    expect(xml).toContain('<media-rep kind="original-media" src="file:///a%20&amp;%20cia.mp4"/>');
    // v1 na spine com in=1s
    expect(xml).toMatch(/<asset-clip ref="r2" name="[^"]*" offset="0s" start="1s" duration="3s"/);
    // vão entre 3s e 4s
    expect(xml).toContain('<gap name="Vão" offset="3s" start="3s" duration="1s">');
    // v2 com retime e volume
    expect(xml).toContain('<timeMap>');
    expect(xml).toContain('adjust-volume amount="-6.0dB"');
    // título escapado
    expect(xml).toContain('Olá &lt;mundo&gt;');
    expect(xml).toMatch(/<asset-clip ref="r3" lane="-1"/);
    expect(xml).toContain('duration="6s"');
  });
});

describe('opções', () => {
  it('tamanhos pares pelo lado menor', () => {
    expect(exportSize({ width: 1080, height: 1920 }, 'draft')).toEqual({ width: 540, height: 960 });
    expect(exportSize({ width: 1920, height: 1080 }, 'hd')).toEqual({ width: 1280, height: 720 });
    expect(exportSize({ width: 1080, height: 1350 }, 'full')).toEqual({ width: 1080, height: 1350 });
    expect(videoBitrate(1080, 1920, 30)).toBeGreaterThan(5e6);
  });
  it('nome de arquivo seguro', () => {
    expect(safeFileName('Meu Vídeo: top!', 'mp4')).toBe('Meu-Video-top.mp4');
  });
});

import { encodeWAV } from './wav';
import { exportFps } from './options';

describe('export ampliado', () => {
  it('1080p/4K ampliam, fps limitado', () => {
    expect(exportSize({ width: 1080, height: 1920 }, 'fhd')).toEqual({ width: 1080, height: 1920 });
    expect(exportSize({ width: 1080, height: 1920 }, '4k')).toEqual({ width: 2160, height: 3840 });
    expect(exportSize({ width: 1280, height: 720 }, 'fhd')).toEqual({ width: 1920, height: 1080 });
    expect(exportFps({ fps: 30 }, 60)).toBe(60);
    expect(exportFps({ fps: 30 })).toBe(30);
    expect(exportFps({ fps: 30 }, 240)).toBe(60);
  });
  it('WAV: cabeçalho RIFF e amostras 16-bit intercaladas', () => {
    const l = new Float32Array([0, 1, -1]);
    const r = new Float32Array([0.5, 0, 0]);
    const buf = encodeWAV([l, r], 48000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 3 * 2 * 2);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getInt16(46, true)).toBe(16383); // 0.5 * 32767 truncado
    expect(v.getInt16(48, true)).toBe(0x7fff);
    expect(v.getInt16(52, true)).toBe(-0x8000);
  });
});
