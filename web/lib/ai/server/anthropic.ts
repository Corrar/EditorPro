/* =====================================================================
   Claude (Anthropic) — SÓ NO SERVIDOR (rotas /api/ai/*). A chave nunca sai daqui.
   - saída estruturada (output_config.format via zod) com streaming
   - fallback de recusa no servidor (fallbacks: "default")
   - erros tipados do SDK -> mensagens úteis em PT-BR
   ===================================================================== */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export class AIError extends Error {
  constructor(message: string, public status = 500, public code = 'ai_error') {
    super(message);
  }
}

export function aiConfig() {
  const configured = !!process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
  return { configured, model };
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!aiConfig().configured) throw new AIError('IA não configurada (ANTHROPIC_API_KEY ausente no servidor).', 503, 'not_configured');
  // lê ANTHROPIC_API_KEY (e ANTHROPIC_BASE_URL, útil p/ mock em testes) do ambiente
  client ??= new Anthropic();
  return client;
}

/** traduz erros do SDK (classes tipadas) para mensagens em PT-BR */
export function friendlyError(e: unknown): AIError {
  if (e instanceof AIError) return e;
  if (e instanceof Anthropic.RateLimitError) return new AIError('Limite de uso da IA atingido. Aguarde um minuto e tente de novo.', 429, 'rate_limited');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AIError('A chave da Anthropic foi recusada. Confira ANTHROPIC_API_KEY no servidor.', 401, 'bad_key');
  if (e instanceof Anthropic.BadRequestError) return new AIError(`Pedido recusado pela IA: ${e.message.slice(0, 300)}`, 400, 'bad_request');
  if (e instanceof Anthropic.InternalServerError) return new AIError('A IA está sobrecarregada agora. Tente novamente em instantes.', 503, 'unavailable');
  if (e instanceof Anthropic.APIConnectionError) return new AIError('Sem conexão com a IA. Tente de novo.', 502, 'network');
  if (e instanceof Anthropic.APIError) return new AIError(`Falha na IA (${e.status ?? '?'}): ${e.message.slice(0, 300)}`, e.status && e.status >= 400 ? e.status : 500);
  return new AIError(`Falha na IA: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`, 500);
}

/** tira cercas ```json e pega o maior objeto JSON do texto */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(t.slice(a, b + 1)); } catch { /* cai abaixo */ }
    }
    throw new AIError('A IA respondeu em um formato inesperado. Tente de novo.', 502, 'bad_json');
  }
}

export type Effort = 'low' | 'medium' | 'high';
export type UserContent = Anthropic.Beta.BetaContentBlockParam[];

export interface StructuredOptions<S extends z.ZodType> {
  /** prompt de sistema ESTÁVEL (cacheado); conteúdo variável vai em `content` */
  system: string;
  content: UserContent;
  schema: S;
  effort: Effort;
  maxTokens?: number;
}

/**
 * Uma chamada com saída estruturada (streaming + finalMessage).
 * Devolve o JSON bruto (validado de verdade depois por validate.ts/sanitize.ts).
 */
export async function generateStructured<S extends z.ZodType>(opts: StructuredOptions<S>): Promise<unknown> {
  const { model } = aiConfig();
  const ai = anthropic();
  const base = {
    model,
    max_tokens: opts.maxTokens ?? 32000,
    system: [{ type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: opts.content }],
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
  };

  const run = async (structured: boolean) => {
    const stream = ai.beta.messages.stream({
      ...base,
      output_config: structured ? { effort: opts.effort, format: betaZodOutputFormat(opts.schema) } : { effort: opts.effort },
    });
    let msg: Awaited<ReturnType<typeof stream.finalMessage>>;
    try {
      msg = await stream.finalMessage();
    } catch (e) {
      // conteúdo fora do schema zod: o SDK pode lançar ao fazer o parse; o texto ainda serve
      if (e instanceof Anthropic.APIError) throw e;
      const last = stream.receivedMessages?.at(-1);
      const text = last?.content.map((b) => (b.type === 'text' ? b.text : '')).join('') ?? '';
      if (text.trim()) return parseJsonLoose(text);
      throw e;
    }
    if (msg.stop_reason === 'refusal') throw new AIError('A IA recusou este pedido. Tente reformular.', 422, 'refusal');
    if (msg.stop_reason === 'max_tokens') throw new AIError('A resposta da IA ficou longa demais. Peça algo mais curto.', 502, 'max_tokens');
    if (msg.parsed_output != null) return msg.parsed_output;
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!text.trim()) throw new AIError('A IA não devolveu conteúdo.', 502, 'empty');
    return parseJsonLoose(text);
  };

  try {
    return await run(true);
  } catch (e) {
    // schema complexo demais/recusado: tenta sem `format` (o prompt descreve o JSON)
    if (e instanceof Anthropic.BadRequestError && /schema|format|grammar/i.test(e.message)) {
      try {
        return await run(false);
      } catch (e2) {
        throw friendlyError(e2);
      }
    }
    throw friendlyError(e);
  }
}

/** bloco de imagem base64 (JPEG/PNG/WebP) — valida o tipo e descarta lixo */
export function imageBlock(data: string, mediaType = 'image/jpeg'): Anthropic.Beta.BetaImageBlockParam | null {
  const mt = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType) ? mediaType : null;
  const clean = data.replace(/^data:[^;]+;base64,/, '');
  if (!mt || !/^[A-Za-z0-9+/=]+$/.test(clean.slice(0, 200)) || clean.length < 100) return null;
  return { type: 'image', source: { type: 'base64', media_type: mt as 'image/jpeg', data: clean } };
}
