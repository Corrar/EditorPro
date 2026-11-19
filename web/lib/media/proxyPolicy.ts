/* política do proxy de preview (puro, testado): quais vídeos ganham uma cópia leve p/ editar */
export interface ProxyCandidate { kind: string; width?: number; height?: number; mime?: string; name?: string }

export const PROXY_MAX_HEIGHT = 720;

export function needsProxy(a: ProxyCandidate): boolean {
  if (a.kind !== 'video') return false;
  const short = Math.min(a.width || 0, a.height || 0);
  if (short > PROXY_MAX_HEIGHT) return true; // acima de 720p
  const id = `${a.mime ?? ''} ${a.name ?? ''}`.toLowerCase();
  return /hevc|hvc1|hev1|h265|\.heic|\.hevc/.test(id); // HEVC pesa no navegador
}
