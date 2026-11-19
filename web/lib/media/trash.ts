'use client';
/* =====================================================================
   Lixeira de mídia: "Remover" da biblioteca tira o asset do store, mas os
   remove_clip vão para o histórico. Se um Desfazer/Refazer trouxer de volta
   um clipe (ou o fundo/vídeo modelo) que aponta para um asset removido,
   devolvemos o asset da lixeira. Object URLs só são revogados quando o
   projeto troca (aí o histórico zera).
   ===================================================================== */
import { useEditor } from '../store';
import type { Id, MediaAsset, Project } from '../types';

/** ids de mídia que o projeto referencia (clipes, vídeo modelo, fundo em imagem) */
export function referencedAssetIds(p: Project): Set<Id> {
  const ids = new Set<Id>();
  for (const t of p.tracks) for (const c of t.clips) if ('assetId' in c && c.assetId) ids.add(c.assetId);
  if (p.referenceAssetId) ids.add(p.referenceAssetId);
  if (p.canvas?.assetId) ids.add(p.canvas.assetId);
  return ids;
}

/** quais assets da lixeira o projeto voltou a usar */
export function assetsToRestore(p: Project, assets: Record<Id, MediaAsset>, trash: Map<Id, MediaAsset>): MediaAsset[] {
  const out: MediaAsset[] = [];
  for (const id of referencedAssetIds(p)) if (!assets[id] && trash.has(id)) out.push(trash.get(id)!);
  return out;
}

const trash = new Map<Id, MediaAsset>();
let projectId: Id | null = null;
let started = false;

export function trashedAssetIds(): Id[] { return [...trash.keys()]; }

/** tira o asset do store guardando-o na lixeira (desfazível) */
export function trashAsset(a: MediaAsset): void {
  trash.set(a.id, a);
  useEditor.getState().removeAsset(a.id);
}

function revoke(a: MediaAsset) {
  if (a.url?.startsWith('blob:')) URL.revokeObjectURL(a.url);
  if (a.proxyUrl?.startsWith('blob:')) URL.revokeObjectURL(a.proxyUrl);
}

export function initAssetTrash(): () => void {
  if (started) return () => {};
  started = true;
  projectId = useEditor.getState().project.id;
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.project.id !== projectId) {
      // outro projeto: o histórico zerou → a lixeira não volta mais
      projectId = s.project.id;
      for (const a of trash.values()) if (!s.assets[a.id]) revoke(a);
      trash.clear();
      return;
    }
    if (s.project === prev.project || !trash.size) return;
    const back = assetsToRestore(s.project, s.assets, trash);
    if (!back.length) return;
    for (const a of back) trash.delete(a.id);
    useEditor.setState((st) => ({ assets: { ...st.assets, ...Object.fromEntries(back.map((a) => [a.id, a])) } }));
  });
  return () => { unsub(); started = false; };
}
