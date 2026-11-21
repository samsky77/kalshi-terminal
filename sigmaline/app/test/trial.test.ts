/**
 * Item 1 acceptance: a test user goes through trial → access granted; cancel → access kept until the
 * period end, then removed. Webhooks are signed and verified server-side; a bad signature changes
 * nothing; a second trial on the same Whop account doesn't unlock the app.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDb, getMember } from '@sigmaline/db';
import { POST as webhook } from '../src/app/api/webhooks/whop/route';
import { viewerFromToken } from '../src/lib/auth';
import { setDbForTests } from '../src/lib/db';
import { hasAccess, statusFromWebhook } from '../src/lib/membership';
import { signSession } from '../src/lib/session';

const SECRET = 'ws_test_secret_for_trial_flow';
const USER = 'user_trial_1';
const DAY = 86400000;
let db: MemoryDb;
let n = 0;
let whopHasAccess = true;

async function send(type: string, data: Record<string, unknown>, opts: { badSig?: boolean } = {}) {
  const body = JSON.stringify({ type, data: { user: { id: USER, email: 't@example.com' }, product: { id: 'prod_sigmaline' }, ...data } });
  const id = `msg_${++n}`, ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', Buffer.from(opts.badSig ? 'wrong' : SECRET, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await webhook(new Request('https://app.example/api/webhooks/whop', { method: 'POST', body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` } }));
  return { status: res.status, json: await res.json() };
}

async function viewer() {
  // force the 10-minute membership cache to be considered fresh only after a webhook (as in prod)
  return viewerFromToken(await signSession({ uid: USER, email: 't@example.com', exp: Date.now() + DAY }));
}

beforeAll(() => {
  process.env.WHOP_WEBHOOK_SECRET = SECRET;
  process.env.WHOP_PRODUCT_ID = 'prod_sigmaline';
  process.env.WHOP_API_KEY = 'test_key_not_real';
  process.env.SESSION_SECRET = 's'.repeat(40);
  // Whop's access API, for when the 10-minute cache is stale.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ has_access: whopHasAccess, access_level: whopHasAccess ? 'customer' : 'no_access' }), { status: 200 })));
});
afterAll(() => { vi.unstubAllGlobals(); setDbForTests(null); });
beforeEach(() => { db = new MemoryDb(); setDbForTests(db); whopHasAccess = true; });

describe('7-day free trial (Whop)', () => {
  it('trial → access; cancel at period end → access until the end; then removed', async () => {
    const trialEnd = Math.floor((Date.now() + 7 * DAY) / 1000);
    expect((await send('membership.activated', { id: 'mem_1', status: 'trialing', renewal_period_end: trialEnd })).json.status).toBe('trialing');
    let v = await viewer();
    expect(v.active).toBe(true);
    expect(v.member?.status).toBe('trialing');
    expect(v.member?.trial_ends_at).toBe(new Date(trialEnd * 1000).toISOString());
    expect(v.member?.first_trial_at).toBeTruthy();

    // user cancels during the trial: Whop keeps the membership valid until the period end
    await send('membership.updated', { id: 'mem_1', status: 'trialing', cancel_at_period_end: true, renewal_period_end: trialEnd });
    v = await viewer();
    expect(v.active).toBe(true);
    expect(v.member?.cancel_at_period_end).toBe(true);

    // period end: Whop deactivates the membership
    await send('membership.deactivated', { id: 'mem_1', status: 'expired', renewal_period_end: trialEnd });
    v = await viewer();
    expect(v.active).toBe(false);
    expect(v.member?.status).toBe('expired');
  });

  it('trial converts to paid: active; failed renewal: past_due keeps access while Whop retries', async () => {
    await send('membership.activated', { id: 'mem_2', status: 'trialing' });
    await send('payment.succeeded', { id: 'mem_2', status: 'active', renewal_period_end: Math.floor((Date.now() + 30 * DAY) / 1000) });
    expect((await viewer()).member?.status).toBe('active');
    await send('payment.failed', { id: 'mem_2' });
    const v = await viewer();
    expect(v.member?.status).toBe('past_due');
    expect(v.active).toBe(true);
  });

  it('canceled keeps access only until the paid-through date', () => {
    expect(hasAccess({ status: 'canceled', expires_at: new Date(Date.now() + DAY).toISOString() })).toBe(true);
    expect(hasAccess({ status: 'canceled', expires_at: new Date(Date.now() - 1).toISOString() })).toBe(false);
    expect(hasAccess({ status: 'canceled', expires_at: null })).toBe(false);
    expect(hasAccess({ status: 'expired' })).toBe(false);
    expect(hasAccess({ status: 'trial_used' })).toBe(false);
    expect(hasAccess(null)).toBe(false);
  });

  it('a forged webhook (bad signature) is rejected and changes nothing', async () => {
    whopHasAccess = false; // Whop itself says this user has no membership
    const r = await send('membership.activated', { id: 'mem_x', status: 'active' }, { badSig: true });
    expect(r.status).toBe(401);
    expect(await getMember(db, USER)).toBeNull();
    expect((await viewer()).active).toBe(false);
  });

  it('a second trial on the same Whop account does not unlock the app', async () => {
    await send('membership.activated', { id: 'mem_a', status: 'trialing' });
    await send('membership.deactivated', { id: 'mem_a', status: 'expired' });
    const r = await send('membership.activated', { id: 'mem_b', status: 'trialing' });
    expect(r.json.status).toBe('trial_used');
    expect((await viewer()).active).toBe(false);
    // paying (no trial) still works
    await send('payment.succeeded', { id: 'mem_b', status: 'active' });
    expect((await viewer()).active).toBe(true);
  });

  it('when the cache is stale, Whop’s access API is asked and can revoke access', async () => {
    await send('membership.activated', { id: 'mem_3', status: 'active' });
    await db.update('members', { whop_user_id: USER }, { checked_at: new Date(Date.now() - 11 * 60000).toISOString() });
    whopHasAccess = false;
    const v = await viewer();
    expect(v.active).toBe(false);
    expect(v.member?.status).toBe('expired');
  });

  it('maps Whop statuses and event types', () => {
    expect(statusFromWebhook('membership.activated', { status: 'trialing' })).toBe('trialing');
    expect(statusFromWebhook('membership.updated', { status: 'past_due' })).toBe('past_due');
    expect(statusFromWebhook('membership.updated', { status: 'unresolved' })).toBe('past_due');
    expect(statusFromWebhook('membership.deactivated', { status: 'canceled' })).toBe('canceled');
    expect(statusFromWebhook('membership_went_invalid', {})).toBe('expired');
    expect(statusFromWebhook('payment.failed', {})).toBe('past_due');
    expect(statusFromWebhook('membership.cancel_at_period_end_changed', {})).toBeNull();
  });
});
