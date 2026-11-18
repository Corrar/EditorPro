import { describe, expect, it } from 'vitest';
import { EDIT_SCHEMA, STYLE_SCHEMA, TRANSCRIPT_SCHEMA } from './schemas';
import { OP_KINDS } from './validate';
import { slimAssets, summarizeProject } from './summary';
import { applyOps } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';

type S = Record<string, any>;

describe('schemas', () => {
  it('EDIT_SCHEMA tem uma variante por EditOp, todas exigindo explain', () => {
    const variants = (EDIT_SCHEMA as S).properties.ops.items.anyOf as S[];
    const kinds = variants.map((v) => v.properties.op.enum[0]).sort();
    expect(kinds).toEqual([...OP_KINDS].sort());
    for (const v of variants) expect(v.required).toContain('explain');
  });

  it('schemas são JSON puro (serializáveis) e com required válidos', () => {
    for (const s of [EDIT_SCHEMA, STYLE_SCHEMA, TRANSCRIPT_SCHEMA]) {
      const walk = (n: S) => {
        if (n && typeof n === 'object') {
          if (n.type === 'object' && n.required) for (const r of n.required) expect(Object.keys(n.properties)).toContain(r);
          Object.values(n).forEach((x) => walk(x as S));
        }
      };
      walk(JSON.parse(JSON.stringify(s)));
    }
  });
});

describe('summary', () => {
  const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 12, thumbnails: ['data:x'], waveform: [0.1], url: 'blob:x' };
  it('resume com ids reais e sem campos pesados', () => {
    const p = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'c1' } }]).project;
    const s = summarizeProject(p, { a1: asset }, [{ id: 'm', role: 'user', text: 'oi', createdAt: 0 }]) as S;
    expect(s.tracks[0].clips[0]).toMatchObject({ id: 'c1', assetId: 'a1', start: 0, end: 12, in: 0, mediaEnd: 12 });
    expect(JSON.stringify(s)).not.toContain('data:x');
    expect(s.chat).toEqual([{ role: 'user', text: 'oi' }]);
    const slim = slimAssets({ a1: asset });
    expect(slim.a1.thumbnails).toBeUndefined();
    expect(slim.a1.url).toBeUndefined();
    expect(slim.a1.duration).toBe(12);
  });
});
