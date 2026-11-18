/* =====================================================================
   Gemini — SÓ NO SERVIDOR (rotas /api/ai/*). A chave nunca sai daqui.
   - upload resumable (Files API): o servidor inicia a sessão com a chave e
     devolve a URL de upload; o navegador envia direto ou, sem CORS, em
     blocos ≤ 3,75 MiB através da rota (limite de 4,5 MB da Vercel).
   - espera o arquivo ficar ACTIVE antes de usar em generateContent
   - geração com saída JSON estruturada (responseJsonSchema) + fallback
   ===================================================================== */
import { GoogleGenAI, MediaResolution, createPartFromUri, type Part } from '@google/genai';

/** base da API (GEMINI_API_BASE só serve para apontar a um mock em testes locais) */
export const API_BASE = (process.env.GEMINI_API_BASE?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** só aceitamos repassar blocos para URLs de upload do próprio provedor (evita SSRF) */
export const UPLOAD_URL_RE = new RegExp(`^${escapeRe(API_BASE)}/upload/`);
/** uris de arquivos do provedor aceitas nas rotas */
export const FILE_URI_RE = new RegExp(`^${escapeRe(API_BASE)}/`);
/** múltiplo de 256 KiB (exigência do protocolo resumable) e abaixo de 4,5 MB */
export const PROXY_CHUNK = 15 * 256 * 1024;

export class AIError extends Error {
  constructor(message: string, public status = 500, public code = 'ai_error') {
    super(message);
  }
}

export function aiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  return { configured: apiKey.length > 0, apiKey, model };
}

let client: GoogleGenAI | null = null;
let clientKey = '';
function genai(): GoogleGenAI {
  const { apiKey, configured } = aiConfig();
  if (!configured) throw new AIError('IA não configurada (GEMINI_API_KEY ausente no servidor).', 503, 'not_configured');
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey, ...(process.env.GEMINI_API_BASE ? { httpOptions: { baseUrl: API_BASE, apiVersion: 'v1beta' } } : {}) });
    clientKey = apiKey;
  }
  return client;
}

/** traduz erros do provedor para mensagens úteis em PT-BR */
export function friendlyError(e: unknown): AIError {
  if (e instanceof AIError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status ?? Number(raw.match(/\b(4\d\d|5\d\d)\b/)?.[1] ?? 500);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw))
    return new AIError('Limite de uso do Gemini atingido. Aguarde um minuto e tente de novo.', 429, 'rate_limited');
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED/i.test(raw))
    return new AIError('A chave do Gemini foi recusada. Confira GEMINI_API_KEY no servidor.', 401, 'bad_key');
  if (/not found|NOT_FOUND|has expired|does not exist/i.test(raw) && /file/i.test(raw))
    return new AIError('O arquivo enviado à IA expirou ou não existe mais. Envie de novo.', 410, 'file_gone');
  if (status === 400) return new AIError(`Pedido recusado pelo Gemini: ${raw.slice(0, 300)}`, 400, 'bad_request');
  if (status === 503 || /UNAVAILABLE|overloaded/i.test(raw))
    return new AIError('O Gemini está sobrecarregado agora. Tente novamente em instantes.', 503, 'unavailable');
  return new AIError(`Falha na IA: ${raw.slice(0, 300)}`, status >= 400 && status < 600 ? status : 500);
}

/* ---------- Files API ---------- */

export interface GeminiFile { name: string; uri: string; mimeType: string; state?: string; sizeBytes?: string; error?: { message?: string } }

/** inicia upload resumable e devolve a URL de envio (não contém a chave) */
export async function startResumableUpload(opts: { displayName: string; mime: string; size: number }): Promise<string> {
  const { apiKey } = aiConfig();
  if (!apiKey) throw new AIError('IA não configurada.', 503, 'not_configured');
  const res = await fetch(`${API_BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(opts.size),
      'X-Goog-Upload-Header-Content-Type': opts.mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: opts.displayName.slice(0, 120) } }),
  });
  const url = res.headers.get('x-goog-upload-url');
  if (!res.ok || !url) throw friendlyError(Object.assign(new Error(`upload start ${res.status}: ${await res.text().catch(() => '')}`), { status: res.status }));
  return url;
}

/** repassa um bloco do navegador para a URL de upload (fallback sem CORS) */
export async function forwardChunk(uploadUrl: string, offset: number, final: boolean, body: ArrayBuffer): Promise<{ done: boolean; file?: GeminiFile }> {
  if (!UPLOAD_URL_RE.test(uploadUrl)) throw new AIError('URL de upload inválida.', 400, 'bad_upload_url');
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': aiConfig().apiKey,
      'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload',
      'X-Goog-Upload-Offset': String(offset),
      'Content-Length': String(body.byteLength),
    },
    body,
  });
  if (!res.ok) throw friendlyError(Object.assign(new Error(`upload chunk ${res.status}: ${await res.text().catch(() => '')}`), { status: res.status }));
  if (!final) return { done: false };
  const json = (await res.json()) as { file?: GeminiFile };
  return { done: true, file: json.file };
}

export async function getFile(name: string): Promise<GeminiFile> {
  if (!/^files\/[\w-]+$/.test(name)) throw new AIError('Nome de arquivo inválido.', 400);
  const res = await fetch(`${API_BASE}/v1beta/${name}`, { headers: { 'x-goog-api-key': aiConfig().apiKey }, cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as Partial<GeminiFile> & { error?: { message?: string } };
  if (!res.ok) {
    const msg = json.error?.message || `files.get ${res.status}`;
    throw friendlyError(Object.assign(new Error(res.status === 404 ? `file not found: ${msg}` : msg), { status: res.status }));
  }
  return { name: json.name ?? name, uri: json.uri ?? '', mimeType: json.mimeType ?? '', state: json.state, error: json.error };
}

/** espera o processamento do vídeo (PROCESSING -> ACTIVE) */
export async function waitActive(name: string, timeoutMs = 50_000): Promise<GeminiFile> {
  const t0 = Date.now();
  let delay = 1000;
  for (;;) {
    const f = await getFile(name);
    if (f.state === 'ACTIVE') return f;
    if (f.state === 'FAILED') throw new AIError(`O Gemini não conseguiu processar o arquivo${f.error?.message ? `: ${f.error.message}` : ''}.`, 422, 'file_failed');
    if (Date.now() - t0 + delay > timeoutMs) return f; // ainda PROCESSING: o cliente pergunta de novo
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 4000);
  }
}

/** extrai o nome "files/abc" de uma uri https://.../files/abc */
export function fileNameFromUri(uri: string): string | null {
  const m = uri.match(/(files\/[\w-]+)/);
  return m ? m[1] : null;
}

/* ---------- geração JSON ---------- */

export function filePart(uri: string, mime: string): Part {
  return createPartFromUri(uri, mime);
}

/** tira cercas ```json e pega o maior objeto JSON do texto */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new AIError('A IA respondeu em um formato inesperado. Tente de novo.', 502, 'bad_json');
  }
}

export interface GenerateJSONOptions {
  system: string;
  parts: (Part | string)[];
  schema?: Record<string, unknown>;
  temperature?: number;
  /** vídeo em resolução baixa = menos tokens (bom p/ edição/estilo) */
  lowRes?: boolean;
}

export async function generateJSON(opts: GenerateJSONOptions): Promise<unknown> {
  const { model } = aiConfig();
  const ai = genai();
  const contents = [{ role: 'user', parts: opts.parts.map((p) => (typeof p === 'string' ? { text: p } : p)) }];
  const base = {
    systemInstruction: opts.system,
    responseMimeType: 'application/json',
    temperature: opts.temperature ?? 0.4,
    ...(opts.lowRes ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
  };
  const run = async (withSchema: boolean) => {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: withSchema && opts.schema ? { ...base, responseJsonSchema: opts.schema } : base,
    });
    const text = res.text ?? '';
    if (!text.trim()) {
      const reason = res.candidates?.[0]?.finishReason;
      throw new AIError(`A IA não devolveu conteúdo${reason ? ` (${reason})` : ''}.`, 502, 'empty');
    }
    return parseJsonLoose(text);
  };
  try {
    return await run(true);
  } catch (e) {
    const err = friendlyError(e);
    // schema recusado pelo modelo/versão: tenta só com JSON livre (o prompt descreve o formato)
    if (opts.schema && (err.code === 'bad_request' || err.code === 'bad_json')) {
      try {
        return await run(false);
      } catch (e2) {
        throw friendlyError(e2);
      }
    }
    throw err;
  }
}
