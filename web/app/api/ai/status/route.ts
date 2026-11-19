/* GET /api/ai/status -> { configured, provider, model } (nunca expõe a chave) */
import { aiConfig } from '@/lib/ai/server/anthropic';
import { ok } from '@/lib/ai/server/http';
import { transcribeProvider } from '@/lib/ai/server/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { configured, model } = aiConfig();
  const transcribe = transcribeProvider()?.name ?? null; // transcrição no servidor (Whisper large)
  return ok(configured ? { configured: true, provider: 'anthropic', model, transcribe } : { configured: false, provider: 'demo', transcribe });
}
