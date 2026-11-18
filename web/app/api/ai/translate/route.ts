/* =====================================================================
   POST /api/ai/translate {segments: [{id, text}], to: 'en-US', from?: 'pt-BR'}
   -> {segments: [{id, text}]}
   Tradução das legendas pelo Claude (mantém ids; o cliente redistribui
   as palavras no tempo de cada segmento).
   ===================================================================== */
import { AIError, generateStructured } from '@/lib/ai/server/anthropic';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { TranslateSchema } from '@/lib/ai/schemas';
import { isObj, str } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SYSTEM = `Você traduz legendas de vídeos curtos. Recebe uma lista JSON de segmentos {id, text} e o idioma de destino.
Traduza cada "text" de forma natural e falada (como uma pessoa diria), curta como a original, mantendo gírias com equivalentes,
números, nomes próprios e emojis. Não junte nem divida segmentos: devolva exatamente os mesmos ids, na mesma ordem.
Responda somente JSON: {"segments":[{"id":"...","text":"..."}]}`;

export async function POST(req: Request) {
  try {
    const body = await readJson<{ segments?: unknown; to?: unknown; from?: unknown }>(req);
    const to = str(body.to, 20) ?? 'en-US';
    const from = str(body.from, 20) ?? 'pt-BR';
    const segs = (Array.isArray(body.segments) ? body.segments : [])
      .filter(isObj)
      .map((s) => ({ id: str(s.id, 80), text: str(s.text, 400) }))
      .filter((s): s is { id: string; text: string } => !!s.id && !!s.text)
      .slice(0, 600);
    if (!segs.length) throw new AIError('Nenhuma legenda para traduzir.', 400);
    const raw = await generateStructured({
      system: SYSTEM,
      content: [{ type: 'text', text: `De: ${from}\nPara: ${to}\n\n${JSON.stringify(segs)}` }],
      schema: TranslateSchema,
      effort: 'low',
      maxTokens: 32000,
    });
    const byId = new Map<string, string>();
    if (isObj(raw) && Array.isArray(raw.segments)) for (const s of raw.segments) if (isObj(s)) { const id = str(s.id, 80); const t = str(s.text, 400); if (id && t) byId.set(id, t); }
    return ok({ segments: segs.map((s) => ({ id: s.id, text: byId.get(s.id) ?? s.text })), to });
  } catch (e) {
    return fail(e);
  }
}
