/* review r3 (legendas): narração (áudio) + b-roll (vídeo) — mexer no b-roll não pode arrastar a legenda da narração */
import { describe, expect, it } from 'vitest';
import { applyOp } from './ops';
import { createProject, makeAudioClip, makeVideoClip } from './defaults';
import type { AudioClip, CaptionSegment, MediaAsset, Project, VideoClip } from './types';
import { captionsMediaToTimeline } from './ai/timemap';

const voz: MediaAsset = { id: 'voz', kind: 'audio', role: 'source', name: 'narracao.m4a', mime: 'audio/mp4', size: 1, duration: 30 };
const broll: MediaAsset = { id: 'br', kind: 'video', role: 'broll', name: 'praia.mp4', mime: 'video/mp4', size: 1, duration: 30 };

/** narração 0–10 s na trilha de áudio; dois b-rolls (com o som ambiente deles) 0–5 e 5–10 na de vídeo; legenda transcrita da narração */
function project(): Project {
  let p = applyOp(createProject(), { op: 'add_clip', trackId: 'track_audio_1', clip: { ...makeAudioClip(voz, 0), id: 'v', in: 0, duration: 10 } as AudioClip });
  p = applyOp(p, { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(broll, 0), id: 'b1', in: 0, duration: 5 } as VideoClip });
  p = applyOp(p, { op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(broll, 5), id: 'b2', in: 10, duration: 5 } as VideoClip });
  const media: CaptionSegment[] = [0, 2, 4, 6, 8].map((s) => ({
    id: `m${s}`, start: s + 0.1, end: s + 1.5, text: `p${s} q${s}`,
    words: [{ start: s + 0.1, end: s + 0.6, text: `p${s}` }, { start: s + 1, end: s + 1.5, text: `q${s}` }],
  }));
  return applyOp(p, { op: 'set_captions', segments: captionsMediaToTimeline(p, 'voz', media), source: 'transcription' });
}
const times = (p: Project) => p.captions.segments.flatMap((s) => s.words ?? []).map((w) => `${w.text}@${w.start}`);

describe('legenda da narração fica no lugar quando o b-roll muda', () => {
  const before = times(project());
  it.each([
    ['velocidade 2× no b-roll', { op: 'update_clip', clipId: 'b1', patch: { speed: 2 } }],
    ['curva de velocidade no b-roll', { op: 'update_clip', clipId: 'b1', patch: { speedPreset: 'montage' } }],
    ['mover o b-roll', { op: 'move_clip', clipId: 'b2', start: 7 }],
    ['aparar o b-roll', { op: 'trim_clip', clipId: 'b1', start: 1 }],
    ['remover o b-roll com ripple', { op: 'remove_clip', clipId: 'b1', ripple: true }],
  ] as const)('%s', (_n, op) => {
    // antes: a legenda seguia o b-roll (vídeo tinha prioridade) — encolhia, andava ou SUMIA com ele
    expect(times(applyOp(project(), op as never))).toEqual(before);
  });
  it('mexer na NARRAÇÃO continua levando a legenda junto', () => {
    const p = applyOp(project(), { op: 'move_clip', clipId: 'v', start: 2 });
    expect(times(p)).toEqual(before.map((x) => { const [t, s] = x.split('@'); return `${t}@${Math.round((+s + 2) * 1000) / 1000}`; }));
  });
});
