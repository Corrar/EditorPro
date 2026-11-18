/* =====================================================================
   POST /api/ai/edit {project, assets, messages, userText, mode?, frames?}
   -> {reply, ops, dropped}
   O Claude recebe o prompt do editor (prompts/edit-system.md, estável e
   cacheado), um resumo compacto do projeto (com a transcrição em tempos de
   timeline e o StyleProfile) e algumas miniaturas do material.
   As ops são validadas/sanitizadas aqui (lib/ai/validate.ts).
   ===================================================================== */
import type { ChatMessage, MediaAsset, Project } from '@/lib/types';
import { AIError, generateStructured, imageBlock, type UserContent } from '@/lib/ai/server/anthropic';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { EditResponseSchema } from '@/lib/ai/schemas';
import { summarizeProject } from '@/lib/ai/summary';
import { sanitizeOps } from '@/lib/ai/validate';
import { isObj, num, str } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FRAMES = 12;

interface Body {
  project?: Project;
  assets?: Record<string, MediaAsset>;
  messages?: ChatMessage[];
  userText?: string;
  mode?: 'first' | 'chat';
  /** miniaturas do material: {assetId, t (s na mídia), data (base64), mediaType} */
  frames?: unknown[];
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
    const first = body.mode === 'first';

    const content: UserContent = [];
    for (const f of (Array.isArray(body.frames) ? body.frames : []).filter(isObj).slice(0, MAX_FRAMES)) {
      const img = typeof f.data === 'string' ? imageBlock(f.data, typeof f.mediaType === 'string' ? f.mediaType : 'image/jpeg') : null;
      if (!img) continue;
      const t = num(f.t);
      content.push({ type: 'text', text: `Miniatura do material "${str(f.assetId, 80) ?? '?'}" em ${t !== undefined ? t.toFixed(1) : '?'} s da mídia:` }, img);
    }

    const summary = summarizeProject(project, assets, messages);
    const task = first
      ? 'PRIMEIRA EDIÇÃO: transforme o material bruto no vídeo descrito no brief, aplicando o estilo do vídeo-exemplo (se houver). Use a transcrição (legendas com tempos de timeline) para achar silêncios, erros, repetições e frases fortes. Corte, aplique legendas no estilo certo, gancho, zooms, cor e transições.'
      : 'AJUSTE PELO CHAT: faça exatamente o que o usuário pediu, sem refazer o resto.';
    content.push({ type: 'text', text: `${task}\n\nPROJETO ATUAL (JSON):\n${JSON.stringify(summary)}\n\nPEDIDO DO USUÁRIO:\n${userText}` });

    const raw = await generateStructured({
      system: await loadPrompt('edit-system'),
      content,
      schema: EditResponseSchema,
      effort: first ? 'high' : 'medium',
      maxTokens: 32000,
    });

    const reply = (isObj(raw) && str(raw.reply, 800)) || 'Pronto, apliquei as mudanças.';
    const { ops, dropped } = sanitizeOps(isObj(raw) ? raw.ops : raw, project, assets);
    if (dropped.length) console.warn('[ai/edit] ops descartadas:', dropped.map((d) => d.reason));
    return ok({ reply, ops, dropped: dropped.length });
  } catch (e) {
    return fail(e);
  }
}
