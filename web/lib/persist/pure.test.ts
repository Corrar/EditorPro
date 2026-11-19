import { describe, expect, it, vi } from 'vitest';
import { createProject, makeVideoClip } from '../defaults';
import type { MediaAsset } from '../types';
import { buildRecord, debounce, isBlank, orphanBlobIds, proxyBlobId, relativeTime, stripAsset, summarize, usedAssetIds } from './pure';

const asset: MediaAsset = {
  id: 'a1', kind: 'video', role: 'source', name: 'v.mp4', mime: 'video/mp4', size: 10, duration: 4,
  url: 'blob:x', thumbnails: ['data:t0', 'data:t1', 'data:t2'],
};

describe('registro do projeto', () => {
  it('remove a URL de runtime do asset', () => {
    expect(stripAsset(asset)).not.toHaveProperty('url');
    expect(stripAsset(asset).name).toBe('v.mp4');
  });

  it('monta registro com duração, contagem, capa e mensagens finalizadas', () => {
    const p = createProject({ name: 'X' });
    p.tracks[0].clips.push(makeVideoClip(asset, 0));
    const r = buildRecord(p, [{ id: 'm', role: 'assistant', text: 'oi', createdAt: 1, status: 'applying' }], { a1: asset });
    expect(r.duration).toBe(4);
    expect(r.clipCount).toBe(1);
    expect(r.cover).toBe('data:t1');
    expect(r.messages[0].status).toBe('done');
    expect(r.assets[0]).not.toHaveProperty('url');
    const s = summarize(r);
    expect(s).not.toHaveProperty('project');
    expect(s.assetCount).toBe(1);
  });

  it('usedAssetIds inclui clipes e referência', () => {
    const p = createProject();
    p.tracks[0].clips.push(makeVideoClip(asset, 0));
    p.referenceAssetId = 'ref';
    expect([...usedAssetIds(p)].sort()).toEqual(['a1', 'ref']);
  });

  it('isBlank detecta projeto sem conteúdo', () => {
    const p = createProject();
    expect(isBlank(p, {}, [])).toBe(true);
    expect(isBlank({ ...p, brief: 'algo' }, {}, [])).toBe(false);
    expect(isBlank(p, { a1: asset }, [])).toBe(false);
  });

  it('orphanBlobIds acha blobs sem dono', () => {
    expect(orphanBlobIds(['a', 'b', 'c'], [{ assets: [stripAsset({ ...asset, id: 'b' })] }])).toEqual(['a', 'c']);
  });

  it('proxy de preview: blob protegido, URL e estado pendente não são salvos', () => {
    expect(orphanBlobIds(['b', proxyBlobId('b'), proxyBlobId('x')], [{ assets: [stripAsset({ ...asset, id: 'b' })] }])).toEqual([proxyBlobId('x')]);
    const s = stripAsset({ ...asset, proxyUrl: 'blob:p', proxyStatus: 'pending' });
    expect('proxyUrl' in s).toBe(false);
    expect(s.proxyStatus).toBeUndefined();
    expect(stripAsset({ ...asset, proxyStatus: 'ready' }).proxyStatus).toBe('ready');
  });
});

describe('debounce', () => {
  it('agrupa chamadas e usa os últimos argumentos; flush/cancel', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1); d(2); d(3);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(3);
    d(4); d.flush();
    expect(fn).toHaveBeenLastCalledWith(4);
    d(5); d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('relativeTime', () => {
  it('formata em PT-BR', () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('agora mesmo');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('há 5 min');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('há 3 h');
    expect(relativeTime(now - 26 * 3600_000, now)).toBe('ontem');
  });
});
