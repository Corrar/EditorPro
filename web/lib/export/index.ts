/* =====================================================================
   Exportação (dono: sessão "engine").
   - exportVideo: MP4/WebM renderizado no navegador
   - toSRT/toVTT: legendas
   - toFCPXML: projeto para DaVinci Resolve / Final Cut
   ===================================================================== */
import type { MediaAsset, Project } from '../types';
import type { ExportOptions } from './options';
export type { ExportOptions } from './options';
export type { ExportQuality } from './options';
export { exportSize, exportFps, videoBitrate, QUALITY_LABELS, QUALITY_ORDER, hasWebCodecs } from './options';
export { encodeWAV } from './wav';
export type { AudioExportOptions } from './extras';

/** só o áudio do projeto: WAV (sempre) ou M4A/AAC (se o navegador codificar AAC) */
export async function exportAudio(p: Project, assets: Record<string, MediaAsset>, opts: import('./extras').AudioExportOptions): Promise<Blob> {
  return (await import('./extras')).exportAudio(p, assets, opts);
}
export async function canExportM4A(): Promise<boolean> {
  return (await import('./extras')).canExportM4A();
}
/** quadro atual como imagem PNG */
export async function exportFrame(p: Project, assets: Record<string, MediaAsset>, t: number, quality?: import('./options').ExportQuality): Promise<Blob> {
  return (await import('./extras')).exportFrame(p, assets, t, quality);
}

/** renderiza o vídeo final no navegador (encoder/muxers carregados sob demanda) */
export async function exportVideo(p: Project, assets: Record<string, MediaAsset>, opts: ExportOptions): Promise<Blob> {
  const mod = await import('./video');
  return mod.exportVideo(p, assets, opts);
}
/** caminho de export disponível neste navegador (WebCodecs rápido, MediaRecorder em tempo real ou nenhum) */
export async function detectExportPath(format: ExportOptions['format']) {
  const mod = await import('./video');
  return mod.detectExportPath(format);
}

/** compartilha/salva um arquivo pelo menu nativo (iOS/Android); false se indisponível */
export async function shareFile(blob: Blob, filename: string): Promise<boolean> {
  try {
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!nav.share || !nav.canShare?.({ files: [file] })) return false;
    await nav.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    return (e as Error)?.name === 'AbortError'; // usuário fechou o menu: não é erro
  }
}

/** compartilha vários arquivos de uma vez (ex.: vídeo + capa); cai para só o primeiro se o navegador não aceitar todos */
export async function shareFiles(items: { blob: Blob; name: string }[]): Promise<boolean> {
  if (!items.length) return false;
  try {
    const files = items.map((i) => new File([i.blob], i.name, { type: i.blob.type }));
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && files.length > 1 && nav.canShare?.({ files })) {
      await nav.share({ files, title: items[0].name });
      return true;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return true;
  }
  return shareFile(items[0].blob, items[0].name);
}

export function canShareFiles(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return !!nav.share && !!nav.canShare?.({ files: [new File([''], 'x.mp4', { type: 'video/mp4' })] });
  } catch { return false; }
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
