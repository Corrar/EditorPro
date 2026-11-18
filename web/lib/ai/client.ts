/* =====================================================================
   Cliente de IA (navegador) — chama as rotas /api/ai/* (Claude no servidor).
   A chave da IA NUNCA vai para o cliente. O Claude só recebe texto e
   imagens: vídeo-exemplo vira quadros + métricas; fala vira transcrição
   (Whisper no navegador, ver whisper.ts).
   ===================================================================== */
import type { ChatMessage, MediaAsset, Project, StyleProfile } from '../types';
import type { EditOp } from '../ops';
import type { Frame } from './frames';
import type { ReferenceSample } from './analysis';
import { slimAssets } from './summary';

export interface AIStatus { configured: boolean; provider: 'anthropic' | 'demo'; model?: string }

export interface EditFrame extends Frame { assetId: string }

export interface EditRequest {
  project: Project;
  assets: Record<string, MediaAsset>;
  messages: ChatMessage[];
  userText: string;
  /** 'first' = primeira edição a partir do brief; 'chat' = ajuste pontual (padrão) */
  mode?: 'first' | 'chat';
  /** miniaturas do material p/ o Claude "ver" o vídeo */
  frames?: EditFrame[];
}

export interface EditResponse {
  reply: string; // resposta em PT-BR para o chat
  ops: EditOp[]; // cada uma com `explain`
}

/** erro com código vindo da rota (ex.: 'rate_limited', 'not_configured', 'refusal') */
export class AIClientError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** corpo das rotas precisa ficar < 4 MB (limite da Vercel) */
export const MAX_BODY = 3_800_000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new AIClientError('Sem conexão com o servidor.', 0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && !data.code) throw new AIClientError('Sessão expirada — entre de novo.', 401, 'login');
    throw new AIClientError(data.error || `Erro ${res.status} na IA.`, res.status, data.code);
  }
  return data;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  const json = JSON.stringify(body);
  if (json.length > MAX_BODY) throw new AIClientError('Pedido grande demais para enviar à IA.', 413, 'too_big');
  return call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
}

let statusCache: Promise<AIStatus> | null = null;

export async function getStatus(force = false): Promise<AIStatus> {
  if (!statusCache || force) {
    statusCache = call<AIStatus>('/api/ai/status').catch(() => ({ configured: false, provider: 'demo' as const }));
  }
  return statusCache;
}

/** analisa o vídeo-exemplo (quadros + métricas medidas no navegador) e extrai o perfil de estilo */
export async function analyzeReference(sample: ReferenceSample): Promise<StyleProfile> {
  let frames = sample.frames;
  // garante o limite do corpo, descartando quadros alternados se preciso
  while (frames.length > 4 && JSON.stringify(frames).length > MAX_BODY - 50_000) frames = frames.filter((_, i) => i % 2 === 0);
  const { style } = await postJson<{ style: StyleProfile }>('/api/ai/analyze-reference', { frames, metrics: sample.metrics });
  return style;
}

/** pedido em linguagem natural -> resposta + operações de edição */
export async function requestEdit(req: EditRequest): Promise<EditResponse> {
  const base = {
    project: req.project,
    assets: slimAssets(req.assets),
    messages: req.messages.slice(-12).map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })),
    userText: req.userText,
    mode: req.mode ?? 'chat',
  };
  let frames = req.frames ?? [];
  const baseLen = JSON.stringify(base).length;
  while (frames.length && baseLen + JSON.stringify(frames).length > MAX_BODY) frames = frames.length > 2 ? frames.filter((_, i) => i % 2 === 0) : [];
  const { reply, ops } = await postJson<EditResponse>('/api/ai/edit', { ...base, frames });
  return { reply, ops };
}
