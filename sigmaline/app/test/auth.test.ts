import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/lib/session';
import { safeNext, statusFor, verifyWebhook } from '../src/lib/whop';

const SECRET = 'x'.repeat(40);

describe('session cookie', () => {
  it('round-trips and rejects tampering / expiry / wrong secret', async () => {
    const t = await signSession({ uid: 'user_1', email: 'a@b.c', exp: Date.now() + 60000 }, SECRET);
    expect((await verifySession(t, SECRET))?.uid).toBe('user_1');
    const [body, sig] = t.split('.');
    const evil = Buffer.from(JSON.stringify({ uid: 'admin', email: 'a@b.c', exp: Date.now() + 60000 })).toString('base64url');
    expect(await verifySession(`${evil}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(t, 'y'.repeat(40))).toBeNull();
    expect(await verifySession(await signSession({ uid: 'u', email: null, exp: Date.now() - 1 }, SECRET), SECRET)).toBeNull();
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('Whop webhooks (Standard Webhooks, literal-secret HMAC)', () => {
  const secret = 'ws_test_secret_123';
  const sign = (id: string, ts: number, body: string) => `v1,${createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64')}`;
  it('accepts a valid signature and rejects bad / stale ones', async () => {
    const body = JSON.stringify({ type: 'membership.activated', data: { user: { id: 'user_1' } } });
    const ts = Math.floor(Date.now() / 1000);
    const h = (sig: string, t = ts) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(t), 'webhook-signature': sig });
    expect(await verifyWebhook(body, h(sign('msg_1', ts, body)), secret)).toBe(true);
    expect(await verifyWebhook(body, h(`v1,bogus ${sign('msg_1', ts, body)}`), secret)).toBe(true); // multiple sigs
    expect(await verifyWebhook(body + ' ', h(sign('msg_1', ts, body)), secret)).toBe(false);
    expect(await verifyWebhook(body, h(sign('msg_1', ts - 600, body), ts - 600), secret)).toBe(false);
    expect(await verifyWebhook(body, h(sign('msg_1', ts, body)), 'other')).toBe(false);
  });
  it('maps events to membership status', () => {
    expect(statusFor('membership.activated', {})).toBe('active');
    expect(statusFor('membership_went_valid', {})).toBe('active');
    expect(statusFor('payment.succeeded', {})).toBe('active');
    expect(statusFor('membership.deactivated', {})).toBe('expired');
    expect(statusFor('membership_went_invalid', {})).toBe('expired');
    expect(statusFor('membership.cancel_at_period_end_changed', {})).toBeNull();
    expect(statusFor('membership.canceled', { status: 'canceled' })).toBe('canceled');
  });
  it('only redirects to local paths after sign-in', () => {
    expect(safeNext('/game/x')).toBe('/game/x');
    expect(safeNext('//evil.com')).toBe('/slate');
    expect(safeNext('https://evil.com')).toBe('/slate');
  });
});

describe('QA security regressions', () => {
  it('SEC-001: no dev fallback secret whenever a real database is configured', async () => {
    const { sessionSecret } = await import('../src/lib/session');
    expect(() => sessionSecret({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecret({ DATABASE_URL: 'postgres://x' })).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecret({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecret({ NETLIFY: 'true' })).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecret({ DATABASE_URL: 'postgres://x', SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(sessionSecret({ DATABASE_URL: 'postgres://x', SESSION_SECRET: 'z'.repeat(32) })).toBe('z'.repeat(32));
    expect(sessionSecret({})).toMatch(/^dev-only/); // local demo only
  });
  it('SEC-002: post-login redirects stay on this site', () => {
    for (const bad of ['/\\evil.com', '/\\\\evil.com', '//evil.com', 'https://evil.com', '/%5Cevil.com\\x', '/\tevil', 'javascript:alert(1)']) expect(safeNext(bad)).toBe('/slate');
    expect(safeNext('/game/nba-1?x=1#y')).toBe('/game/nba-1?x=1#y');
    expect(safeNext('/edges?type=prop')).toBe('/edges?type=prop');
  });
});
