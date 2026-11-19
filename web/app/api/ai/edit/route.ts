/* =====================================================================
   POST /api/ai/edit {project, assets, messages, userText, mode?, frames?}
   -> {reply, ops, dropped}
   O Claude recebe o prompt do editor (prompts/edit-system.md, estável e
   cacheado), um resumo compacto do projeto (com a transcrição em tempos de
   timeline e o StyleProfile) e algumas miniaturas do material.
   As ops são validadas/sanitizadas aqui (lib/ai/validate.ts).
   ===================================================================== */
import { shaderDocForAI } from '@/lib/ai/optional';
import type { ChatMessage, MediaAsset, Project } from '@/lib/types';
import { AIError, generateStructured, imageBlock, type UserContent } from '@/lib/ai/server/anthropic';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { EditResponseSchema } from '@/lib/ai/schemas';
import { summarizeProject } from '@/lib/ai/summary';
import { sanitizeOps } from '@/lib/ai/validate';
import { libraryCatalogForAI } from '@/lib/library/catalog';
import { engineCatalogForAI } from '@/lib/ai/catalogs';
import { COLOR_GRADE_LIVE } from '@/lib/ai/colormatch';
import { isObj, num, str } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FRAMES = 12;
/** a IA pode mandar mais ops que o chat manual (planos longos); scripts geram as suas no navegador */
const MAX_AI_OPS = 400;

interface Body {
  project?: Project;
  assets?: Record<string, MediaAsset>;
  messages?: ChatMessage[];
  userText?: string;
  mode?: 'first' | 'chat' | 'comments' | 'repair' | 'review';
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

/** tarefa da 1ª edição: com vídeo modelo, ele é o MOLDE DEFINITIVO (nada de inventar gancho/zoom/efeito/transição) */
function firstEditTask(p: Project): string {
  const hasCaptions = p.captions.segments.length > 0;
  const capLine = hasCaptions ? ' Aplique as legendas no estilo certo.' : '';
  if (!p.style) {
    return `PRIMEIRA EDIÇÃO: transforme o material bruto no vídeo descrito no brief. Use a transcrição (palavras com ids e tempos) para cortar silêncios, erros, repetições e vícios com remove_words/ripple_delete e para achar frases fortes.${capLine} Gancho, zooms suaves, cor, efeitos e transições só onde ajudam o vídeo.`;
  }
  const graded = p.tracks.some((t) => t.clips.some((c) => (c.type === 'video' || c.type === 'image') && c.colorGrade && Object.keys(c.colorGrade).length));
  return [
    'PRIMEIRA EDIÇÃO — MODELO DEFINITIVO: o `style` do projeto (vídeo modelo) é o molde. Replique-o com fidelidade; o brief diz o conteúdo/objetivo, o modelo diz COMO editar.',
    '- Ritmo: corte nos respiros da fala (remove_words / split_clip com newId entre palavras) para as tomadas ficarem com a duração das do modelo (`style.template.shots`/`shotStats`, senão `avgShotLength`, ±20%).',
    '- Movimento: o de `style.template.motion` / `style.motion` em CADA tomada (keyframes de escala com easing). Sem medição: aproximação lenta 1.00→1.06 por tomada, easeInOut. Pancada (zoom rápido) só se o modelo tiver.',
    '- Transições: só as do modelo (`style.template.transitions`); corte seco continua corte seco.',
    hasCaptions ? '- Legendas: a cor, caixa, posição, tamanho e palavras por vez do modelo (`style.template.captions` > `style.captions`) via set_caption_style.' : '- Legendas: ainda sem transcrição — se o modelo tem legenda, deixe o estilo pronto com set_caption_style (cor, caixa, posição, palavras por vez do modelo).',
    graded ? '- Cor: JÁ casada com o modelo (os clipes têm colorGrade). Não aplique colorPreset, apply_look nem filtros de cor.' : '- Cor: a do modelo (`style.template.color` / `style.colorPreset`), sem empilhar dois looks.',
    '- NÃO acrescente gancho, títulos, zooms, efeitos, transições, stickers ou estilos de legenda que o modelo não tem, a menos que o brief peça. Os `textOverlays.examples` do modelo são amostras de estilo: nunca copie o texto.',
    '- Use a transcrição (palavras com ids e tempos) para cortar silêncios, erros, repetições e vícios.',
  ].join('\n');
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
    const repairMode = body.mode === 'repair';
    const reviewMode = body.mode === 'review';

    const content: UserContent = [];
    for (const f of (Array.isArray(body.frames) ? body.frames : []).filter(isObj).slice(0, MAX_FRAMES)) {
      const img = typeof f.data === 'string' ? imageBlock(f.data, typeof f.mediaType === 'string' ? f.mediaType : 'image/jpeg') : null;
      if (!img) continue;
      const t = num(f.t);
      const label = f.assetId === 'resultado'
        ? `Quadro do RESULTADO (como ficou a edição) em ${t !== undefined ? t.toFixed(2) : '?'} s da timeline:`
        : `Miniatura do material "${str(f.assetId, 80) ?? '?'}" em ${t !== undefined ? t.toFixed(1) : '?'} s da mídia:`;
      content.push({ type: 'text', text: label }, img);
    }

    const summary = summarizeProject(project, assets, messages);
    const task = repairMode
      ? 'CONSERTO: parte da sua resposta anterior falhou (erros no pedido abaixo, com a linha quando houver). O que deu certo JÁ está no projeto atual. Devolva SOMENTE as ops/macros que faltam, corrigidas (script, shader GLSL, SVG ou op). Se algo for impossível, use a alternativa mais próxima e explique no reply.'
      : reviewMode
        ? 'CONFERÊNCIA DO RESULTADO: veja os quadros do RESULTADO renderizado e compare com o pedido do usuário. Se estiver certo, devolva ops: [] e ok: true. Se houver problema visível (texto cortado/ilegível/fora do quadro, cor ou posição errada, efeito invisível ou exagerado), devolva só as ops de ajuste e ok: false. Não refaça o que já está bom.'
        : first
      ? firstEditTask(project)
      : commentsMode
        ? 'APLICAR COMENTÁRIOS: atenda cada comentário de revisão no tempo indicado, marque cada um com update_marker {"resolved": true} e devolva "comments" com uma resposta curta por comentário.'
        : 'AJUSTE PELO CHAT: faça exatamente o que o usuário pediu, sem refazer o resto.';
    const where = describeContext(body.context, project);
    content.push({ type: 'text', text: `${task}\n\nPROJETO ATUAL (JSON):\n${JSON.stringify(summary)}${where ? `\n\nO USUÁRIO APONTOU PARA: ${where}` : ''}\n\nPEDIDO DO USUÁRIO:\n${userText}` });

    const raw = await generateStructured({
      signal: req.signal,
      system: `${await loadPrompt('edit-system')}${COLOR_GRADE_LIVE ? '' : '\n\nOBS.: o motor de `colorGrade` ainda não está ligado — para cor use `colorPreset`, `filters` (temperature, tint, exposure, contrast, saturation…) ou `apply_look`.'}\n\n## Catálogo do editor (ids válidos)\n${engineCatalogForAI()}\n\n## Catálogo da biblioteca (ids válidos)\n${libraryCatalogForAI()}\n\n## Shaders GLSL custom (prelúdio e exemplos testados)\n${shaderDocForAI()}`,
      content,
      schema: EditResponseSchema,
      effort: first || commentsMode ? 'high' : reviewMode ? 'low' : 'medium',
      // scripts/shaders/SVG longos cabem; o timeout do cliente (240 s) fica abaixo do maxDuration (300 s)
      maxTokens: reviewMode ? 12000 : repairMode ? 24000 : 32000,
    });

    const reply = (isObj(raw) && str(raw.reply, 800)) || 'Pronto, apliquei as mudanças.';
    const san = sanitizeOps(isObj(raw) ? raw.ops : raw, project, assets, MAX_AI_OPS);
    const { dropped, sfx } = san;
    let { ops, deferred } = san;
    // legenda é SÓ a fala transcrita: sem transcrição no projeto, set_captions do Claude (texto inventado) vira transcrição real
    if (!project.captions.segments.length && ops.some((o) => o.op === 'set_captions')) {
      ops = ops.filter((o) => o.op !== 'set_captions');
      if (!(deferred ?? []).some((d) => d.kind === 'captions')) deferred = [...(deferred ?? []), { kind: 'captions' as const }];
    }
    if (dropped.length) console.warn('[ai/edit] ops descartadas:', dropped.map((d) => d.reason));
    const comments = isObj(raw) && Array.isArray(raw.comments)
      ? raw.comments.filter(isObj).map((c) => ({ markerId: str(c.markerId, 80) ?? '', reply: str(c.reply, 300) ?? '' })).filter((c) => c.markerId && c.reply)
      : [];
    // motivos do que caiu na validação: o navegador manda de volta numa rodada de conserto
    const droppedReasons = dropped.slice(0, 20).map((d) => `${isObj(d.op) && typeof d.op.op === 'string' ? d.op.op : 'op'}: ${d.reason}`.slice(0, 200));
    const review = isObj(raw) && raw.ok === true;
    return ok({ reply, ops, dropped: dropped.length, droppedReasons, comments, sfx, deferred, ...(review ? { ok: true } : {}) });
  } catch (e) {
    return fail(e);
  }
}
