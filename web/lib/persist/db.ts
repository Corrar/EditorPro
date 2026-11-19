/* =====================================================================
   IndexedDB sem dependências: projetos, blobs de mídia e chave/valor.
   Banco "editorpro" v1:
     - projects (keyPath id)  → ProjectRecord (projeto + mensagens + metadados dos assets)
     - media    (keyPath id)  → { id, blob }   (arquivo original do usuário)
     - kv       (out-of-line) → valores soltos (ex.: lastProjectId)
   Todas as funções falham "suave" (rejeitam) se o IndexedDB não existir.
   ===================================================================== */
import type { ProjectRecord, ProjectSummary, RecentMedia } from './pure';
import { RECENTS_KEY, orphanBlobIds, summarize } from './pure';

const DB_NAME = 'editorpro';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB indisponível'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('[persist] IndexedDB bloqueado por outra aba');
  });
  return dbPromise;
}

type StoreName = 'projects' | 'media' | 'kv';

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result: T;
    Promise.resolve(fn(s) as unknown)
      .then((r) => (r instanceof IDBRequest ? reqP(r as IDBRequest<T>) : (r as T)))
      .then((r) => { result = r; })
      .catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('transação abortada'));
  });
}

/* ---------- projetos ---------- */

export function saveProjectRecord(r: ProjectRecord): Promise<IDBValidKey> {
  return tx('projects', 'readwrite', (s) => s.put(r));
}

export function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  return tx('projects', 'readonly', (s) => s.get(id) as IDBRequest<ProjectRecord | undefined>);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx('projects', 'readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>);
  return all.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** apaga o projeto e os blobs que nenhum outro projeto usa */
export async function deleteProject(id: string, keepBlobs: string[] = []): Promise<void> {
  await tx('projects', 'readwrite', (s) => s.delete(id));
  if ((await getKV<string>('lastProjectId')) === id) await setKV('lastProjectId', null);
  await gcBlobs(keepBlobs);
}

/* ---------- blobs de mídia ---------- */

export function putBlob(id: string, blob: Blob): Promise<IDBValidKey> {
  return tx('media', 'readwrite', (s) => s.put({ id, blob }));
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const row = await tx('media', 'readonly', (s) => s.get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>);
  return row?.blob;
}

export function deleteBlob(id: string): Promise<undefined> {
  return tx('media', 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

/** remove blobs órfãos (sem projeto que os referencie). `keep` protege ids em uso agora. */
export async function gcBlobs(keep: string[] = []): Promise<number> {
  const [ids, records] = await Promise.all([
    tx('media', 'readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>),
    tx('projects', 'readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>),
  ]);
  const protect = new Set(keep);
  // a galeria "Recentes" (entre projetos) também segura os blobs
  const recents = ((await getKV<RecentMedia[]>(RECENTS_KEY).catch(() => undefined)) ?? []).map((r) => r.asset.id);
  const orphans = orphanBlobIds(ids.map(String), records, recents).filter((id) => !protect.has(id));
  for (const id of orphans) await deleteBlob(id);
  return orphans.length;
}

/* ---------- chave/valor ---------- */

export function getKV<T>(key: string): Promise<T | undefined> {
  return tx('kv', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function setKV(key: string, value: unknown): Promise<IDBValidKey> {
  return tx('kv', 'readwrite', (s) => s.put(value, key));
}
