/* POST /api/ai/transcribe {fileUri, mime, duration, language?} -> {segments: CaptionSegment[]}
   Tempos da MÍDIA (o cliente converte para a timeline conforme os clipes). */
import { AIError, fileNameFromUri, filePart, generateJSON, waitActive } from '@/lib/ai/server/gemini';
import { fail, ok, readJson } from '@/lib/ai/server/http';
import { loadPrompt } from '@/lib/ai/server/prompts';
import { TRANSCRIPT_SCHEMA } from '@/lib/ai/schemas';
import { sanitizeTranscript } from '@/lib/ai/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { fileUri, mime, duration, language } = await readJson<{ fileUri?: string; mime?: string; duration?: number; language?: string }>(req);
    const name = fileUri ? fileNameFromUri(fileUri) : null;
    if (!fileUri || !name || !mime) throw new AIError('fileUri e mime são obrigatórios.', 400);
    const f = await waitActive(name, 20_000);
    if (f.state && f.state !== 'ACTIVE') throw new AIError('O vídeo ainda está sendo processado. Tente em instantes.', 409, 'processing');
    const dur = Number(duration) > 0 ? Number(duration) : 0;
    const lang = typeof language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(language) ? language : 'pt-BR';
    const raw = await generateJSON({
      system: await loadPrompt('transcribe'),
      parts: [filePart(fileUri, mime), `Idioma: ${lang}. Duração do arquivo: ${dur ? dur.toFixed(2) : 'desconhecida'} s. Transcreva com tempos por palavra.`],
      schema: TRANSCRIPT_SCHEMA,
      temperature: 0.1,
    });
    const segments = sanitizeTranscript(raw, { duration: dur });
    return ok({ segments, language: lang });
  } catch (e) {
    return fail(e);
  }
}
