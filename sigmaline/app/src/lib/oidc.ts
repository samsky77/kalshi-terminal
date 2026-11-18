/**
 * GitHub Actions OIDC: lets the scheduled worker prove it is this repository's own workflow on `main`,
 * so the app can hand it the runtime keys without any GitHub repository secrets.
 *
 * The worker asks GitHub for an ID token (audience `sigmaline-worker`) and sends it here. We check the
 * RS256 signature against GitHub's published keys and then the claims: issuer, audience, expiry,
 * repository, branch and the exact workflow file. Pull requests (including from forks) never get a
 * token whose ref is `refs/heads/main`, so they cannot pass.
 */
export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
export const WORKER_AUDIENCE = 'sigmaline-worker';

export interface OidcPolicy {
  repository: string; // owner/name
  ref: string; // refs/heads/main
  workflowPath: string; // .github/workflows/sigmaline-worker.yml
}

export function policyFromEnv(env: Record<string, string | undefined> = process.env): OidcPolicy {
  return {
    repository: env.WORKER_OIDC_REPO || 'samsky77/kalshi-terminal',
    ref: env.WORKER_OIDC_REF || 'refs/heads/main',
    workflowPath: '.github/workflows/sigmaline-worker.yml',
  };
}

type Jwk = JsonWebKey & { kid?: string };
export type JwksFetcher = () => Promise<{ keys: Jwk[] }>;

let jwksCache: { at: number; keys: Jwk[] } | null = null;
export const fetchGithubJwks: JwksFetcher = async () => {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return { keys: jwksCache.keys };
  const res = await fetch(`${GITHUB_ISSUER}/.well-known/jwks`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys: body.keys };
  return body;
};

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export type OidcResult = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };

export async function verifyWorkerToken(token: string, policy: OidcPolicy, jwks: JwksFetcher = fetchGithubJwks, nowSec = Math.floor(Date.now() / 1000)): Promise<OidcResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let header: { alg?: string; kid?: string }, claims: Record<string, any>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return { ok: false, reason: 'malformed' }; }
  if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
  const { keys } = await jwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown key' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { ok: false, reason: 'signature' };
  if (claims.iss !== GITHUB_ISSUER) return { ok: false, reason: 'issuer' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(WORKER_AUDIENCE)) return { ok: false, reason: 'audience' };
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - 30) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 30) return { ok: false, reason: 'not yet valid' };
  if (claims.repository !== policy.repository) return { ok: false, reason: 'repository' };
  if (claims.ref !== policy.ref) return { ok: false, reason: 'ref' };
  if (claims.workflow_ref !== `${policy.repository}/${policy.workflowPath}@${policy.ref}`) return { ok: false, reason: 'workflow' };
  if (!['schedule', 'workflow_dispatch'].includes(String(claims.event_name))) return { ok: false, reason: 'event' };
  return { ok: true, claims };
}

/** The runtime keys the worker needs, taken from this deployment's environment. */
export const WORKER_KEYS = [
  'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ODDS_API_KEY', 'PROPLINE_API_KEY', 'SHARPAPI_KEY',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'DISCORD_WEBHOOK_URL', 'DISCORD_ERROR_WEBHOOK_URL',
] as const;
