'use client';
/* =====================================================================
   Biblioteca · favoritos e recentes (por tipo de item), salvos no
   navegador (localStorage, por usuário/aparelho). Puro + store zustand.
   ===================================================================== */
import { create } from 'zustand';

export type LibKind = 'caption' | 'template' | 'font' | 'anim' | 'look' | 'sfx';
export const RECENT_MAX = 12;
const KEY = 'ep-lib-prefs-v1';

export interface LibPrefs {
  favorites: Record<LibKind, string[]>;
  recents: Record<LibKind, string[]>;
}

const empty = (): Record<LibKind, string[]> => ({ caption: [], template: [], font: [], anim: [], look: [], sfx: [] });

/** coloca `id` no topo da lista de recentes (sem duplicar, limitado) — puro */
export function pushRecentList(list: string[], id: string, max = RECENT_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** liga/desliga favorito — puro */
export function toggleFavList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
}

function load(): LibPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const j = JSON.parse(raw) as Partial<LibPrefs>;
      return { favorites: { ...empty(), ...(j.favorites ?? {}) }, recents: { ...empty(), ...(j.recents ?? {}) } };
    }
  } catch { /* sem armazenamento */ }
  return { favorites: empty(), recents: empty() };
}

function save(p: LibPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sem armazenamento */ }
}

interface PrefsStore extends LibPrefs {
  loaded: boolean;
  hydrate: () => void;
  toggleFav: (kind: LibKind, id: string) => void;
  pushRecent: (kind: LibKind, id: string) => void;
}

export const useLibPrefs = create<PrefsStore>((set, get) => ({
  favorites: empty(),
  recents: empty(),
  loaded: false,
  hydrate: () => { if (!get().loaded) set({ ...load(), loaded: true }); },
  toggleFav: (kind, id) => {
    const favorites = { ...get().favorites, [kind]: toggleFavList(get().favorites[kind], id) };
    set({ favorites });
    save({ favorites, recents: get().recents });
  },
  pushRecent: (kind, id) => {
    const recents = { ...get().recents, [kind]: pushRecentList(get().recents[kind], id) };
    set({ recents });
    save({ favorites: get().favorites, recents });
  },
}));
