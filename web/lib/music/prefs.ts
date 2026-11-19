'use client';
/* Música · favoritos e recentes (localStorage, por aparelho) */
import { create } from 'zustand';

const KEY = 'ep-music-prefs-v1';
const RECENT_MAX = 12;

interface MusicPrefs {
  favorites: string[];
  recents: string[];
  hydrated: boolean;
  hydrate: () => void;
  toggleFav: (id: string) => void;
  pushRecent: (id: string) => void;
}

function save(p: Pick<MusicPrefs, 'favorites' | 'recents'>) {
  try { localStorage.setItem(KEY, JSON.stringify({ favorites: p.favorites, recents: p.recents })); } catch { /* sem armazenamento */ }
}

export const useMusicPrefs = create<MusicPrefs>((set, get) => ({
  favorites: [],
  recents: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const j = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MusicPrefs>;
      set({ favorites: Array.isArray(j.favorites) ? j.favorites : [], recents: Array.isArray(j.recents) ? j.recents : [], hydrated: true });
    } catch { set({ hydrated: true }); }
  },
  toggleFav: (id) => {
    const f = get().favorites;
    const favorites = f.includes(id) ? f.filter((x) => x !== id) : [id, ...f];
    set({ favorites }); save({ ...get(), favorites });
  },
  pushRecent: (id) => {
    const recents = [id, ...get().recents.filter((x) => x !== id)].slice(0, RECENT_MAX);
    set({ recents }); save({ ...get(), recents });
  },
}));
