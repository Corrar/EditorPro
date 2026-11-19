/* POST /api/gen/start {kind, params} -> {jobId} | 501 {configured:false, motivo:'GPU não configurada'} */
import { NextResponse } from 'next/server';
import { GEN_KINDS, type GenKind } from '@/lib/ai/generate';
import { GenError, NOT_CONFIGURED, genProvider, requireSession } from '@/lib/ai/server/gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const provider = genProvider();
    if (!provider) return NextResponse.json(NOT_CONFIGURED, { status: 501 });
    const body = (await req.json().catch(() => ({}))) as { kind?: string; params?: Record<string, unknown> };
    const kind = body.kind as GenKind;
    if (!(GEN_KINDS as readonly string[]).includes(kind)) throw new GenError('tipo de geração inválido', 400);
    if (!provider.capabilities.includes(kind)) throw new GenError(`o gerador não faz "${kind}"`, 400);
    const p = body.params ?? {};
    const params = {
      ...(typeof p.prompt === 'string' ? { prompt: p.prompt.slice(0, 2000) } : {}),
      ...(typeof p.imageUrl === 'string' ? { imageUrl: p.imageUrl } : {}),
      ...(typeof p.videoUrl === 'string' ? { videoUrl: p.videoUrl } : {}),
      ...(typeof p.audioUrl === 'string' ? { audioUrl: p.audioUrl } : {}),
      ...(typeof p.duration === 'number' ? { duration: Math.max(1, Math.min(60, p.duration)) } : {}),
      ...(['9:16', '16:9', '1:1', '4:5'].includes(String(p.aspect)) ? { aspect: p.aspect as '9:16' } : {}),
      ...(typeof p.seed === 'number' ? { seed: Math.floor(p.seed) } : {}),
    };
    return NextResponse.json(await provider.start({ kind, params }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = e instanceof GenError ? e : new GenError(e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
