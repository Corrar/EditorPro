import { describe, expect, it } from 'vitest';
import { createProject, makeVideoClip } from '@/lib/defaults';
import { sourceTime } from '@/lib/engine/timing';
import { detachAudioOps } from '@/lib/timeline/edit';
import type { MediaAsset, VideoClip } from '@/lib/types';

const vid: MediaAsset = { id: 'v', kind: 'video', role: 'source', name: 'v', mime: 'video/mp4', size: 1, duration: 10, url: 'blob:' };

describe('B7: congelar/extrair respeitam reverso e curva', () => {
  it('congelar: tempo na mídia de um clipe reverso não é o cálculo ingênuo', () => {
    const c = { ...makeVideoClip(vid, 0), duration: 5, in: 0, reverse: true } as VideoClip;
    const naive = c.in + (1 - c.start) * (c.speed || 1);
    expect(naive).toBe(1);
    expect(sourceTime(c, 1)).toBeCloseTo(4, 1); // 1 s depois do início = quadro 4 s da mídia
  });
  it('extrair áudio: copia reverso, curva, preset, fades e vínculo', () => {
    const p = createProject();
    const c = { ...makeVideoClip(vid, 0), duration: 5, reverse: true, speedCurve: [{ t: 0, speed: 1 }, { t: 1, speed: 2 }], speedPreset: 'hero', fadeIn: 0.3 } as VideoClip;
    p.tracks.find((t) => t.kind === 'video')!.clips.push(c);
    const ops = detachAudioOps(p, c.id);
    const add = ops.find((o) => o.op === 'add_clip') as { clip: Record<string, unknown> };
    expect(add.clip.reverse).toBe(true);
    expect(add.clip.speedCurve).toEqual(c.speedCurve);
    expect(add.clip.speedPreset).toBe('hero');
    expect(add.clip.fadeIn).toBe(0.3);
    expect(add.clip.linkId).toBeTruthy();
    expect(add.clip.assetId).toBe('v'); // mesmo asset, sem WAV decodificado (B6)
  });
});
