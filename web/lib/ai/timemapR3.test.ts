/* review r3 (legendas): a mesma fala aparece 2× na timeline (clipe duplicado / repetido) */
import { describe, expect, it } from 'vitest';
import { applyOp } from '../ops';
import { createProject, makeAudioClip, makeVideoClip } from '../defaults';
import type { CaptionSegment, MediaAsset, Project, VideoClip } from '../types';
import { captionsMediaToTimeline } from './timemap';

const asset: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'v.mp4', mime: 'video/mp4', size: 1, duration: 60 };
// transcrição em tempos DA MÍDIA: "oi gente" em 1–2 s, "tudo bem" em 3–4 s
const media: CaptionSegment[] = [
  { id: 'm1', start: 1, end: 2, text: 'oi gente', words: [{ start: 1, end: 1.4, text: 'oi' }, { start: 1.5, end: 2, text: 'gente' }] },
  { id: 'm2', start: 3, end: 4, text: 'tudo bem', words: [{ start: 3, end: 3.4, text: 'tudo' }, { start: 3.5, end: 4, text: 'bem' }] },
];

describe('captionsMediaToTimeline com a mesma fala mais de uma vez na timeline', () => {
  it('clipe duplicado: a fala repetida também ganha legenda', () => {
    let p: Project = applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'c1', in: 0, duration: 5 } as VideoClip });
    p = applyOp(p, { op: 'duplicate_clip', clipId: 'c1', newId: 'c2' }); // c2 em 5–10 s mostra a mesma mídia 0–5 s
    const tl = captionsMediaToTimeline(p, 'a1', media);
    const words = tl.flatMap((s) => s.words ?? []).map((w) => `${w.text}@${w.start}`);
    // antes: só a 1ª cópia (oi@1 gente@1.5 tudo@3 bem@3.5) — a fala em 5–10 s ficava sem legenda
    expect(words).toEqual(['oi@1', 'gente@1.5', 'tudo@3', 'bem@3.5', 'oi@6', 'gente@6.5', 'tudo@8', 'bem@8.5']);
    expect(new Set(tl.map((s) => s.id)).size).toBe(tl.length); // ids únicos
  });

  it('gancho: trecho do fim repetido no começo — o trecho original continua legendado', () => {
    let p: Project = applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'hook', in: 3, duration: 1 } as VideoClip });
    p = applyOp(p, { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 1), id: 'main', in: 0, duration: 5 } as VideoClip });
    const tl = captionsMediaToTimeline(p, 'a1', media);
    expect(tl.flatMap((s) => s.words ?? []).map((w) => `${w.text}@${w.start}`)).toEqual(['tudo@0', 'bem@0.5', 'oi@2', 'gente@2.5', 'tudo@4', 'bem@4.5']);
  });

  it('vídeo + áudio vinculado da mesma mídia no MESMO tempo: legenda não sai dobrada', () => {
    let p: Project = applyOp(createProject(), { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(asset, 0), id: 'v', in: 0, duration: 5, linkId: 'L' } as VideoClip });
    p = applyOp(p, { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(asset, 0), id: 'a', in: 0, duration: 5, linkId: 'L' } });
    const tl = captionsMediaToTimeline(p, 'a1', media);
    expect(tl.flatMap((s) => s.words ?? []).map((w) => `${w.text}@${w.start}`)).toEqual(['oi@1', 'gente@1.5', 'tudo@3', 'bem@3.5']);
  });
});
