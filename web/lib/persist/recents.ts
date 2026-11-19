'use client';
/* =====================================================================
   Galeria "Recentes" (seletor de mídia dentro do app, estilo CapCut).
   Um PWA não lista a galeria do celular; então guardamos aqui o que o
   usuário já importou (metadados + miniaturas no kv, arquivo no store
   "media" com o MESMO id do asset — sem cópia) para escolher direto no app
   da 2ª vez em diante. Respeita a cota (navigator.storage.estimate) e pede
   armazenamento persistente uma vez.
   ===================================================================== */
import { create } from 'zustand';
import type { MediaAsset } from '../types';
import { getBlob, getKV, idbAvailable, setKV } from './db';
import { RECENTS_KEY, canKeep, stripAsset, upsertRecent, type RecentMedia } from './pure';

export const useRecents = create<{ list: RecentMedia[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

let loading: Promise<RecentMedia[]> | null = null;
export function loadRecents(): Promise<RecentMedia[]> {
  if (!idbAvailable()) { useRecents.setState({ loaded: true }); return Promise.resolve([]); }
  loading ??= getKV<RecentMedia[]>(RECENTS_KEY)
    .then((l) => l ?? [])
    .catch(() => [])
    .then((list) => { useRecents.setState({ list, loaded: true }); return list; });
  return loading;
}

let persistAsked = false;
async function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if ((await getKV<boolean>('persistAsked')) || !navigator.storage?.persist) return;
    await setKV('persistAsked', true);
    await navigator.storage.persist();
  } catch { /* opcional */ }
}

/** lembra um asset recém-importado (se couber na cota) */
export async function rememberRecent(a: MediaAsset): Promise<void> {
  if (!idbAvailable() || a.role === 'reference') return;
  try {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (!canKeep(est, a.size)) return;
    void askPersist();
    await loadRecents();
    const { list: next } = upsertRecent(useRecents.getState().list, { asset: stripAsset({ ...a, proxyStatus: undefined }), addedAt: Date.now() });
    useRecents.setState({ list: next });
    await setKV(RECENTS_KEY, next);
  } catch { /* sem armazenamento: o seletor só mostra a galeria do celular */ }
}

/** atualiza os metadados guardados (ex.: miniaturas que chegaram depois) */
export async function refreshRecent(a: MediaAsset): Promise<void> {
  await loadRecents();
  const list = useRecents.getState().list;
  if (!list.some((r) => r.asset.id === a.id)) return;
  const next = list.map((r) => (r.asset.id === a.id ? { ...r, asset: stripAsset({ ...a, proxyStatus: undefined }) } : r));
  useRecents.setState({ list: next });
  await setKV(RECENTS_KEY, next).catch(() => {});
}

export async function forgetRecent(id: string): Promise<void> {
  await loadRecents();
  const next = useRecents.getState().list.filter((r) => r.asset.id !== id);
  useRecents.setState({ list: next });
  await setKV(RECENTS_KEY, next).catch(() => {});
}

/** recria o asset a partir do recente (object URL do blob guardado); null se o arquivo sumiu */
export async function restoreRecent(r: RecentMedia): Promise<MediaAsset | null> {
  const blob = await getBlob(r.asset.id).catch(() => undefined);
  if (!blob) { await forgetRecent(r.asset.id); return null; }
  return { ...r.asset, url: URL.createObjectURL(blob), proxyUrl: undefined, proxyStatus: undefined };
}
