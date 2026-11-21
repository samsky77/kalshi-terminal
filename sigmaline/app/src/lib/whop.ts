/**
 * Whop: OAuth sign-in (PKCE + OIDC), membership checks and webhook verification.
 * Endpoints taken from Whop's official SDK (@whop/sdk 2.8) and OAuth guide:
 *   authorize  https://api.whop.com/oauth/authorize
 *   token      https://api.whop.com/oauth/token
 *   userinfo   https://api.whop.com/oauth/userinfo
 *   access     GET https://api.whop.com/api/v1/users/{user_id}/access/{product_id} -> { has_access, access_level }
 * Webhooks follow the Standard Webhooks scheme; Whop HMACs with the literal bytes of the secret.
 * Override the host with WHOP_API_BASE (e.g. https://sandbox-api.whop.com) for testing.
 */
const base = () => (process.env.WHOP_API_BASE ?? 'https://api.whop.com').replace(/\/$/, '');

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(n = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function redirectUri(): string {
  return `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/auth/callback`;
}

export async function authorizeUrl(state: string, nonce: string, verifier: string): Promise<string> {
  const p = new URLSearchParams({
    response_type: 'code', client_id: process.env.WHOP_CLIENT_ID ?? '', redirect_uri: redirectUri(), scope: 'openid profile email',
    state, nonce, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
  });
  return `${base()}/oauth/authorize?${p}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<{ access_token: string; id_token?: string }> {
  const res = await fetch(`${base()}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: process.env.WHOP_CLIENT_ID, client_secret: process.env.WHOP_CLIENT_SECRET, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`whop token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export interface WhopUser { sub: string; email?: string; preferred_username?: string; name?: string }

export async function userInfo(accessToken: string): Promise<WhopUser> {
  const res = await fetch(`${base()}/oauth/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`whop userinfo ${res.status}`);
  return res.json();
}

/** Does this Whop user currently have access to the Sigmaline product? (API key auth.) */
/** null = can't tell (Whop not configured): callers keep the last known, webhook-fed status. */
export async function checkAccess(userId: string): Promise<boolean | null> {
  const product = process.env.WHOP_PRODUCT_ID, key = process.env.WHOP_API_KEY;
  if (!product || !key) return null;
  const res = await fetch(`${base()}/api/v1/users/${encodeURIComponent(userId)}/access/${encodeURIComponent(product)}`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`whop access ${res.status}`);
  const body = (await res.json()) as { has_access: boolean; access_level: string };
  return !!body.has_access && body.access_level !== 'no_access';
}

/**
 * Verify a Standard Webhooks signature: base64(HMAC-SHA256(secret_bytes, `${id}.${timestamp}.${body}`)),
 * header "v1,<sig> v1,<sig2>"; timestamps older than 5 minutes are rejected.
 */
export async function verifyWebhook(body: string, headers: Headers, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sig = headers.get('webhook-signature');
  if (!id || !ts || !sig || !secret) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  let expected = '';
  for (const b of mac) expected += String.fromCharCode(b);
  expected = btoa(expected);
  return sig.split(' ').some((part) => {
    const [ver, val] = part.split(',');
    if (ver !== 'v1' || !val || val.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < val.length; i++) diff |= val.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

/** Checkout for the trial plan (7-day free trial, card collected up front, set up in Whop). */
export function checkoutUrl(): string {
  return process.env.NEXT_PUBLIC_WHOP_CHECKOUT_URL || 'https://whop.com';
}

/** Checkout for the same product without a trial, for accounts that already used theirs. */
export function noTrialCheckoutUrl(): string {
  return process.env.NEXT_PUBLIC_WHOP_CHECKOUT_URL_NO_TRIAL || checkoutUrl();
}

const PRICE = Number(process.env.NEXT_PUBLIC_PRICE_MONTHLY || 25);
const TRIAL_DAYS = 7;

/** Trial and price copy. One place, so the CTA, pricing box, FAQ and account page say the same thing. */
export const OFFER = {
  trialDays: TRIAL_DAYS,
  price: PRICE,
  cta: `Start ${TRIAL_DAYS}-day free trial`,
  after: `then $${PRICE}/month`,
  fine: `Card required to start. You won’t be charged during the ${TRIAL_DAYS}-day trial; cancel any time before it ends and you pay nothing. After the trial it’s $${PRICE}/month until you cancel. One free trial per account.`,
};

/** Map a Whop webhook to a membership status (null = ignore). One rule, in membership.ts. */
export { statusFromWebhook as statusFor } from './membership';

export function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/slate';
}
