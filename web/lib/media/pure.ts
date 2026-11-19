/* =====================================================================
   Mídia — funções puras (testadas em pure.test.ts). Sem DOM.
   ===================================================================== */
import type { MediaKind, MediaRole } from '../types';

const EXT: Record<string, MediaKind> = {
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', avi: 'video', '3gp': 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', opus: 'audio', weba: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', svg: 'image', heic: 'image',
};

/** tipo de mídia pelo mime (ou extensão, se o navegador não informar). null = não suportado */
export function mediaKindOf(mime: string, name = ''): MediaKind | null {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXT[ext] ?? null;
}

/** papel padrão: áudio solto vira música; o resto, material (a menos que pedido outro) */
export function defaultRoleFor(kind: MediaKind, requested?: MediaRole): MediaRole {
  if (requested) return requested;
  return kind === 'audio' ? 'music' : 'source';
}

export const ROLE_LABEL: Record<MediaRole, string> = {
  source: 'Material',
  reference: 'Modelo',
  music: 'Música',
  broll: 'B-roll',
  graphic: 'Gráfico (IA)',
};

/** quantos picos guardar para uma duração (≈50/s, entre 64 e 6000) */
export function peakCountFor(duration: number): number {
  if (!isFinite(duration) || duration <= 0) return 64;
  return Math.max(64, Math.min(6000, Math.round(duration * 50)));
}

/**
 * reduz amostras PCM (1+ canais) a `count` picos normalizados 0..1
 * (máximo absoluto por janela, normalizado pelo maior pico global).
 */
export function reducePeaks(channels: ArrayLike<number>[], count: number): number[] {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const n = Math.max(1, Math.floor(count));
  if (!len) return new Array(n).fill(0);
  const out = new Array<number>(n).fill(0);
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let peak = 0;
    for (const ch of channels) {
      const end = Math.min(b, ch.length);
      for (let j = a; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > peak) peak = v;
      }
    }
    out[i] = peak;
  }
  const max = out.reduce((m, v) => (v > m ? v : m), 0);
  if (max <= 0) return out;
  return out.map((v) => Math.round((v / max) * 1000) / 1000);
}

/** tempos (s) para tirar `n` miniaturas espaçadas uniformemente (centro de cada fatia) */
export function thumbTimes(duration: number, n: number): number[] {
  if (!isFinite(duration) || duration <= 0 || n <= 0) return [0];
  const k = Math.max(1, Math.floor(n));
  return Array.from({ length: k }, (_, i) => Math.min(duration - 0.05, ((i + 0.5) * duration) / k)).map((t) =>
    Math.max(0, Math.round(t * 1000) / 1000),
  );
}

/** quantas miniaturas para uma duração (10–20) */
export function thumbCountFor(duration: number): number {
  if (!isFinite(duration) || duration <= 0) return 1;
  return Math.max(10, Math.min(20, Math.round(duration / 3)));
}

/** tamanho da miniatura mantendo proporção, com altura alvo */
export function thumbSize(w: number, h: number, targetH = 96): { width: number; height: number } {
  if (!w || !h) return { width: Math.round(targetH * (16 / 9)), height: targetH };
  const height = Math.min(targetH, h);
  return { width: Math.max(1, Math.round((w / h) * height)), height };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** vídeo que o navegador abriu mas não decodifica (HEVC/HDR sem suporte): sem dimensões ou sem nenhum quadro */
export function looksUndecodable(v: { width?: number; height?: number; thumbCount: number; duration: number }): boolean {
  if (!v.width || !v.height) return true;
  return v.duration > 0 && v.thumbCount === 0;
}

export const UNDECODABLE_MSG = (name: string) =>
  `Este aparelho não consegue ler "${name}" (formato como HEVC/HDR). Grave em H.264 ("Mais compatível" na câmera) ou converta antes de enviar.`;
