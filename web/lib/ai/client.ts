/* =====================================================================
   Cliente de IA — CONTRATO (dono: sessão "ai"). Roda no navegador e
   chama as rotas /api/ai/*. A chave da IA NUNCA vai para o cliente.
   ===================================================================== */
import type { CaptionSegment, ChatMessage, MediaAsset, Project, StyleProfile } from '../types';
import type { EditOp } from '../ops';

export interface AIStatus { configured: boolean; provider: 'gemini' | 'demo'; model?: string }

export interface EditRequest {
  project: Project;
  assets: Record<string, MediaAsset>;
  messages: ChatMessage[];
  userText: string;
}

export interface EditResponse {
  reply: string; // resposta em PT-BR para o chat
  ops: EditOp[]; // cada uma com `explain`
}

export async function getStatus(): Promise<AIStatus> {
  throw new Error('ai: getStatus ainda não implementado');
}

/** envia o arquivo ao provedor (para análise de vídeo/áudio); devolve aiFileUri */
export async function uploadForAI(_asset: MediaAsset, _file: Blob, _onProgress?: (f: number) => void): Promise<{ uri: string; mime: string }> {
  throw new Error('ai: uploadForAI ainda não implementado');
}

/** analisa o vídeo-exemplo e extrai o perfil de estilo */
export async function analyzeReference(_asset: MediaAsset): Promise<StyleProfile> {
  throw new Error('ai: analyzeReference ainda não implementado');
}

/** transcreve a fala (tempos da MÍDIA, com palavras) */
export async function transcribe(_asset: MediaAsset, _language?: string): Promise<CaptionSegment[]> {
  throw new Error('ai: transcribe ainda não implementado');
}

/** pedido em linguagem natural -> resposta + operações de edição */
export async function requestEdit(_req: EditRequest): Promise<EditResponse> {
  throw new Error('ai: requestEdit ainda não implementado');
}
