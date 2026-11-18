/* opções de export e cálculo de tamanho/bitrate (puro) */
import type { Project } from '../types';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  quality: 'draft' | 'hd' | 'full'; // 540p / 720p / resolução do projeto
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** tamanho de saída: o lado MENOR vira 540/720 (rascunho/HD); full = resolução do projeto */
export function exportSize(p: Pick<Project, 'width' | 'height'>, quality: ExportOptions['quality']): { width: number; height: number } {
  const short = Math.min(p.width, p.height);
  const target = quality === 'draft' ? 540 : quality === 'hd' ? 720 : short;
  const k = Math.min(1, target / short);
  return { width: even(p.width * k), height: even(p.height * k) };
}

/** bitrate de vídeo alvo (~0.12 bit por pixel por quadro, limitado) */
export function videoBitrate(w: number, h: number, fps: number): number {
  return Math.round(Math.min(16_000_000, Math.max(1_500_000, w * h * fps * 0.12)));
}

export const QUALITY_LABELS: Record<ExportOptions['quality'], string> = {
  draft: 'Rascunho 540p', hd: 'HD 720p', full: 'Full (resolução do projeto)',
};

export function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}
