/* =====================================================================
   "Conferindo o resultado…": renderiza 3–4 quadros do RESULTADO da edição
   (fora da tela, com o mesmo motor e o mesmo carregamento de mídia do
   export) para o Claude conferir e mandar ajustes (mode 'review').
   ===================================================================== */
import type { Clip, MediaAsset, Project } from '../types';
import { projectDuration } from '../ops';
import type { EditFrame } from './client';

const PREF_KEY = 'ep:ai-review';

/** preferência "IA confere o resultado" (padrão: ligada) */
export function reviewEnabled(): boolean {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}
export function setReviewEnabled(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* sem storage */ }
}

/** ops que mudam o visual (texto, gráfico, efeito, cor, transformação…) valem uma conferência */
export function isVisualChange(before: Project, after: Project): boolean {
  const vis = (p: Project) => JSON.stringify(p.tracks.filter((t) => t.kind !== 'audio').map((t) => t.clips.map((c) => { const { start: _s, duration: _d, ...rest } = c as Clip & Record<string, unknown>; return rest; })));
  return vis(before) !== vis(after) || JSON.stringify(before.captions.style) !== JSON.stringify(after.captions.style);
}

/** onde olhar: os trechos que mudaram (clipes novos/alterados), senão espalhado pelo vídeo */
export function reviewTimes(before: Project, after: Project, max = 4): number[] {
  const dur = projectDuration(after);
  if (dur <= 0) return [];
  const old = new Map(before.tracks.flatMap((t) => t.clips).map((c) => [c.id, JSON.stringify(c)]));
  const changed = after.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).filter((c) => old.get(c.id) !== JSON.stringify(c));
  const pts = changed.map((c) => Math.min(dur - 0.05, c.start + Math.min(c.duration * 0.5, 1.2)));
  const out: number[] = [];
  for (const t of pts.sort((a, b) => a - b)) if (out.every((x) => Math.abs(x - t) > 0.5)) out.push(t);
  if (out.length > max) { const step = out.length / max; return Array.from({ length: max }, (_, i) => +out[Math.floor(i * step)].toFixed(2)); }
  for (const f of [0.15, 0.5, 0.85, 0.3]) { if (out.length >= Math.min(max, 3)) break; const t = dur * f; if (out.every((x) => Math.abs(x - t) > 0.5)) out.push(t); }
  return out.sort((a, b) => a - b).map((t) => +Math.max(0, t).toFixed(2));
}

/** navegador: renderiza os quadros do resultado (JPEG, lado maior ~720 px) */
export async function renderResultFrames(p: Project, assets: Record<string, MediaAsset>, times: number[]): Promise<EditFrame[]> {
  if (typeof document === 'undefined' || !times.length) return [];
  const [{ OfflineMediaPool }, { renderFrame }, { visualLayers, sourceTime }] = await Promise.all([
    import('../export/mediaPool'), import('../engine'), import('../engine/timing'),
  ]);
  const scale = Math.min(1, 720 / Math.max(p.width, p.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(p.width * scale));
  canvas.height = Math.max(2, Math.round(p.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const pool = new OfflineMediaPool(assets);
  const out: EditFrame[] = [];
  try {
    await pool.preloadImages();
    for (const t of times) {
      const plan = visualLayers(p, t)
        .filter((l) => l.clip.type === 'video' || (l.clip.type === 'image' && (l.clip as { removeBackground?: boolean }).removeBackground))
        .map((l) => ({ clip: l.clip, time: sourceTime(l.clip, t) }));
      await pool.prepare(plan);
      renderFrame(ctx, p, t, pool);
      const data = canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? '';
      if (data) out.push({ assetId: 'resultado', t, data, mediaType: 'image/jpeg' });
    }
  } catch (e) {
    console.warn('[ai/review] não consegui renderizar o resultado:', e);
  } finally {
    pool.dispose();
  }
  return out;
}
