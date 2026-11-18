/* opções de export e cálculo de tamanho/bitrate (puro) */
import type { Project } from '../types';

export type ExportQuality = 'draft' | 'hd' | 'fhd' | '4k' | 'full';

export interface ExportOptions {
  format: 'mp4' | 'webm';
  /** 540p / 720p / 1080p / 4K (2160p) / resolução do projeto */
  quality: ExportQuality;
  /** quadros por segundo (24/30/60); padrão = fps do projeto */
  fps?: number;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

export const QUALITY_SHORT: Record<Exclude<ExportQuality, 'full'>, number> = { draft: 540, hd: 720, fhd: 1080, '4k': 2160 };
/** ordem decrescente p/ cair de qualidade quando o aparelho não aguenta */
export const QUALITY_ORDER: ExportQuality[] = ['4k', 'fhd', 'full', 'hd', 'draft'];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** tamanho de saída: o lado MENOR vira 540/720 (rascunho/HD); full = resolução do projeto */
export function exportSize(p: Pick<Project, 'width' | 'height'>, quality: ExportOptions['quality']): { width: number; height: number } {
  const short = Math.min(p.width, p.height);
  const target = quality === 'full' ? short : QUALITY_SHORT[quality] ?? short;
  // 540p/720p só reduzem; 1080p/4K podem ampliar (projeto menor que o alvo)
  const k = quality === 'fhd' || quality === '4k' ? target / short : Math.min(1, target / short);
  return { width: even(p.width * k), height: even(p.height * k) };
}

/** fps de export válido (24/25/30/50/60), padrão = fps do projeto */
export function exportFps(p: Pick<Project, 'fps'>, fps?: number): number {
  const f = fps ?? p.fps ?? 30;
  return Math.max(1, Math.min(60, Math.round(f)));
}

/** bitrate de vídeo alvo (~0.12 bit por pixel por quadro, limitado) */
export function videoBitrate(w: number, h: number, fps: number): number {
  return Math.round(Math.min(40_000_000, Math.max(1_500_000, w * h * fps * 0.1)));
}

export const QUALITY_LABELS: Record<ExportOptions['quality'], string> = {
  draft: 'Rascunho 540p', hd: 'HD 720p', fhd: 'Full HD 1080p', '4k': '4K 2160p', full: 'Original (resolução do projeto)',
};

export function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}
