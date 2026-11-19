/* opções de export e cálculo de tamanho/bitrate (puro) */
import type { Project } from '../types';

export type ExportQuality = 'draft' | 'hd' | 'fhd' | '4k' | 'full';
export type ExportSpeed = 'rapido' | 'equilibrado' | 'qualidade';

/** bits por pixel por quadro e intervalo de quadro-chave (s) por modo de velocidade */
export const SPEED_PROFILE: Record<ExportSpeed, { bpp: number; keyEvery: number; hardware: 'prefer-hardware' | 'no-preference' }> = {
  rapido: { bpp: 0.08, keyEvery: 3, hardware: 'prefer-hardware' },
  equilibrado: { bpp: 0.1, keyEvery: 2, hardware: 'prefer-hardware' },
  qualidade: { bpp: 0.15, keyEvery: 2, hardware: 'no-preference' },
};

export const SPEED_LABELS: Record<ExportSpeed, string> = { rapido: 'Rápido', equilibrado: 'Equilibrado', qualidade: 'Máxima qualidade' };

export interface ExportOptions {
  format: 'mp4' | 'webm';
  /** 540p / 720p / 1080p / 4K (2160p) / resolução do projeto */
  quality: ExportQuality;
  /** quadros por segundo (24/30/60); padrão = fps do projeto */
  fps?: number;
  /** rapidez × qualidade do encoder (padrão 'equilibrado'): rápido = hardware + bitrate menor + chave a cada 3 s */
  speed?: ExportSpeed;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
  /** aviso p/ mostrar no resultado (ex.: 'O áudio de "x.mp4" não pôde ser incluído (…)'); o export continua */
  onWarning?: (message: string) => void;
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

/** bitrate de vídeo alvo (bits por pixel por quadro conforme a velocidade, limitado) */
export function videoBitrate(w: number, h: number, fps: number, speed: ExportSpeed = 'equilibrado'): number {
  return Math.round(Math.min(50_000_000, Math.max(1_200_000, w * h * fps * SPEED_PROFILE[speed].bpp)));
}

/**
 * Tempo estimado de export (s) p/ mostrar no diálogo. Calibrado no Chromium de desktop
 * com o decodificador sequencial: custo por quadro ∝ pixels de saída; celular ~2,5× mais lento.
 */
export function estimateExportSeconds(duration: number, fps: number, w: number, h: number, o: { speed?: ExportSpeed; mobile?: boolean } = {}): number {
  const mpx = (w * h) / 1e6;
  const perFrameMs = 4 + 9 * mpx * (o.speed === 'qualidade' ? 1.25 : o.speed === 'rapido' ? 0.85 : 1);
  const s = (duration * fps * perFrameMs) / 1000 * (o.mobile ? 2.5 : 1) + 2;
  return Math.round(s);
}

/** estimativa direto do projeto (qualidade/fps/velocidade do diálogo) */
export function estimateProjectExport(p: Pick<Project, 'width' | 'height' | 'fps'>, duration: number, o: { quality: ExportQuality; fps?: number; speed?: ExportSpeed; mobile?: boolean }): number {
  const { width, height } = exportSize(p, o.quality);
  return estimateExportSeconds(duration, exportFps(p, o.fps), width, height, o);
}

export const QUALITY_LABELS: Record<ExportOptions['quality'], string> = {
  draft: 'Rascunho 540p', hd: 'HD 720p', fhd: 'Full HD 1080p', '4k': '4K 2160p', full: 'Original (resolução do projeto)',
};

export function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}
