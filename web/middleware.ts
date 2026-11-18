import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, isValidSession } from './lib/auth';

// Protege o editor e as rotas de IA (que gastam créditos da Anthropic).
// Sem DASH_PASSWORD: aberto só em desenvolvimento local; em produção bloqueia.
export async function middleware(req: NextRequest) {
  const secret = process.env.DASH_PASSWORD || '';
  if (!secret && process.env.NODE_ENV !== 'production') return NextResponse.next();
  const ok = await isValidSession(req.cookies.get(COOKIE_NAME)?.value, secret);
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ status: 'nao_autorizado' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/dev/:path*', '/api/ai/:path*'],
};
