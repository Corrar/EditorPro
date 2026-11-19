import { describe, expect, it } from 'vitest';
import { createProject, makeVideoClip } from '../defaults';
import { applyOps } from '../ops';
import { useEditor } from '../store';
import type { MediaAsset } from '../types';
import { assetsToRestore, initAssetTrash, referencedAssetIds, trashAsset } from './trash';
import { placeAssetOp } from './place';

const vid = (id: string): MediaAsset => ({ id, kind: 'video', role: 'source', name: id, mime: 'video/mp4', size: 1, duration: 4, url: 'blob:x' });

describe('lixeira de mídia (B2: remover + desfazer)', () => {
  it('referencedAssetIds pega clipes, vídeo modelo e fundo', () => {
    const p = createProject();
    p.tracks[0].clips.push(makeVideoClip(vid('a'), 0));
    p.referenceAssetId = 'r';
    p.canvas = { type: 'image', assetId: 'bg' };
    expect([...referencedAssetIds(p)].sort()).toEqual(['a', 'bg', 'r']);
  });
  it('assetsToRestore devolve só o que voltou a ser usado e está na lixeira', () => {
    const p = createProject();
    p.tracks[0].clips.push(makeVideoClip(vid('a'), 0));
    const trash = new Map([['a', vid('a')], ['z', vid('z')]]);
    expect(assetsToRestore(p, {}, trash).map((a) => a.id)).toEqual(['a']);
    expect(assetsToRestore(p, { a: vid('a') }, trash)).toEqual([]);
  });
  it('fluxo real no store: remover mídia → desfazer traz clipe E asset', () => {
    const st = useEditor.getState();
    st.newProject();
    initAssetTrash();
    const a = vid('asset_1');
    useEditor.getState().addAsset(a);
    useEditor.getState().dispatch(placeAssetOp(useEditor.getState().project, a));
    const clipId = useEditor.getState().project.tracks.flatMap((t) => t.clips)[0].id;
    // remover da biblioteca: remove_clip no histórico + asset para a lixeira
    useEditor.getState().dispatch([{ op: 'remove_clip', clipId }]);
    trashAsset(a);
    expect(useEditor.getState().assets.asset_1).toBeUndefined();
    useEditor.getState().undo();
    expect(useEditor.getState().project.tracks.flatMap((t) => t.clips)).toHaveLength(1);
    expect(useEditor.getState().assets.asset_1?.id).toBe('asset_1');
    void applyOps;
  });
});
