/* =====================================================================
   Ferramentas de visualização do preview (puro, testado em viewing.test.ts):
   velocidade de reprodução, loop do trecho, quadro a quadro, zoom do quadro,
   zonas seguras por plataforma, comparação antes/depois e guias de encaixe
   ao arrastar texto/sticker.
   ===================================================================== */
import type { Clip, Id, Project, Seconds } from '@/lib/types';
import { projectDuration } from '@/lib/ops';

/* ---------- velocidade / loop / quadro a quadro ---------- */

export const PLAY_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlayRate = (typeof PLAY_RATES)[number];

export function rateLabel(r: number): string {
  return `${String(r).replace('.', ',')}×`;
}

/** trecho do loop: o clipe selecionado (1 só) ou o projeto inteiro */
export function loopRange(p: Project, selection: Id[]): { start: Seconds; end: Seconds; label: string } {
  const d = projectDuration(p);
  if (selection.length === 1) {
    for (const tr of p.tracks) {
      const c = tr.clips.find((x) => x.id === selection[0]);
      if (c && c.duration > 0.05) {
        const start = Math.max(0, c.start), end = Math.min(d, c.start + c.duration);
        if (end - start > 0.05) return { start, end, label: 'clipe selecionado' };
      }
    }
  }
  return { start: 0, end: d, label: 'vídeo inteiro' };
}

/** tempo seguinte com loop: passou do fim → volta ao início do trecho */
export function wrapLoop(t: Seconds, range: { start: Seconds; end: Seconds }): { t: Seconds; wrapped: boolean } {
  if (t >= range.end - 1e-3) return { t: range.start, wrapped: true };
  if (t < range.start - 0.05) return { t: range.start, wrapped: true };
  return { t, wrapped: false };
}

/** um quadro para frente/trás, alinhado à grade de quadros do projeto */
export function stepFrame(t: Seconds, fps: number, dir: 1 | -1, duration: Seconds): Seconds {
  const f = Math.max(1, fps || 30);
  const idx = Math.round(t * f) + dir;
  const max = Math.max(0, Math.floor(duration * f - 1e-6));
  return Math.min(max, Math.max(0, idx)) / f;
}

/* ---------- zoom do quadro ---------- */

export type ViewZoom = 'fit' | 100 | 200;
export const VIEW_ZOOMS: ViewZoom[] = ['fit', 100, 200];
export const zoomLabel = (z: ViewZoom) => (z === 'fit' ? 'Ajustar' : `${z}%`);

/**
 * Escala px CSS por px do projeto. 'fit' = cabe no palco; 100% = 1 px do projeto por px físico
 * da tela (nitidez real); 200% = o dobro.
 */
export function zoomScale(z: ViewZoom, fitK: number, dpr: number): number {
  if (z === 'fit') return fitK;
  return (z / 100) / Math.max(1, dpr || 1);
}

/* ---------- zonas seguras por plataforma ---------- */

export type SafePlatform = 'tiktok' | 'reels' | 'shorts';
export const SAFE_LABELS: Record<SafePlatform, string> = { tiktok: 'TikTok', reels: 'Reels', shorts: 'Shorts' };

/** margens (fração do quadro 9:16) cobertas pela interface de cada app */
export const SAFE_ZONES: Record<SafePlatform, { top: number; bottom: number; left: number; right: number }> = {
  tiktok: { top: 0.07, bottom: 0.2, left: 0.05, right: 0.13 },
  reels: { top: 0.11, bottom: 0.22, left: 0.05, right: 0.12 },
  shorts: { top: 0.08, bottom: 0.18, left: 0.05, right: 0.17 },
};

/* ---------- antes/depois ---------- */

/** o "antes": mesmos cortes, posições e textos, mas sem looks, filtros, efeitos e correção de cor */
export function stripLooks(p: Project): Project {
  return {
    ...p,
    tracks: p.tracks.map((tr) => {
      if (tr.kind === 'effect') return { ...tr, hidden: true };
      if (tr.kind !== 'video' && tr.kind !== 'overlay') return tr;
      return {
        ...tr,
        clips: tr.clips.map((c) => {
          if (c.type !== 'video' && c.type !== 'image') return c;
          const n = { ...c, filters: [] } as Clip & Record<string, unknown>;
          delete n.colorPreset;
          delete n.effects;
          delete n.colorGrade;
          return n as Clip;
        }),
      };
    }),
  };
}

/* ---------- guias de encaixe ao arrastar ---------- */

export interface SnapResult { value: number; guide: number | null }

/** encaixa v no alvo mais próximo dentro do limite (frações do quadro) */
export function snapTo(v: number, targets: number[], threshold = 0.015): SnapResult {
  let best: number | null = null, bestD = threshold;
  for (const g of targets) {
    const d = Math.abs(v - g);
    if (d <= bestD) { bestD = d; best = g; }
  }
  return best === null ? { value: v, guide: null } : { value: best, guide: best };
}

/** alvos de encaixe: centro, terços e (opcional) bordas da zona segura */
export function snapTargets(axis: 'x' | 'y', safe?: { top: number; bottom: number; left: number; right: number }): number[] {
  const t = [0.5, 1 / 3, 2 / 3];
  if (safe) t.push(...(axis === 'x' ? [safe.left, 1 - safe.right] : [safe.top, 1 - safe.bottom]));
  return t;
}
