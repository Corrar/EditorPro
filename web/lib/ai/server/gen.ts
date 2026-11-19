/* =====================================================================
   Geração de vídeo por IA — SERVIDOR (estrutura pronta, desligada por padrão).
   Hoje responde 501 "GPU não configurada". Para ligar (ex.: worker LongCat-Video
   numa GPU serverless): GEN_PROVIDER=http, GEN_ENDPOINT=https://…, GEN_API_KEY=…
   (opcional GEN_CAPABILITIES=text-to-video,image-to-video,extend,avatar).

   Protocolo do provider 'http' (o worker implementa):
     POST GEN_ENDPOINT  {action:'start', kind, params}   -> {jobId}
     POST GEN_ENDPOINT  {action:'status', jobId}         -> {status, progress?, url?, error?}
     Authorization: Bearer GEN_API_KEY
   ===================================================================== */
import { COOKIE_NAME, isValidSession } from '@/lib/auth';
import { GEN_KINDS, type GenKind, type GenPoll, type GenerationProvider } from '../generate';

export class GenError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function capsFromEnv(): GenKind[] {
  const raw = process.env.GEN_CAPABILITIES?.split(',').map((s) => s.trim()) ?? [];
  const list = raw.filter((k): k is GenKind => (GEN_KINDS as readonly string[]).includes(k));
  return list.length ? list : [...GEN_KINDS];
}

/** provider genérico: repassa para um endpoint HTTP (worker em GPU) */
export function httpProvider(endpoint: string, apiKey: string, fetchImpl: typeof fetch = fetch): GenerationProvider {
  const call = async (body: unknown) => {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new GenError(String(data.error ?? `o gerador respondeu ${res.status}`), res.status >= 500 ? 502 : res.status);
    return data;
  };
  return {
    id: 'http',
    label: 'Gerador de vídeo (GPU)',
    capabilities: capsFromEnv(),
    async start(job) {
      const d = await call({ action: 'start', kind: job.kind, params: job.params });
      if (typeof d.jobId !== 'string' || !d.jobId) throw new GenError('o gerador não devolveu jobId', 502);
      return { jobId: d.jobId };
    },
    async poll(jobId) {
      const d = await call({ action: 'status', jobId });
      const status = ['queued', 'running', 'done', 'error'].includes(String(d.status)) ? (d.status as GenPoll['status']) : 'running';
      return {
        status,
        ...(typeof d.progress === 'number' ? { progress: Math.max(0, Math.min(1, d.progress)) } : {}),
        ...(typeof d.url === 'string' && /^https?:\/\//.test(d.url) ? { url: d.url } : {}),
        ...(typeof d.error === 'string' ? { error: d.error.slice(0, 300) } : {}),
      };
    },
  };
}

/** provider configurado pelo ambiente; null = desligado */
export function genProvider(): GenerationProvider | null {
  const kind = process.env.GEN_PROVIDER?.trim();
  if (kind === 'http' && process.env.GEN_ENDPOINT?.trim()) return httpProvider(process.env.GEN_ENDPOINT.trim(), process.env.GEN_API_KEY?.trim() ?? '');
  return null;
}

/** mesma proteção do middleware (as rotas /api/gen/* ficam fora do matcher dele) */
export async function requireSession(req: Request): Promise<void> {
  const secret = process.env.DASH_PASSWORD || '';
  if (!secret && process.env.NODE_ENV !== 'production') return;
  const cookie = req.headers.get('cookie') ?? '';
  const value = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!(await isValidSession(value ? decodeURIComponent(value) : undefined, secret))) throw new GenError('não autorizado', 401);
}

export const NOT_CONFIGURED = { configured: false, motivo: 'GPU não configurada' } as const;
