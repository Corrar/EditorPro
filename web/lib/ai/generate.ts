/* =====================================================================
   Geração de vídeo por IA (futuro: LongCat-Video, MIT) — tipos + cliente.
   Estrutura pronta para ligar; hoje o servidor responde 501 (sem GPU).
   - text-to-video: B-roll a partir de texto
   - image-to-video: animar uma foto
   - extend: continuar/estender um clipe
   - avatar: pessoa falando a partir de um áudio
   O vídeo gerado vira um asset role 'broll' via emit('ep:attach-files').
   ===================================================================== */
import { emit } from '../events';

export const GEN_KINDS = ['text-to-video', 'image-to-video', 'extend', 'avatar'] as const;
export type GenKind = (typeof GEN_KINDS)[number];

export interface GenParams {
  prompt?: string;
  /** imagem/vídeo/áudio de entrada (URL pública ou data URL pequena) */
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  /** segundos desejados */
  duration?: number;
  aspect?: '9:16' | '16:9' | '1:1' | '4:5';
  seed?: number;
}

export interface GenJob { kind: GenKind; params: GenParams }
export type GenStatus = 'queued' | 'running' | 'done' | 'error';
export interface GenPoll { status: GenStatus; progress?: number; url?: string; error?: string }

/** contrato de um provedor (implementado no servidor, ex.: worker LongCat em GPU) */
export interface GenerationProvider {
  id: string;
  label: string;
  capabilities: GenKind[];
  start(job: GenJob): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<GenPoll>;
}

export interface GenProbe { configured: boolean; capabilities: GenKind[]; motivo?: string }

export class GenClientError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { motivo?: string; error?: string };
  if (!res.ok) throw new GenClientError(data.motivo || data.error || `Erro ${res.status} na geração`, res.status);
  return data;
}

/** o servidor tem gerador configurado? */
export async function probeGeneration(fetchImpl: typeof fetch = fetch): Promise<GenProbe> {
  try {
    const res = await fetchImpl('/api/gen/status?probe=1', { credentials: 'same-origin' });
    return (await res.json()) as GenProbe;
  } catch {
    return { configured: false, capabilities: [], motivo: 'sem conexão' };
  }
}

export interface RequestOptions {
  onProgress?: (status: GenStatus, progress?: number) => void;
  signal?: AbortSignal;
  /** intervalo entre consultas (ms) */
  intervalMs?: number;
  /** desiste depois de (ms) — vídeo em GPU pode levar minutos */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** inicia a geração e faz polling até terminar; devolve a URL do vídeo */
export async function requestGeneration(kind: GenKind, params: GenParams, opts: RequestOptions = {}): Promise<{ url: string; jobId: string }> {
  const f = opts.fetchImpl ?? fetch;
  const wait = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { jobId } = await json<{ jobId: string }>(
    await f('/api/gen/start', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, params }), signal: opts.signal }),
  );
  const t0 = Date.now();
  const timeout = opts.timeoutMs ?? 20 * 60_000;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Geração cancelada', 'AbortError');
    const st = await json<GenPoll>(await f(`/api/gen/status?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin', signal: opts.signal }));
    opts.onProgress?.(st.status, st.progress);
    if (st.status === 'done') {
      if (!st.url) throw new GenClientError('A geração terminou sem vídeo.', 502);
      return { url: st.url, jobId };
    }
    if (st.status === 'error') throw new GenClientError(st.error || 'A geração falhou.', 502);
    if (Date.now() - t0 > timeout) throw new GenClientError('A geração demorou demais.', 504);
    await wait(opts.intervalMs ?? 3000);
  }
}

/** baixa o vídeo gerado e entrega ao shell como mídia de apoio (role 'broll') */
export async function attachGenerated(url: string, name: string, fetchImpl: typeof fetch = fetch): Promise<File> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new GenClientError('Não consegui baixar o vídeo gerado.', res.status);
  const blob = await res.blob();
  const file = new File([blob], name.endsWith('.mp4') || name.endsWith('.webm') ? name : `${name}.mp4`, { type: blob.type || 'video/mp4' });
  emit('ep:attach-files', { files: [file], role: 'broll' });
  return file;
}
