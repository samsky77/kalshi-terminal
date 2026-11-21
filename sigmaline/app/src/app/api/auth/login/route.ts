import { NextResponse } from 'next/server';
import { cookieOptions, signSession } from '@/lib/session';
import { appUrl } from '@/lib/url';
import { authorizeUrl, randomToken, safeNext } from '@/lib/whop';

export const dynamic = 'force-dynamic';

/** Start Whop OAuth (PKCE). Requires the 21+ confirmation from /login. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  if (url.searchParams.get('age') !== '1') return NextResponse.redirect(appUrl(`/login?next=${encodeURIComponent(next)}`, req));
  if (!process.env.WHOP_CLIENT_ID) return NextResponse.redirect(appUrl('/login?error=not_configured', req));
  const state = randomToken(), nonce = randomToken(), verifier = randomToken(48);
  // Store the OAuth transaction in a short-lived signed cookie (re-using the session signer).
  const tx = await signSession({ uid: JSON.stringify({ state, nonce, verifier, next, age: Date.now() }), email: null, exp: Date.now() + 10 * 60000 });
  const res = NextResponse.redirect(await authorizeUrl(state, nonce, verifier));
  res.cookies.set('sl_oauth', tx, cookieOptions(600));
  return res;
}

