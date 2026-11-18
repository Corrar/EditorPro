/* =====================================================================
   POST /api/ai/analyze-reference
   {frames: [{t, data(base64 jpeg)}], metrics: {duration, cuts, avgShotLength, pacing, width, height}}
   -> {style: StyleProfile}
   O Claude não recebe vídeo: o navegador manda ~1 quadro/s + métricas de
   corte calculadas localmente (mais confiáveis para ritmo que os quadros).
   ===================================================================== */
import { AIError, generateStructured, imageBlock, type UserContent } from '@/lib/ai/server/anthropic';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { StyleSchema } from '@/lib/ai/schemas';
import { ASPECTS, PACINGS, clampNum, isObj, num, oneOf, sanitizeStyleProfile } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FRAMES = 48;

export async function POST(req: Request) {
  try {
    const body = await readJson<{ frames?: unknown; metrics?: unknown }>(req);
    const frames = (Array.isArray(body.frames) ? body.frames : []).filter(isObj).slice(0, MAX_FRAMES);
    const m = isObj(body.metrics) ? body.metrics : {};
    const content: UserContent = [];
    for (const f of frames) {
      const img = typeof f.data === 'string' ? imageBlock(f.data, typeof f.mediaType === 'string' ? f.mediaType : 'image/jpeg') : null;
      if (!img) continue;
      const t = num(f.t);
      content.push({ type: 'text', text: `Quadro em ${t !== undefined ? t.toFixed(1) : '?'} s:` }, img);
    }
    if (!content.length) throw new AIError('Nenhum quadro válido do vídeo-exemplo.', 400, 'no_frames');
    const metrics = {
      duration: clampNum(m.duration, 0, 36000),
      cuts: Array.isArray(m.cuts) ? m.cuts.map(num).filter((x): x is number => x !== undefined).slice(0, 400) : undefined,
      avgShotLength: clampNum(m.avgShotLength, 0.1, 600),
      pacing: oneOf(m.pacing, PACINGS),
      aspect: oneOf(m.aspect, ASPECTS),
    };
    content.push({
      type: 'text',
      text: `MÉTRICAS MEDIDAS NO NAVEGADOR (confiáveis para ritmo/formato): ${JSON.stringify(metrics)}\n\nAnalise o estilo de edição deste vídeo-exemplo.`,
    });
    const raw = await generateStructured({ system: await loadPrompt('analyze-reference'), content, schema: StyleSchema, effort: 'medium', maxTokens: 8000 });
    const style = sanitizeStyleProfile(raw);
    if (!style) throw new AIError('Não consegui extrair o estilo do vídeo-exemplo.', 502, 'bad_json');
    // métricas medidas valem mais que a estimativa visual
    if (metrics.avgShotLength) style.avgShotLength = metrics.avgShotLength;
    if (metrics.pacing) style.pacing = metrics.pacing;
    if (metrics.aspect) style.aspect = metrics.aspect;
    return ok({ style });
  } catch (e) {
    return fail(e);
  }
}
