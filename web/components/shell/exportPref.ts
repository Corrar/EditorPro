'use client';
/* padrão de exportação escolhido na pílula "1080p ▾" do editor no celular (v2.3).
   Fica no aparelho (localStorage 'ep_export_pref') e vai junto no evento ep:open-export. */
import { create } from 'zustand';
import { emit } from '@/lib/events';

export type ExportPrefQuality = 'hd' | 'fhd' | '4k';
export interface ExportPref { quality: ExportPrefQuality; fps: 24 | 30 | 60 }
export const EXPORT_PREF_KEY = 'ep_export_pref';
export const RES_LABEL: Record<ExportPrefQuality, string> = { hd: '720p', fhd: '1080p', '4k': '4K' };

function read(): ExportPref {
  try {
    const v = JSON.parse(localStorage.getItem(EXPORT_PREF_KEY) || 'null');
    if (v && ['hd', 'fhd', '4k'].includes(v.quality) && [24, 30, 60].includes(v.fps)) return v;
  } catch { /* sem armazenamento */ }
  return { quality: 'fhd', fps: 30 };
}

export const useExportPref = create<ExportPref & { set: (p: Partial<ExportPref>) => void }>((set, get) => ({
  ...(typeof window === 'undefined' ? { quality: 'fhd' as const, fps: 30 as const } : read()),
  set: (p) => {
    set(p);
    const { quality, fps } = get();
    try { localStorage.setItem(EXPORT_PREF_KEY, JSON.stringify({ quality, fps })); } catch { /* ok */ }
  },
}));

export function openExport() {
  const { quality, fps } = useExportPref.getState();
  emit('ep:open-export', { quality, fps });
}
