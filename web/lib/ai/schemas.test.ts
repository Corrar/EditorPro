import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EditOpSchema, EditResponseSchema, StyleSchema } from './schemas';
import { OP_KINDS, sanitizeOps } from './validate';
import { slimAssets, summarizeProject } from './summary';
import { applyOps } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';
import { splitPoints, wordsToSegments } from './words';
import { fitBudget, framesFromThumbnails, planSamples } from './frames';
import { sanitizeStyleProfile } from './sanitize';

type S = Record<string, any>;
const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 12, thumbnails: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'], waveform: [0.1], url: 'blob:x' };

describe('schemas (zod -> saída estruturada)', () => {
  it('EditOpSchema cobre todas as EditOp e exige explain', () => {
    const js = z.toJSONSchema(EditOpSchema) as S;
    expect([...js.properties.op.enum].sort()).toEqual([...OP_KINDS, 'apply_template', 'apply_caption_preset', 'apply_look', 'add_sfx', 'add_music'].sort());
    expect(js.required).toEqual(expect.arrayContaining(['op', 'explain']));
  });

  it('JSON Schemas gerados são serializáveis e com required válidos', () => {
    for (const s of [EditResponseSchema, StyleSchema]) {
      const js = JSON.parse(JSON.stringify(z.toJSONSchema(s))) as S;
      const walk = (n: S) => {
        if (n && typeof n === 'object') {
          if (n.type === 'object' && n.required) for (const r of n.required) expect(Object.keys(n.properties)).toContain(r);
          Object.values(n).forEach((x) => walk(x as S));
        }
      };
      walk(js);
    }
  });

  it('uma resposta no formato do schema passa pelo validate', () => {
    const p = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'c1' } }]).project;
    const raw = EditResponseSchema.parse({
      reply: 'ok',
      ops: [
        { op: 'ripple_delete', start: 2, end: 3, explain: 'Cortando' },
        { op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'warm', transitionIn: null }, explain: 'Cor' },
        { op: 'add_clip', trackId: 'track_text_1', clip: { type: 'text', text: 'Oi', start: 0, duration: 2 }, explain: 'Título' },
      ],
    });
    const r = sanitizeOps(raw.ops, p, { a1: asset });
    expect(r.dropped).toEqual([]);
    expect(r.ops).toHaveLength(3);
  });

  it('StyleSchema + sanitizeStyleProfile', () => {
    const st = sanitizeStyleProfile(StyleSchema.parse({ summary: 'x', pacing: 'fast', avgShotLength: 2, transitions: ['cut'], zoomPunchIns: true }));
    expect(st?.pacing).toBe('fast');
  });
});

describe('summary', () => {
  it('resume com ids reais e sem campos pesados', () => {
    const p = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'c1' } }]).project;
    const s = summarizeProject(p, { a1: asset }, [{ id: 'm', role: 'user', text: 'oi', createdAt: 0 }]) as S;
    expect(s.tracks[0].clips[0]).toMatchObject({ id: 'c1', assetId: 'a1', start: 0, end: 12, in: 0, mediaEnd: 12 });
    expect(JSON.stringify(s)).not.toContain('BBBB');
    expect(s.chat).toEqual([{ role: 'user', text: 'oi' }]);
    const slim = slimAssets({ a1: asset });
    expect(slim.a1.thumbnails).toBeUndefined();
    expect(slim.a1.url).toBeUndefined();
  });
});

describe('whisper -> legendas', () => {
  it('agrupa palavras em frases, cola pontuação, quebra em pausas', () => {
    const chunks = [
      { text: ' Olá', timestamp: [0.5, 0.8] as [number, number] },
      { text: ' pessoal', timestamp: [0.8, 1.3] as [number, number] },
      { text: '!', timestamp: [1.3, 1.35] as [number, number] },
      { text: ' hoje', timestamp: [3.0, 3.3] as [number, number] },
      { text: ' tem', timestamp: [3.3, 3.5] as [number, number] },
      { text: ' pão', timestamp: [3.6, null] as [number, number | null] },
    ];
    const segs = wordsToSegments(chunks as never, { duration: 10 });
    expect(segs.map((s) => s.text)).toEqual(['Olá pessoal!', 'hoje tem pão']);
    expect(segs[0].words).toHaveLength(2);
    expect(segs[1].end).toBeGreaterThan(3.6);
  });

  it('splitPoints corta perto do silêncio e cobre tudo', () => {
    const sr = 100;
    const a = new Float32Array(150 * sr).fill(0.5);
    a.fill(0, 57 * sr, 58 * sr); // silêncio em 57-58 s
    const pts = splitPoints(a, sr, 60, 6);
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(150);
    expect(pts[1]).toBeGreaterThanOrEqual(57);
    expect(pts[1]).toBeLessThanOrEqual(58);
  });
});

describe('frames', () => {
  it('planSamples: diffs regulares e no máx. maxFrames JPEGs', () => {
    const p = planSamples(40, { diffStep: 0.25, frameEvery: 1, maxFrames: 20 });
    expect(p.diffTimes.length).toBeGreaterThan(150);
    expect(p.jpegIdx.size).toBe(20);
    expect(p.diffTimes.every((t) => t < 40)).toBe(true);
  });

  it('fitBudget mantém distribuição e cabe no orçamento', () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ t: i, data: 'x'.repeat(100_000) }));
    const fit = fitBudget(frames, 1_000_000);
    expect(fit.length).toBeLessThanOrEqual(10);
    expect(fit[0].t).toBe(0);
  });

  it('framesFromThumbnails usa as miniaturas do shell', () => {
    const f = framesFromThumbnails(asset.thumbnails, 12, 6);
    expect(f).toHaveLength(2);
    expect(f[0].data).toBe('AAAA');
    expect(f[1].t).toBe(9);
  });
});
