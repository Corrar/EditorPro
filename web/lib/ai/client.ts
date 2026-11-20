/* =====================================================================
   Cliente de IA (navegador) — chama as rotas /api/ai/* (Claude no servidor).
   A chave da IA NUNCA vai para o cliente. O Claude só recebe texto e
   imagens: vídeo-exemplo vira quadros + métricas; fala vira transcrição
   (Whisper no navegador, ver whisper.ts).
   ===================================================================== */
import type { ChatContext, ChatMessage, MediaAsset, Project, StyleProfile } from '../types';
import type { EditOp } from '../ops';
import type { Frame } from './frames';
import type { ReferenceSample } from './analysis';
import { slimAssets } from './summary';
import { MAX_REFERENCE_FRAMES } from './sanitize';

export interface AIStatus { configured: boolean; provider: 'anthropic' | 'demo'; model?: string; /** a checagem falhou (rede/sessão): não é demo de verdade, tenta de novo no próximo pedido */ offline?: boolean; /** transcrição no servidor disponível (Whisper large) */ transcribe?: 'groq' | 'openai' | null }

export interface EditFrame extends Frame { assetId: string }

export interface EditRequest {
  project: Project;
  assets: Record<string, MediaAsset>;
  messages: ChatMessage[];
  userText: string;
  /** 'first' = 1ª edição a partir do brief; 'chat' = ajuste pontual (padrão); 'comments' = aplicar comentários de revisão */
  mode?: 'first' | 'chat' | 'comments' | 'repair' | 'review';
  /** para onde o usuário apontou */
  context?: ChatContext;
  /** miniaturas do material p/ o Claude "ver" o vídeo */
  frames?: EditFrame[];
  /** cancela o pedido (Parar / projeto trocado) */
  signal?: AbortSignal;
}

export interface EditResponse {
  reply: string; // resposta em PT-BR para o chat
  ops: EditOp[]; // cada uma com `explain`
  /** respostas por comentário (modo 'comments') */
  comments?: { markerId: string; reply: string }[];
  /** efeitos sonoros da biblioteca pedidos pela IA (o navegador gera e insere) */
  sfx?: { sfxId: string; at: number; volume?: number; explain?: string }[];
  /** pedidos executados no navegador (script, gráfico, transcrição) */
  deferred?: unknown[];
  /** motivos das ops descartadas na validação do servidor (p/ conserto) */
  droppedReasons?: string[];
  /** mode 'review': o resultado está bom */
  ok?: boolean;
}

/** erro com código vindo da rota (ex.: 'rate_limited', 'not_configured', 'refusal') */
export class AIClientError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** corpo das rotas precisa ficar < 4 MB (limite da Vercel) */
export const MAX_BODY = 3_800_000;

/** um pouco acima do timeout do servidor (240 s): se a função for cortada, o navegador não fica esperando para sempre */
export const CLIENT_TIMEOUT_MS = 295_000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
  // signal do usuário (Parar / projeto trocado) soma com o timer
  const user = init?.signal;
  const onUser = () => ctrl.abort();
  if (user) { if (user.aborted) ctrl.abort(); else user.addEventListener('abort', onUser, { once: true }); }
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    user?.removeEventListener('abort', onUser);
    if (user?.aborted) { const err = new Error('Edição parada'); err.name = 'AbortError'; throw err; }
    if (ctrl.signal.aborted) throw new AIClientError('A IA demorou demais para responder. Tente de novo ou peça algo menor.', 504, 'timeout');
    throw new AIClientError('Sem conexão com o servidor.', 0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  clearTimeout(timer);
  user?.removeEventListener('abort', onUser);
  if (user?.aborted) { const err = new Error('Edição parada'); err.name = 'AbortError'; throw err; }
  if (!res.ok) {
    if (res.status === 401 && !data.code) throw new AIClientError('Sessão expirada — entre de novo.', 401, 'login');
    if ((res.status === 504 || res.status === 502) && !data.code) throw new AIClientError('A IA demorou demais para responder. Tente de novo ou peça algo menor.', res.status, 'timeout');
    if (res.status === 413 && !data.code) throw new AIClientError('Pedido grande demais para enviar à IA.', 413, 'too_big');
    throw new AIClientError(data.error || `Erro ${res.status} na IA.`, res.status, data.code);
  }
  return data;
}

function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const json = JSON.stringify(body);
  if (json.length > MAX_BODY) throw new AIClientError('Pedido grande demais para enviar à IA.', 413, 'too_big');
  return call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, ...(signal ? { signal } : {}) });
}

let statusCache: Promise<AIStatus> | null = null;

async function fetchStatus(): Promise<AIStatus> {
  try {
    return await call<AIStatus>('/api/ai/status');
  } catch {
    // rede instável no celular: 1 nova tentativa antes de cair no modo local
    await new Promise((r) => setTimeout(r, 700));
    return call<AIStatus>('/api/ai/status');
  }
}

/** status da IA no servidor. Falha (rede/sessão) NÃO fica em cache: o próximo pedido checa de novo. */
export async function getStatus(force = false): Promise<AIStatus> {
  if (!statusCache || force) {
    const p: Promise<AIStatus> = fetchStatus().catch(() => {
      if (statusCache === p) statusCache = null;
      return { configured: false, provider: 'demo' as const, offline: true };
    });
    statusCache = p;
  }
  return statusCache;
}

/** analisa o vídeo-exemplo (quadros + métricas medidas no navegador) e extrai o perfil de estilo */
export async function analyzeReference(sample: ReferenceSample): Promise<StyleProfile> {
  const { style } = await postJson<{ style: StyleProfile }>('/api/ai/analyze-reference', referencePayload(sample));
  return style;
}

/** `n` itens uniformemente espaçados (mantém a ordem) */
function spread<T>(l: T[], n: number): T[] {
  if (l.length <= n) return l;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, k) => l[Math.floor(((k + 0.5) * l.length) / n)]);
}

/**
 * Corpo do analyze-reference dentro dos limites da rota: ≤ MAX_REFERENCE_FRAMES quadros (a rota corta o
 * excedente do FIM — eram justamente os recortes da faixa de legenda) e < MAX_BODY contando as métricas.
 * Os quadros rotulados (pares do corte, começo/fim de tomada, recortes da legenda) têm prioridade: quem
 * diminui primeiro são os quadros comuns (~1/s); sondas só saem se não houver outro jeito, recortes por último.
 */
export function referencePayload(sample: Pick<ReferenceSample, 'frames' | 'metrics'>, maxFrames = MAX_REFERENCE_FRAMES, maxBody = MAX_BODY): { frames: Frame[]; metrics: ReferenceSample['metrics'] } {
  const metrics = sample.metrics;
  const isCrop = (f: Frame) => !!f.label && /FAIXA DE LEGENDA/.test(f.label);
  let probes = sample.frames.filter((f) => f.label);
  let plain = sample.frames.filter((f) => !f.label);
  probes = [...probes.filter((f) => !isCrop(f)).slice(0, Math.max(0, maxFrames - 4 - probes.filter(isCrop).length)), ...probes.filter(isCrop)].slice(-maxFrames);
  plain = spread(plain, maxFrames - probes.length);
  const fixed = JSON.stringify({ frames: [], metrics }).length + 64;
  const size = () => fixed + JSON.stringify(plain).length + JSON.stringify(probes).length;
  while (size() > maxBody && plain.length > 4) plain = spread(plain, Math.floor(plain.length / 2));
  // ainda grande: tira sondas (pares de tomada/corte) antes dos recortes da legenda
  while (size() > maxBody && probes.some((f) => !isCrop(f))) probes.splice(probes.findIndex((f) => !isCrop(f)), 1);
  while (size() > maxBody && plain.length) plain = spread(plain, plain.length > 1 ? Math.floor(plain.length / 2) : 0);
  while (size() > maxBody && probes.length > 1) probes = probes.slice(1);
  return { frames: [...plain, ...probes], metrics };
}

/** pedido em linguagem natural -> resposta + operações de edição */
export async function requestEdit(req: EditRequest): Promise<EditResponse> {
  const base = {
    project: req.project,
    assets: slimAssets(req.assets),
    messages: req.messages.slice(-12).map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })),
    userText: req.userText,
    mode: req.mode ?? 'chat',
    ...(req.context ? { context: req.context } : {}),
  };
  let frames = req.frames ?? [];
  const baseLen = JSON.stringify(base).length;
  while (frames.length && baseLen + JSON.stringify(frames).length > MAX_BODY) frames = frames.length > 2 ? frames.filter((_, i) => i % 2 === 0) : [];
  const r = await postJson<EditResponse>('/api/ai/edit', { ...base, frames }, req.signal);
  return { reply: r.reply, ops: r.ops, comments: r.comments, sfx: r.sfx, deferred: r.deferred, droppedReasons: r.droppedReasons, ok: r.ok };
}

/** traduz legendas (Claude); devolve o texto novo por id de segmento */
export async function translateSegments(segments: { id: string; text: string }[], to: string, from = 'pt-BR'): Promise<Map<string, string>> {
  const { segments: out } = await postJson<{ segments: { id: string; text: string }[] }>('/api/ai/translate', { segments, to, from });
  return new Map(out.map((s) => [s.id, s.text]));
}
