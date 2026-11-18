/**
 * Signed session cookie (HMAC-SHA256 with SESSION_SECRET). Holds only the Whop user id, email and
 * expiry. Membership is never trusted from the cookie — it is re-checked server-side (10-min cache).
 */
export const SESSION_COOKIE = 'sl_session';
export const SESSION_DAYS = 30;

export interface Session { uid: string; email: string | null; exp: number }

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(pad);
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production' && process.env.SUPABASE_URL) throw new Error('SESSION_SECRET must be set (32+ chars) in production');
  return 'dev-only-insecure-session-secret-change-me-0000';
}

export async function signSession(s: Session, secret = sessionSecret()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret = sessionSecret()): Promise<Session | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    const raw = Uint8Array.from(fromB64url(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await key(secret), raw, enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(fromB64url(body)) as Session;
    if (!s.uid || !(s.exp > Date.now())) return null;
    return s;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAgeSec: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: maxAgeSec };
}
