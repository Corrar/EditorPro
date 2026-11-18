/* GET /api/ai/status -> { configured, provider, model } (nunca expõe a chave) */
import { aiConfig } from '@/lib/ai/server/gemini';
import { ok } from '@/lib/ai/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { configured, model } = aiConfig();
  return ok(configured ? { configured: true, provider: 'gemini', model } : { configured: false, provider: 'demo' });
}
