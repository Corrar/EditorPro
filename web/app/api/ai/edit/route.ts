/* =====================================================================
   POST /api/ai/edit {project, assets, messages, userText, media?, mode?}
   -> {reply, ops, dropped}
   O modelo recebe o prompt do editor (prompts/edit-system.md), um resumo
   compacto do projeto e (opcional) os vídeos do material bruto já enviados.
   As ops são validadas/sanitizadas aqui (lib/ai/validate.ts).
   ===================================================================== */
import type { ChatMessage, MediaAsset, Project } from '@/lib/types';
import { AIError, FILE_URI_RE, filePart, generateJSON } from '@/lib/ai/server/gemini';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { EDIT_SCHEMA } from '@/lib/ai/schemas';
import { summarizeProject } from '@/lib/ai/summary';
import { sanitizeOps } from '@/lib/ai/validate';
import { isObj, str } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  project?: Project;
  assets?: Record<string, MediaAsset>;
  messages?: ChatMessage[];
  userText?: string;
  media?: { uri: string; mime: string }[];
  mode?: 'first' | 'chat';
}

function looksLikeProject(p: unknown): p is Project {
  return isObj(p) && Array.isArray(p.tracks) && isObj(p.captions) && Array.isArray((p.captions as Record<string, unknown>).segments);
}

export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const userText = str(body.userText, 4000);
    if (!userText) throw new AIError('Pedido vazio.', 400);
    if (!looksLikeProject(body.project)) throw new AIError('Projeto inválido.', 400);
    const project = body.project;
    const assets = isObj(body.assets) ? (body.assets as Record<string, MediaAsset>) : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const media = (Array.isArray(body.media) ? body.media : [])
      .filter((m) => isObj(m) && typeof m.uri === 'string' && FILE_URI_RE.test(m.uri) && typeof m.mime === 'string')
      .slice(0, 4);

    const summary = summarizeProject(project, assets, messages);
    const task = body.mode === 'first'
      ? 'PRIMEIRA EDIÇÃO: transforme o material bruto no vídeo descrito no brief, aplicando o estilo do vídeo-exemplo (se houver). Corte silêncios/erros, aplique legendas no estilo certo, gancho, zooms, cor e transições.'
      : 'AJUSTE PELO CHAT: faça exatamente o que o usuário pediu, sem refazer o resto.';

    const raw = await generateJSON({
      system: await loadPrompt('edit-system'),
      parts: [
        ...media.map((m) => filePart(m.uri, m.mime)),
        `${task}\n\nPROJETO ATUAL (JSON):\n${JSON.stringify(summary)}\n\nPEDIDO DO USUÁRIO:\n${userText}`,
      ],
      schema: EDIT_SCHEMA,
      temperature: 0.35,
      lowRes: true,
    });

    const reply = (isObj(raw) && str(raw.reply, 800)) || 'Pronto, apliquei as mudanças.';
    const { ops, dropped } = sanitizeOps(isObj(raw) ? raw.ops : raw, project, assets);
    if (dropped.length) console.warn('[ai/edit] ops descartadas:', dropped.map((d) => d.reason));
    return ok({ reply, ops, dropped: dropped.length });
  } catch (e) {
    return fail(e);
  }
}
