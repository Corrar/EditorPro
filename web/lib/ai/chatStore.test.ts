import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../store';
import { useAIChat } from './chatStore';
import * as pipeline from './pipeline';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };

afterEach(() => vi.restoreAllMocks());

describe('undoRun desfaz todos os lotes da execução', () => {
  it('1ª edição com 3 lotes -> um "Desfazer edição" volta ao projeto de antes', async () => {
    useEditor.setState({ project: createProject(), past: [], future: [], assets: { a1: src }, messages: [] });
    const before = useEditor.getState().project;
    vi.spyOn(pipeline, 'runFirstEdit').mockImplementation(async (o) => {
      // três lotes separados, cada um vira um passo no histórico (sem withSingleUndo)
      await o.apply!([{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' }, explain: 'a' }], { delayMs: 0 });
      await o.apply!([{ op: 'set_aspect', aspect: '1:1', explain: 'b' }], { delayMs: 0 });
      await o.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.5 }, explain: 'c' }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: ['x'], provider: 'demo', warnings: [] };
    });
    useAIChat.setState({ status: { configured: false, provider: 'demo' } as never, fast: true });
    await useAIChat.getState().firstEdit('teste');
    expect(useEditor.getState().past.length).toBeGreaterThanOrEqual(3);
    const msg = [...useEditor.getState().messages].reverse().find((m) => m.role === 'assistant')!;
    useAIChat.getState().undoRun(msg.id);
    expect(useEditor.getState().project).toBe(before);
  }, 20000);
});
