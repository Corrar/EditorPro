/* POST /api/ai/analyze-reference {fileUri, mime, duration?} -> {style: StyleProfile} */
import { AIError, fileNameFromUri, filePart, generateJSON, waitActive } from '@/lib/ai/server/gemini';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { STYLE_SCHEMA } from '@/lib/ai/schemas';
import { sanitizeStyleProfile } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { fileUri, mime, duration } = await readJson<{ fileUri?: string; mime?: string; duration?: number }>(req);
    const name = fileUri ? fileNameFromUri(fileUri) : null;
    if (!fileUri || !name || !mime) throw new AIError('fileUri e mime são obrigatórios.', 400);
    const f = await waitActive(name, 20_000);
    if (f.state && f.state !== 'ACTIVE') throw new AIError('O vídeo-exemplo ainda está sendo processado. Tente em instantes.', 409, 'processing');
    const raw = await generateJSON({
      system: await loadPrompt('analyze-reference'),
      parts: [filePart(fileUri, mime), `Duração do vídeo-exemplo: ${Number(duration) > 0 ? Number(duration).toFixed(1) : 'desconhecida'} s. Analise o estilo de edição.`],
      schema: STYLE_SCHEMA,
      temperature: 0.2,
      lowRes: true,
    });
    const style = sanitizeStyleProfile(raw);
    if (!style) throw new AIError('Não consegui extrair o estilo do vídeo-exemplo.', 502, 'bad_json');
    return ok({ style });
  } catch (e) {
    return fail(e);
  }
}
