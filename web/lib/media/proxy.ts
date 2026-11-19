'use client';
/* =====================================================================
   Proxy de preview: cópia leve (≤720p) dos vídeos pesados, gerada em segundo
   plano na ingestão para a reprodução não engasgar no celular. A função de
   transcodificação é do engine (`makePreviewProxy` em @/lib/export); enquanto
   ela não existir, este gancho não faz nada (import dinâmico tolerante).
   ===================================================================== */
import { create } from 'zustand';
import { putBlob } from '../persist/db';
import { proxyBlobId } from '../persist/pure';
import { useEditor } from '../store';
import type { MediaAsset } from '../types';
import { PROXY_MAX_HEIGHT, needsProxy } from './proxyPolicy';

/** progresso 0..1 por asset (p/ o selo "Otimizando…" da biblioteca) */
export const useProxyProgress = create<Record<string, number>>(() => ({}));

type MakeProxy = (file: Blob, o: { maxHeight?: number; onProgress?: (f: number) => void; signal?: AbortSignal }) => Promise<Blob | { blob: Blob } | null | undefined>;

async function loadMaker(): Promise<MakeProxy | null> {
  try {
    const mod = (await import('@/lib/export')) as unknown as Record<string, unknown>;
    return typeof mod.makePreviewProxy === 'function' ? (mod.makePreviewProxy as MakeProxy) : null;
  } catch {
    return null;
  }
}

const running = new Map<string, AbortController>();

/** dispara (sem esperar) a geração do proxy, se o vídeo precisar */
export function startPreviewProxy(file: Blob, asset: MediaAsset): void {
  if (asset.role === 'reference' || !needsProxy(asset) || running.has(asset.id)) return; // modelo só é analisado
  void (async () => {
    const make = await loadMaker();
    if (!make) return; // engine ainda não publicou a função
    const { updateAsset } = useEditor.getState();
    const alive = () => !!useEditor.getState().assets[asset.id];
    const ctl = new AbortController();
    running.set(asset.id, ctl);
    updateAsset(asset.id, { proxyStatus: 'pending' });
    useProxyProgress.setState({ [asset.id]: 0 });
    try {
      const out = await make(file, {
        maxHeight: PROXY_MAX_HEIGHT,
        signal: ctl.signal,
        onProgress: (f) => useProxyProgress.setState({ [asset.id]: Math.max(0, Math.min(1, f)) }),
      });
      const blob = out instanceof Blob ? out : out?.blob;
      if (!blob || !alive()) throw new Error('sem proxy');
      await putBlob(proxyBlobId(asset.id), blob).catch(() => {});
      updateAsset(asset.id, { proxyUrl: URL.createObjectURL(blob), proxyStatus: 'ready' });
    } catch {
      if (alive()) updateAsset(asset.id, { proxyStatus: 'failed' }); // segue com a original
    } finally {
      running.delete(asset.id);
      useProxyProgress.setState((s) => { const n = { ...s }; delete n[asset.id]; return n; }, true);
    }
  })();
}

/** cancela a geração (ex.: mídia removida) */
export function cancelPreviewProxy(assetId: string): void {
  running.get(assetId)?.abort();
}
