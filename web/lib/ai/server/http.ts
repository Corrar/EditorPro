/* utilitários das rotas /api/ai/* */
import { NextResponse } from 'next/server';
import { AIError, friendlyError } from './anthropic';

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) } });
}

export function fail(e: unknown) {
  const err = e instanceof AIError ? e : friendlyError(e);
  if (err.status >= 500) console.error('[ai]', err.code, err.message);
  return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
}

/** limite do corpo (a Vercel corta em ~4,5 MB; o cliente já reduz quadros para caber em ~4 MB) */
export const MAX_BODY_BYTES = 4_400_000;

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new AIError('Pedido grande demais. Tente com menos quadros/legendas.', 413, 'too_large');
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new AIError('Corpo da requisição inválido (JSON esperado).', 400, 'bad_body');
  }
  if (text.length > maxBytes) throw new AIError('Pedido grande demais. Tente com menos quadros/legendas.', 413, 'too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AIError('Corpo da requisição inválido (JSON esperado).', 400, 'bad_body');
  }
}
