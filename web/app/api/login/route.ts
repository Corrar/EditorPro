import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, makeSessionCookie, sha256Hex, timingSafeEqual } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = process.env.DASH_PASSWORD || '';
  let password = '';
  try {
    const body = await req.json();
    password = String(body?.password || '');
  } catch {
    // ignore
  }
  // comparação de tempo constante sobre o hash (sem vazar tamanho da senha)
  const [ph, sh] = await Promise.all([sha256Hex(password), sha256Hex(secret)]);
  if (!secret || !timingSafeEqual(ph, sh)) {
    return NextResponse.json({ status: 'senha_invalida' }, { status: 401 });
  }
  const value = await makeSessionCookie(secret);
  const res = NextResponse.json({ status: 'ok' });
  res.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h
  });
  return res;
}
