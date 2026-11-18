import { generateKeyPairSync, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GITHUB_ISSUER, WORKER_AUDIENCE, verifyWorkerToken, type OidcPolicy } from '../src/lib/oidc';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1' };
const jwks = async () => ({ keys: [jwk] });
const policy: OidcPolicy = { repository: 'samsky77/kalshi-terminal', ref: 'refs/heads/main', workflowPath: '.github/workflows/sigmaline-worker.yml' };
const now = 1_800_000_000;

function token(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const h = Buffer.from(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createSign('RSA-SHA256').update(`${h}.${b}`).sign(opts.key ?? privateKey).toString('base64url');
  return `${h}.${b}.${s}`;
}

const good = {
  iss: GITHUB_ISSUER, aud: WORKER_AUDIENCE, exp: now + 300, nbf: now - 10,
  repository: 'samsky77/kalshi-terminal', ref: 'refs/heads/main', event_name: 'schedule',
  workflow_ref: 'samsky77/kalshi-terminal/.github/workflows/sigmaline-worker.yml@refs/heads/main',
};

describe('worker OIDC token', () => {
  it('accepts this repo\'s worker workflow on main', async () => {
    expect((await verifyWorkerToken(token(good), policy, jwks, now)).ok).toBe(true);
    expect((await verifyWorkerToken(token({ ...good, event_name: 'workflow_dispatch' }), policy, jwks, now)).ok).toBe(true);
  });

  it.each([
    ['other repository', { repository: 'evil/fork' }, 'repository'],
    ['pull request ref', { ref: 'refs/pull/9/merge' }, 'ref'],
    ['other branch', { ref: 'refs/heads/feature' }, 'ref'],
    ['other workflow', { workflow_ref: 'samsky77/kalshi-terminal/.github/workflows/other.yml@refs/heads/main' }, 'workflow'],
    ['pull_request event', { event_name: 'pull_request' }, 'event'],
    ['wrong audience', { aud: 'something-else' }, 'audience'],
    ['wrong issuer', { iss: 'https://example.com' }, 'issuer'],
    ['expired', { exp: now - 120 }, 'expired'],
  ])('rejects %s', async (_name, patch, reason) => {
    const r = await verifyWorkerToken(token({ ...good, ...patch }), policy, jwks, now);
    expect(r).toEqual({ ok: false, reason });
  });

  it('rejects a forged signature, unknown key, other algorithm and garbage', async () => {
    expect(await verifyWorkerToken(token(good, { key: other.privateKey }), policy, jwks, now)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyWorkerToken(token(good, { kid: 'nope' }), policy, jwks, now)).toEqual({ ok: false, reason: 'unknown key' });
    expect(await verifyWorkerToken(token(good, { alg: 'HS256' }), policy, jwks, now)).toEqual({ ok: false, reason: 'alg' });
    expect(await verifyWorkerToken('abc', policy, jwks, now)).toEqual({ ok: false, reason: 'malformed' });
    const [h, , s] = token(good).split('.');
    const tampered = Buffer.from(JSON.stringify({ ...good, repository: 'evil/fork' })).toString('base64url');
    expect(await verifyWorkerToken(`${h}.${tampered}.${s}`, policy, jwks, now)).toEqual({ ok: false, reason: 'signature' });
  });
});
