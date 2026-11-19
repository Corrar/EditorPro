import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../store';
import { useAIChat } from './chatStore';
import * as pipeline from './pipeline';
import { applyOps } from '../ops';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';

const src: MediaAsset = { id: 'a1', kind: 'video', role: 'source', name: 'b.mp4', mime: 'video/mp4', size: 1, duration: 20 };
const lastAssistant = () => [...useEditor.getState().messages].reverse().find((m) => m.role === 'assistant')!;
const snap = () => JSON.stringify(useEditor.getState().project);

afterEach(() => vi.restoreAllMocks());

describe('"Voltar para antes desta edição" (undoTo)', () => {
  it('3 edições (uma com vários lotes) + edição manual no meio: volta EXATAMENTE ao estado de antes da 2ª', async () => {
    const p = applyOps(createProject(), [{ op: 'add_clip', trackId: 'track_video_1', clip: { ...makeVideoClip(src, 0), id: 'c1' } }]).project;
    useEditor.setState({ project: p, past: [], future: [], assets: { a1: src }, messages: [] });
    useAIChat.setState({ status: { configured: false, provider: 'demo' } as never, fast: true, runs: {}, busy: false });

    // 1ª: vários lotes (como a 1ª edição real)
    vi.spyOn(pipeline, 'runFirstEdit').mockImplementation(async (o) => {
      await o.apply!([{ op: 'set_aspect', aspect: '1:1', explain: 'a' }], { delayMs: 0 });
      await o.apply!([{ op: 'update_clip', clipId: 'c1', patch: { volume: 0.5 }, explain: 'b' }], { delayMs: 0 });
      await o.apply!([{ op: 'update_clip', clipId: 'c1', patch: { colorPreset: 'warm' }, explain: 'c' }], { delayMs: 0 });
      return { reply: 'ok', ops: [], appliedIds: ['x'], provider: 'demo', warnings: [] };
    });
    await useAIChat.getState().firstEdit('teste');
    const afterFirst = snap();

    // edição manual (com histórico) e uma sem histórico (ex.: ajuste automático do shell)
    useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c1', patch: { volume: 0.7 } });
    useEditor.getState().dispatch({ op: 'set_project', patch: { name: 'Meu vídeo' } }, { history: false });
    const beforeSecond = snap();

    await useAIChat.getState().send('corte os primeiros 2 s');
    const second = lastAssistant();
    useEditor.getState().dispatch({ op: 'update_clip', clipId: 'c1', patch: { volume: 0.9 } });
    await useAIChat.getState().send('remova os últimos 3 segundos');

    expect(useAIChat.getState().canUndoTo(second.id)).toBe(true);
    useAIChat.getState().undoTo(second.id);
    expect(snap()).toBe(beforeSecond);
    expect(snap()).not.toBe(afterFirst); // a edição manual entre a 1ª e a 2ª fica
    // refazer volta tudo
    while (useEditor.getState().future.length) useEditor.getState().redo();
    expect(useEditor.getState().project.tracks[0].clips[0].duration).toBeCloseTo(15, 1);
  }, 30000);
});
