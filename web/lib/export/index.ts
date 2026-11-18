/* =====================================================================
   Exportação — CONTRATO (dono: sessão "engine").
   ===================================================================== */
import type { MediaAsset, Project } from '../types';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  quality: 'draft' | 'hd' | 'full'; // 540p / 720p / resolução do projeto
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

/** renderiza o vídeo final no navegador */
export async function exportVideo(_p: Project, _assets: Record<string, MediaAsset>, _opts: ExportOptions): Promise<Blob> {
  throw new Error('export: exportVideo ainda não implementado');
}

/** legendas em SRT */
export function toSRT(_p: Project): string {
  throw new Error('export: toSRT ainda não implementado');
}

/** FCPXML 1.9 — abre em DaVinci Resolve, Final Cut, Premiere (via import) */
export function toFCPXML(_p: Project, _assets: Record<string, MediaAsset>): string {
  throw new Error('export: toFCPXML ainda não implementado');
}
