/* =====================================================================
   Cliente de IA (navegador) — chama as rotas /api/ai/*.
   A chave da IA NUNCA vai para o cliente.
   ===================================================================== */
import type { CaptionSegment, ChatMessage, MediaAsset, Project, StyleProfile } from '../types';
import type { EditOp } from '../ops';
import { slimAssets } from './summary';

export interface AIStatus { configured: boolean; provider: 'gemini' | 'demo'; model?: string }

export interface EditRequest {
  project: Project;
  assets: Record<string, MediaAsset>;
  messages: ChatMessage[];
  userText: string;
  /** 'first' = primeira edição a partir do brief; 'chat' = ajuste pontual (padrão) */
  mode?: 'first' | 'chat';
  /** arquivos já enviados ao provedor (material bruto) p/ o modelo assistir */
  media?: { uri: string; mime: string }[];
}

export interface EditResponse {
  reply: string; // resposta em PT-BR para o chat
  ops: EditOp[]; // cada uma com `explain`
}

/** erro com código vindo da rota (ex.: 'file_gone', 'rate_limited', 'not_configured') */
export class AIClientError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new AIClientError('Sem conexão com o servidor.', 0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new AIClientError(data.error || `Erro ${res.status} na IA.`, res.status, data.code);
  return data;
}

const postJson = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let statusCache: Promise<AIStatus> | null = null;

export async function getStatus(force = false): Promise<AIStatus> {
  if (!statusCache || force) {
    statusCache = call<AIStatus>('/api/ai/status').catch(() => ({ configured: false, provider: 'demo' as const }));
  }
  return statusCache;
}

/* ---------- upload (Files API) ---------- */

interface GeminiFile { name: string; uri: string; mimeType: string; state?: string }
const CORS_FLAG = 'ep_ai_direct_upload_blocked';

function directBlocked(): boolean {
  try { return sessionStorage.getItem(CORS_FLAG) === '1'; } catch { return false; }
}
function markDirectBlocked() {
  try { sessionStorage.setItem(CORS_FLAG, '1'); } catch {}
}

/** envio direto navegador -> Google (XHR p/ ter progresso). Rejeita se CORS/rede bloquear. */
function uploadDirect(uploadUrl: string, file: Blob, onProgress?: (f: number) => void): Promise<GeminiFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as { file?: GeminiFile };
        if (xhr.status >= 200 && xhr.status < 300 && json.file?.uri) resolve(json.file);
        else reject(new Error(`upload direto ${xhr.status}`));
      } catch {
        reject(new Error('upload direto: resposta ilegível'));
      }
    };
    xhr.onerror = () => reject(new Error('upload direto bloqueado (CORS/rede)'));
    xhr.send(file);
  });
}

/** fallback: blocos ≤ chunkSize pela nossa rota (respeita o limite de 4,5 MB da função) */
async function uploadViaProxy(uploadUrl: string, chunkSize: number, file: Blob, onProgress?: (f: number) => void): Promise<GeminiFile> {
  let offset = 0;
  for (;;) {
    const end = Math.min(file.size, offset + chunkSize);
    const final = end >= file.size;
    const qs = new URLSearchParams({ u: uploadUrl, offset: String(offset), final: final ? '1' : '0' });
    const res = await call<{ done: boolean; file?: GeminiFile }>(`/api/ai/upload?${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file.slice(offset, end),
    });
    offset = end;
    onProgress?.(offset / file.size);
    if (final) {
      if (!res.file?.uri) throw new AIClientError('Upload terminou sem arquivo.', 502);
      return res.file;
    }
  }
}

async function waitUntilActive(f: GeminiFile, onWait?: () => void): Promise<GeminiFile> {
  if (f.state === 'ACTIVE') return f;
  const t0 = Date.now();
  for (;;) {
    onWait?.();
    const { file } = await call<{ file: GeminiFile }>(`/api/ai/upload?name=${encodeURIComponent(f.name)}`);
    if (file.state === 'ACTIVE') return file;
    if (Date.now() - t0 > 6 * 60_000) throw new AIClientError('O Gemini demorou demais para processar o vídeo.', 504, 'timeout');
  }
}

/** envia o arquivo ao provedor (para análise de vídeo/áudio); devolve aiFileUri (já ACTIVE) */
export async function uploadForAI(asset: MediaAsset, file: Blob, onProgress?: (f: number) => void): Promise<{ uri: string; mime: string }> {
  const mime = file.type || asset.mime || 'video/mp4';
  const start = () => postJson<{ uploadUrl: string; chunkSize: number }>('/api/ai/upload', { name: asset.name, mime, size: file.size });
  let session = await start();
  let gf: GeminiFile | null = null;
  if (!directBlocked()) {
    try {
      gf = await uploadDirect(session.uploadUrl, file, onProgress);
    } catch {
      markDirectBlocked();
      session = await start(); // sessão nova: a anterior pode ter ficado pela metade
    }
  }
  if (!gf) gf = await uploadViaProxy(session.uploadUrl, session.chunkSize, file, onProgress);
  const active = await waitUntilActive(gf);
  return { uri: active.uri, mime: active.mimeType || mime };
}

/* ---------- análise ---------- */

function requireUri(asset: MediaAsset): { fileUri: string; mime: string } {
  if (!asset.aiFileUri) throw new AIClientError(`"${asset.name}" ainda não foi enviado à IA.`, 400, 'not_uploaded');
  return { fileUri: asset.aiFileUri, mime: asset.aiFileMime || asset.mime };
}

/** analisa o vídeo-exemplo e extrai o perfil de estilo */
export async function analyzeReference(asset: MediaAsset): Promise<StyleProfile> {
  const { style } = await postJson<{ style: StyleProfile }>('/api/ai/analyze-reference', { ...requireUri(asset), duration: asset.duration });
  return style;
}

/** transcreve a fala (tempos da MÍDIA, com palavras) */
export async function transcribe(asset: MediaAsset, language = 'pt-BR'): Promise<CaptionSegment[]> {
  const { segments } = await postJson<{ segments: CaptionSegment[] }>('/api/ai/transcribe', { ...requireUri(asset), duration: asset.duration, language });
  return segments;
}

/** pedido em linguagem natural -> resposta + operações de edição */
export async function requestEdit(req: EditRequest): Promise<EditResponse> {
  const { reply, ops } = await postJson<EditResponse>('/api/ai/edit', {
    project: req.project,
    assets: slimAssets(req.assets),
    messages: req.messages.slice(-12).map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })),
    userText: req.userText,
    mode: req.mode ?? 'chat',
    media: req.media ?? [],
  });
  return { reply, ops };
}
