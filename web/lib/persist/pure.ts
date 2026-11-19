/* =====================================================================
   Persistência — funções puras (testadas). Sem IndexedDB/DOM.
   ===================================================================== */
import type { ChatMessage, MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';

/** metadados do asset que vão para o banco (sem object URL de runtime) */
export type StoredAsset = Omit<MediaAsset, 'url'>;

export interface ProjectRecord {
  id: string;
  name: string;
  aspect: Project['aspect'];
  updatedAt: number;
  createdAt: number;
  duration: number;
  clipCount: number;
  /** miniatura de capa (data URL) */
  cover?: string;
  project: Project;
  messages: ChatMessage[];
  assets: StoredAsset[];
}

export type ProjectSummary = Omit<ProjectRecord, 'project' | 'messages' | 'assets'> & { assetCount: number };

/** chave do blob do proxy de preview (vídeo leve p/ editar no celular) */
export const proxyBlobId = (assetId: string) => `${assetId}__proxy`;

export function stripAsset(a: MediaAsset): StoredAsset {
  const { url: _url, proxyUrl: _proxy, ...rest } = a;
  // proxy em geração não sobrevive ao recarregar: volta a usar a original
  return rest.proxyStatus === 'pending' ? { ...rest, proxyStatus: undefined } : rest;
}

/** assets usados pelo projeto (clipes + referência) — e os demais da biblioteca também ficam */
export function usedAssetIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of p.tracks) for (const c of t.clips) if ('assetId' in c && c.assetId) ids.add(c.assetId);
  if (p.referenceAssetId) ids.add(p.referenceAssetId);
  return ids;
}

export function coverFor(p: Project, assets: Record<string, MediaAsset>): string | undefined {
  for (const t of p.tracks) {
    if (t.kind !== 'video') continue;
    for (const c of t.clips) {
      if (!('assetId' in c) || !c.assetId) continue;
      const th = assets[c.assetId]?.thumbnails;
      if (th?.length) return th[Math.min(th.length - 1, Math.floor(th.length / 3))];
    }
  }
  return Object.values(assets).find((a) => a.role !== 'reference' && a.thumbnails?.length)?.thumbnails?.[0];
}

export function buildRecord(p: Project, messages: ChatMessage[], assets: Record<string, MediaAsset>): ProjectRecord {
  let clipCount = 0;
  for (const t of p.tracks) clipCount += t.clips.length;
  return {
    id: p.id,
    name: p.name,
    aspect: p.aspect,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    duration: projectDuration(p),
    clipCount,
    cover: coverFor(p, assets),
    project: p,
    // mensagens em andamento são salvas como concluídas (não ficam "pendentes" ao reabrir)
    messages: messages.map((m) =>
      m.status === 'pending' || m.status === 'streaming' || m.status === 'applying' ? { ...m, status: 'done' as const } : m,
    ),
    assets: Object.values(assets).map(stripAsset),
  };
}

export function summarize(r: ProjectRecord): ProjectSummary {
  const { project: _p, messages: _m, assets, ...rest } = r;
  return { ...rest, assetCount: assets.length };
}

/** projeto "vazio" (nada para salvar ainda) */
export function isBlank(p: Project, assets: Record<string, MediaAsset>, messages: ChatMessage[]): boolean {
  return p.tracks.every((t) => t.clips.length === 0) && !p.captions.segments.length && !Object.keys(assets).length && !messages.length && !p.brief;
}

/** blobs que não são mais referenciados por nenhum projeto */
export function orphanBlobIds(allBlobIds: string[], records: Pick<ProjectRecord, 'assets'>[], extraKeep: string[] = []): string[] {
  const keep = new Set<string>();
  for (const id of extraKeep) { keep.add(id); keep.add(proxyBlobId(id)); }
  for (const r of records) for (const a of r.assets) { keep.add(a.id); keep.add(proxyBlobId(a.id)); }
  return allBlobIds.filter((id) => !keep.has(id));
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush: () => void;
  cancel: () => void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const run = () => {
    timer = null;
    if (last) {
      const a = last;
      last = null;
      fn(...a);
    }
  };
  const d = ((...args: A) => {
    last = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;
  d.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  d.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    last = null;
  };
  return d;
}

/** "há 3 min", "ontem", "12/11" */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'agora mesmo';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  const dt = new Date(ts);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/* ---------- mídia recente (seletor dentro do app, entre projetos) ---------- */

/** item da galeria "Recentes": metadados do asset + quando entrou. O blob é o mesmo do asset (id). */
export interface RecentMedia { asset: StoredAsset; addedAt: number }

export const RECENTS_KEY = 'recentMedia';
export const RECENTS_MAX = 80;

/** coloca no topo (sem duplicar pelo id) e corta no máximo; devolve também os que saíram */
export function upsertRecent(list: RecentMedia[], item: RecentMedia, max = RECENTS_MAX): { list: RecentMedia[]; dropped: RecentMedia[] } {
  const rest = list.filter((r) => r.asset.id !== item.asset.id);
  const all = [item, ...rest];
  return { list: all.slice(0, max), dropped: all.slice(max) };
}

/** cabe guardar mais `size` bytes? deixa folga de 20% da cota (ou 200 MB, o que for menor) */
export function canKeep(estimate: { usage?: number; quota?: number } | null | undefined, size: number): boolean {
  if (!estimate?.quota) return true; // sem estimativa: o navegador decide
  const free = estimate.quota - (estimate.usage ?? 0);
  const reserve = Math.min(estimate.quota * 0.2, 200 * 1024 * 1024);
  return free - size > reserve;
}

/** recentes de um tipo (vídeo/foto/áudio), mais novos primeiro; vídeo Modelo não entra */
export function recentsOf(list: RecentMedia[], kind: MediaAsset['kind']): RecentMedia[] {
  return list.filter((r) => r.asset.kind === kind && r.asset.role !== 'reference').sort((a, b) => b.addedAt - a.addedAt);
}
