/* =====================================================================
   Exportação (dono: sessão "engine").
   - exportVideo: MP4/WebM renderizado no navegador
   - toSRT/toVTT: legendas
   - toFCPXML: projeto para DaVinci Resolve / Final Cut
   ===================================================================== */
import type { MediaAsset, Project } from '../types';
import type { ExportOptions } from './options';
export type { ExportOptions } from './options';
export { exportSize, videoBitrate, QUALITY_LABELS, hasWebCodecs } from './options';

/** renderiza o vídeo final no navegador (encoder/muxers carregados sob demanda) */
export async function exportVideo(p: Project, assets: Record<string, MediaAsset>, opts: ExportOptions): Promise<Blob> {
  const mod = await import('./video');
  return mod.exportVideo(p, assets, opts);
}
export { toSRT, toVTT, captionCues } from './subtitles';
export { toFCPXML, rational, timebase } from './fcpxml';
export { mixProjectAudio } from './audioMix';

/** dispara o download de um Blob/texto no navegador */
export function downloadBlob(data: Blob | string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** nome de arquivo seguro a partir do nome do projeto */
export function safeFileName(name: string, ext: string): string {
  const base = (name || 'editorpro')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'editorpro';
  return `${base}.${ext}`;
}
