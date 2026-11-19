/* GET /api/gen/status?probe=1 -> {configured, capabilities}
   GET /api/gen/status?jobId=… -> {status, progress?, url?, error?} | 501 sem GPU */
import { NextResponse } from 'next/server';
import { GenError, NOT_CONFIGURED, genProvider, requireSession } from '@/lib/ai/server/gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const provider = genProvider();
    if (url.searchParams.get('probe')) {
      return NextResponse.json(provider ? { configured: true, capabilities: provider.capabilities, provider: provider.label } : { ...NOT_CONFIGURED, capabilities: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!provider) return NextResponse.json(NOT_CONFIGURED, { status: 501 });
    const jobId = url.searchParams.get('jobId') || '';
    if (!/^[\w.:-]{1,200}$/.test(jobId)) throw new GenError('jobId inválido', 400);
    return NextResponse.json(await provider.poll(jobId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = e instanceof GenError ? e : new GenError(e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
