// Assinatura de sessão via HMAC-SHA256 (Web Crypto — roda no Edge e no Node).
// O cookie guarda "authed.<hmac>"; o servidor recomputa o hmac pra validar.
// Sem segredo no cliente: só o servidor (que tem DASH_PASSWORD) consegue assinar.

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(sig);
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export const COOKIE_NAME = 'ep_sess';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h — casa com o maxAge do cookie

// comparação de tempo constante (evita timing side-channel)
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Cookie: "authed.<expiraEmMs>.<hmac(authed.<exp>)>" — a expiração é assinada,
// então o servidor valida o prazo (não dá pra reusar cookie vazado após 12h).
export async function makeSessionCookie(secret: string): Promise<string> {
  const exp = Date.now() + SESSION_MS;
  const payload = `authed.${exp}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function isValidSession(
  cookieValue: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!cookieValue || !secret) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [tag, expStr, sig] = parts;
  if (tag !== 'authed' || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false; // sessão expirada
  const expected = await hmac(`${tag}.${expStr}`, secret);
  return timingSafeEqual(sig, expected);
}
