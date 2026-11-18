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

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AIError('Corpo da requisição inválido (JSON esperado).', 400, 'bad_body');
  }
}
