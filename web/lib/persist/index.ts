'use client';
/* =====================================================================
   Persistência do editor: autosave com debounce, abrir/restaurar
   projetos (recriando object URLs dos blobs) e lista "Meus projetos".
   Dono: sessão "shell".
   ===================================================================== */
import { create } from 'zustand';
import { useEditor } from '../store';
import type { MediaAsset } from '../types';
import { deleteProject as dbDelete, getBlob, getKV, getProjectRecord, idbAvailable, listProjects, saveProjectRecord, setKV } from './db';
import { buildRecord, debounce, isBlank } from './pure';

export { listProjects, putBlob, getBlob, gcBlobs } from './db';
export type { ProjectSummary, ProjectRecord } from './pure';
export { relativeTime } from './pure';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unavailable';

export const useSaveStatus = create<{ status: SaveStatus; at: number }>(() => ({ status: 'idle', at: 0 }));

/** grava o projeto atual (projeto + mensagens + metadados dos assets) */
export async function saveNow(): Promise<boolean> {
  if (!idbAvailable()) {
    useSaveStatus.setState({ status: 'unavailable', at: Date.now() });
    return false;
  }
  const { project, messages, assets } = useEditor.getState();
  if (isBlank(project, assets, messages)) return false;
  useSaveStatus.setState({ status: 'saving', at: Date.now() });
  try {
    await saveProjectRecord(buildRecord(project, messages, assets));
    await setKV('lastProjectId', project.id);
    useSaveStatus.setState({ status: 'saved', at: Date.now() });
    return true;
  } catch (e) {
    console.warn('[persist] falha ao salvar', e);
    useSaveStatus.setState({ status: 'error', at: Date.now() });
    return false;
  }
}

let stopFn: (() => void) | null = null;
const saveSoon = debounce(() => void saveNow(), 900);

/** liga o autosave (idempotente). Devolve função para desligar. */
export function startAutosave(): () => void {
  if (stopFn) return stopFn;
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.project !== prev.project || s.messages !== prev.messages || s.assets !== prev.assets) saveSoon();
  });
  const onHide = () => { if (document.visibilityState === 'hidden') saveSoon.flush(); };
  const onUnload = () => saveSoon.flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onUnload);
  saveSoon(); // grava o estado inicial (ex.: projeto recém-criado pelo wizard)
  stopFn = () => {
    saveSoon.flush();
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onUnload);
    stopFn = null;
  };
  return stopFn;
}

/** salva pendências agora (ex.: antes de trocar de projeto) */
export function flushAutosave(): void {
  saveSoon.flush();
}

/** libera as object URLs dos assets em memória */
export function revokeAssetUrls(assets: Record<string, MediaAsset>): void {
  for (const a of Object.values(assets)) if (a.url?.startsWith('blob:')) URL.revokeObjectURL(a.url);
}

/** abre um projeto salvo: carrega projeto, mensagens e recria os object URLs */
export async function openProject(id: string): Promise<boolean> {
  saveSoon.flush();
  const rec = await getProjectRecord(id);
  if (!rec) return false;
  const assets: Record<string, MediaAsset> = {};
  await Promise.all(
    rec.assets.map(async (a) => {
      let url: string | undefined;
      try {
        const blob = await getBlob(a.id);
        if (blob) url = URL.createObjectURL(blob);
      } catch {}
      assets[a.id] = { ...a, url };
    }),
  );
  const st = useEditor.getState();
  revokeAssetUrls(st.assets);
  st.loadProject(rec.project);
  useEditor.setState({ assets, messages: rec.messages ?? [] });
  await setKV('lastProjectId', id).catch(() => {});
  useSaveStatus.setState({ status: 'saved', at: rec.updatedAt });
  return true;
}

/** restaura o último projeto aberto (se houver). */
export async function restoreLastProject(): Promise<boolean> {
  if (!idbAvailable()) return false;
  try {
    const id = await getKV<string | null>('lastProjectId');
    if (!id) return false;
    return await openProject(id);
  } catch (e) {
    console.warn('[persist] falha ao restaurar', e);
    return false;
  }
}

/** começa do zero (limpa mídia/mensagens em memória; o que estava salvo continua no banco) */
export function resetWorkspace(opts?: Parameters<ReturnType<typeof useEditor.getState>['newProject']>[0]): void {
  saveSoon.flush(); // não perde edições pendentes do projeto anterior
  const st = useEditor.getState();
  revokeAssetUrls(st.assets);
  st.newProject(opts);
  useEditor.setState({ assets: {}, messages: [] });
  useSaveStatus.setState({ status: 'idle', at: 0 });
}

export async function deleteProject(id: string): Promise<void> {
  const st = useEditor.getState();
  if (st.project.id === id) {
    // apagando o projeto aberto: descarta pendências e limpa a área de trabalho
    saveSoon.cancel();
    revokeAssetUrls(st.assets);
    st.newProject();
    useEditor.setState({ assets: {}, messages: [] });
  }
  // protege a mídia em uso no projeto aberto (pode ainda não ter sido salva)
  await dbDelete(id, Object.keys(useEditor.getState().assets));
}

/** duplica um projeto salvo (mídia compartilhada pelos mesmos blobs) */
export async function duplicateProject(id: string): Promise<string | null> {
  flushAutosave();
  const rec = await getProjectRecord(id);
  if (!rec) return null;
  const { uid } = await import('../util');
  const newId = uid('proj');
  const now = Date.now();
  const name = `${rec.name} (cópia)`;
  await saveProjectRecord({ ...rec, id: newId, name, createdAt: now, updatedAt: now, project: { ...rec.project, id: newId, name, createdAt: now, updatedAt: now } });
  return newId;
}

/** renomeia um projeto salvo (se for o aberto, usa a op set_project) */
export async function renameProject(id: string, name: string): Promise<void> {
  const st = useEditor.getState();
  if (st.project.id === id) { st.dispatch({ op: 'set_project', patch: { name } }); return; }
  const rec = await getProjectRecord(id);
  if (!rec) return;
  await saveProjectRecord({ ...rec, name, project: { ...rec.project, name } });
}

/** começa um projeto novo a partir de um Project pronto (modelos) */
export function startFromProject(p: import('../types').Project): void {
  saveSoon.flush();
  const st = useEditor.getState();
  revokeAssetUrls(st.assets);
  st.loadProject(p);
  useEditor.setState({ assets: {}, messages: [] });
  useSaveStatus.setState({ status: 'idle', at: 0 });
}
