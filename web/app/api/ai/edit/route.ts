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
import { libraryCatalogForAI } from '@/lib/library/catalog';
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
  mode?: 'first' | 'chat' | 'comments';
  /** para onde o usuário apontou (clipe, trecho, ponto, legenda, marcador) */
  context?: unknown;
  /** miniaturas do material: {assetId, t (s na mídia), data (base64), mediaType} */
  frames?: unknown[];
}

/** descreve o ChatContext em PT-BR para o prompt ("clipe c3 (0:04–0:09) / trecho 4.0–9.0 s / ponto (0.62, 0.30) em 7.1 s") */
function describeContext(c: unknown, p: Project): string {
  if (!isObj(c)) return '';
  const parts: string[] = [];
  const f = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '?');
  if (Array.isArray(c.clipIds) && c.clipIds.length) {
    const ids = c.clipIds.filter((x): x is string => typeof x === 'string').slice(0, 20);
    parts.push(`clipe(s) ${ids.map((id) => {
      for (const t of p.tracks) { const cl = t.clips.find((x) => x.id === id); if (cl) return `${id} (${cl.type}, ${f(cl.start)}–${f(cl.start + cl.duration)} s)`; }
      return id;
    }).join(', ')}`);
  }
  if (isObj(c.range)) parts.push(`trecho ${f(c.range.start)}–${f(c.range.end)} s`);
  if (isObj(c.point)) parts.push(`ponto do quadro (x ${f(c.point.x)}, y ${f(c.point.y)}; 0..1 a partir do canto superior esquerdo) em ${f(c.point.t)} s`);
  if (typeof c.segmentId === 'string') {
    const s = p.captions.segments.find((x) => x.id === c.segmentId);
    parts.push(`legenda ${c.segmentId}${s ? ` ("${s.text.slice(0, 80)}", ${f(s.start)}–${f(s.end)} s)` : ''}`);
  }
  if (typeof c.markerId === 'string') {
    const m = p.markers?.find((x) => x.id === c.markerId);
    parts.push(m ? `${m.kind === 'comment' ? 'comentário de revisão' : 'marcador'} ${m.id} em ${f(m.t)}${m.end !== undefined ? `–${f(m.end)}` : ''} s${m.label ? `: "${m.label.slice(0, 160)}"` : ''}${m.kind === 'comment' ? ' (ao atender, marque com update_marker {"resolved": true})' : ''}` : `marcador ${c.markerId}`);
  }
  const label = str(c.label, 120);
  return parts.length ? parts.join(' / ') : label ?? '';
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
    const commentsMode = body.mode === 'comments';

    const content: UserContent = [];
    for (const f of (Array.isArray(body.frames) ? body.frames : []).filter(isObj).slice(0, MAX_FRAMES)) {
      const img = typeof f.data === 'string' ? imageBlock(f.data, typeof f.mediaType === 'string' ? f.mediaType : 'image/jpeg') : null;
      if (!img) continue;
      const t = num(f.t);
      content.push({ type: 'text', text: `Miniatura do material "${str(f.assetId, 80) ?? '?'}" em ${t !== undefined ? t.toFixed(1) : '?'} s da mídia:` }, img);
    }

    const summary = summarizeProject(project, assets, messages);
    const task = first
      ? 'PRIMEIRA EDIÇÃO: transforme o material bruto no vídeo descrito no brief, aplicando o estilo do vídeo-exemplo (se houver). Use a transcrição (palavras com ids e tempos) para cortar silêncios, erros, repetições e vícios com remove_words/ripple_delete e para achar frases fortes. Aplique legendas no estilo certo, gancho, zooms, cor, efeitos e transições.'
      : commentsMode
        ? 'APLICAR COMENTÁRIOS: atenda cada comentário de revisão no tempo indicado, marque cada um com update_marker {"resolved": true} e devolva "comments" com uma resposta curta por comentário.'
        : 'AJUSTE PELO CHAT: faça exatamente o que o usuário pediu, sem refazer o resto.';
    const where = describeContext(body.context, project);
    content.push({ type: 'text', text: `${task}\n\nPROJETO ATUAL (JSON):\n${JSON.stringify(summary)}${where ? `\n\nO USUÁRIO APONTOU PARA: ${where}` : ''}\n\nPEDIDO DO USUÁRIO:\n${userText}` });

    const raw = await generateStructured({
      system: `${await loadPrompt('edit-system')}\n\n## Catálogo da biblioteca (ids válidos)\n${libraryCatalogForAI()}`,
      content,
      schema: EditResponseSchema,
      effort: first || commentsMode ? 'high' : 'medium',
      maxTokens: 32000,
    });

    const reply = (isObj(raw) && str(raw.reply, 800)) || 'Pronto, apliquei as mudanças.';
    const { ops, dropped, sfx } = sanitizeOps(isObj(raw) ? raw.ops : raw, project, assets);
    if (dropped.length) console.warn('[ai/edit] ops descartadas:', dropped.map((d) => d.reason));
    const comments = isObj(raw) && Array.isArray(raw.comments)
      ? raw.comments.filter(isObj).map((c) => ({ markerId: str(c.markerId, 80) ?? '', reply: str(c.reply, 300) ?? '' })).filter((c) => c.markerId && c.reply)
      : [];
    return ok({ reply, ops, dropped: dropped.length, comments, sfx });
  } catch (e) {
    return fail(e);
  }
}
