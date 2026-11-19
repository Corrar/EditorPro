/* POST /api/ai/transcribe?lang=pt-BR  (corpo: audio/wav 16 kHz mono, ≤ ~4,3 MB ≈ 2 min)
   -> { text, words: [{word,start,end}] } — Whisper large no servidor (Groq/OpenAI) */
import { NextResponse } from 'next/server';
import { TranscribeError, transcribeWav } from '@/lib/ai/server/transcribe';
import { MAX_BODY_BYTES } from '@/lib/ai/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) throw new TranscribeError('trecho de áudio grande demais', 413);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new TranscribeError('áudio vazio', 400);
    if (buf.byteLength > MAX_BODY_BYTES) throw new TranscribeError('trecho de áudio grande demais', 413);
    const url = new URL(req.url);
    const lang = url.searchParams.get('lang') || 'pt-BR';
    const prompt = url.searchParams.get('prompt') || undefined;
    const out = await transcribeWav(buf, lang, prompt);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = e instanceof TranscribeError ? e : new TranscribeError(e instanceof Error ? e.message : String(e));
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (err.retryAfter) headers['Retry-After'] = String(Math.ceil(err.retryAfter));
    return NextResponse.json({ error: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) }, { status: err.status, headers });
  }
}
