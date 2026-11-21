/** Regression tests for the trial-flow tickets TRI-001…TRI-014 (QA swarm wave 1). */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMember, MemoryDb } from '@sigmaline/db';
import { POST as webhook } from '../src/app/api/webhooks/whop/route';
import { memberStatus, viewerFromToken } from '../src/lib/auth';
import { setDbForTests } from '../src/lib/db';
import { applyEvent, hasAccess, statusFromWebhook, toIso } from '../src/lib/membership';
import { signSession } from '../src/lib/session';

const SECRET = 'ws_regression_secret';
const DAY = 86400000;
let db: MemoryDb;
let n = 0;
const sec = (ms: number) => Math.floor(ms / 1000);

async function send(user: string, type: string, data: Record<string, unknown>, product: string | null = 'prod_reg') {
  const body = JSON.stringify({ type, data: { user: { id: user }, ...(product ? { product: { id: product } } : {}), ...data } });
  const id = `msg_r${++n}`, ts = sec(Date.now());
  const sig = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await webhook(new Request('https://x/api/webhooks/whop', { method: 'POST', body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` } }));
  return res.json();
}
const access = async (user: string) => (await viewerFromToken(await signSession({ uid: user, email: null, exp: Date.now() + DAY }))).active;
const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(() => {
  process.env.WHOP_WEBHOOK_SECRET = SECRET;
  process.env.WHOP_PRODUCT_ID = 'prod_reg';
  process.env.SESSION_SECRET = 'r'.repeat(40);
  delete process.env.WHOP_API_KEY; // Whop's access API not configured: the webhook state must hold
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
});
afterAll(() => { vi.unstubAllGlobals(); setDbForTests(null); });
beforeEach(() => { db = new MemoryDb(); setDbForTests(db); });

describe('trial regressions', () => {
  it('TRI-001: a locked repeat trial stays locked for later trialing events on that membership', async () => {
    await send('u1', 'membership.activated', { id: 'mem_a', status: 'trialing', updated_at: iso(Date.now() - 20 * DAY) });
    await send('u1', 'membership.deactivated', { id: 'mem_a', status: 'expired', updated_at: iso(Date.now() - 10 * DAY) });
    expect((await send('u1', 'membership.activated', { id: 'mem_b', status: 'trialing', updated_at: iso(Date.now() - DAY) })).status).toBe('trial_used');
    await send('u1', 'membership.updated', { id: 'mem_b', status: 'trialing', updated_at: iso(Date.now()) });
    expect(await access('u1')).toBe(false);
    expect((await getMember(db, 'u1'))?.status).toBe('trial_used');
  });
  it('TRI-002: a second trial with no membership id is also locked', async () => {
    await send('u2', 'membership.activated', { id: 'mem_a', status: 'trialing', updated_at: iso(Date.now() - 20 * DAY) });
    await send('u2', 'membership.deactivated', { id: 'mem_a', status: 'expired', updated_at: iso(Date.now() - 10 * DAY) });
    await send('u2', 'membership.activated', { status: 'trialing', updated_at: iso(Date.now()) });
    expect(await access('u2')).toBe(false);
  });
  it('TRI-003: out-of-order events never hand access back', async () => {
    await send('u3', 'membership.activated', { id: 'mem_a', status: 'active', updated_at: iso(Date.now() - 2 * DAY) });
    await send('u3', 'membership.deactivated', { id: 'mem_a', status: 'expired', updated_at: iso(Date.now() - DAY) });
    await send('u3', 'payment.failed', { id: 'mem_a', updated_at: iso(Date.now()) }); // can't revive an expired account
    expect(await access('u3')).toBe(false);
    await send('u3', 'membership.activated', { id: 'mem_a', status: 'active', updated_at: iso(Date.now() - 3 * DAY) }); // late, older event
    expect(await access('u3')).toBe(false);
  });
  it('TRI-004: trialing/active stop at the period end even if the deactivation webhook is lost', () => {
    const now = Date.now();
    expect(hasAccess({ status: 'trialing', expires_at: iso(now - 5 * DAY) }, now)).toBe(false);
    expect(hasAccess({ status: 'active', expires_at: iso(now - DAY) }, now)).toBe(false);
    expect(hasAccess({ status: 'active', expires_at: iso(now - 3600000) }, now)).toBe(true); // renewal webhook may lag a few hours
    expect(hasAccess({ status: 'past_due', expires_at: iso(now - 2 * DAY) }, now)).toBe(true);
    expect(hasAccess({ status: 'past_due', expires_at: iso(now - 4 * DAY) }, now)).toBe(false);
  });
  it('TRI-005: unknown Whop statuses (drafted, paused) grant nothing', async () => {
    expect(statusFromWebhook('membership.activated', { status: 'drafted' })).toBe('none');
    await send('u5', 'membership.activated', { id: 'mem_a', status: 'paused' });
    expect(await access('u5')).toBe(false);
  });
  it('TRI-006: a cancel-at-period-end toggle without a status is recorded', async () => {
    await send('u6', 'membership.activated', { id: 'mem_a', status: 'trialing', renewal_period_end: sec(Date.now() + 7 * DAY), updated_at: iso(Date.now() - 60000) });
    await send('u6', 'membership.cancel_at_period_end_changed', { id: 'mem_a', cancel_at_period_end: true, updated_at: iso(Date.now()) });
    const m = await getMember(db, 'u6');
    expect(m?.cancel_at_period_end).toBe(true);
    expect(m?.status).toBe('trialing');
    expect(await access('u6')).toBe(true);
  });
  it('TRI-009: dates in seconds, milliseconds, numeric strings or ISO all parse', () => {
    const t = Date.UTC(2026, 11, 21, 12);
    for (const x of [t / 1000, t, String(t / 1000), String(t), new Date(t).toISOString()]) expect(toIso(x)).toBe(new Date(t).toISOString());
    expect(toIso('garbage')).toBeNull();
    expect(toIso(null)).toBeNull();
  });
  it('TRI-010: an event with no product id cannot unlock the configured product', async () => {
    const r = await send('u10', 'membership.activated', { id: 'mem_a', status: 'active' }, null);
    expect(r.ignored).toBe('no product');
    expect(await getMember(db, 'u10')).toBeNull();
  });
  it('TRI-011: a second trial arriving while the first is live does not revoke the first', async () => {
    await send('u11', 'membership.activated', { id: 'mem_a', status: 'trialing', renewal_period_end: sec(Date.now() + 5 * DAY), updated_at: iso(Date.now() - 60000) });
    await send('u11', 'membership.activated', { id: 'mem_b', status: 'trialing', updated_at: iso(Date.now()) });
    const m = await getMember(db, 'u11');
    expect(m?.status).toBe('trialing');
    expect(m?.membership_id).toBe('mem_a');
    expect(await access('u11')).toBe(true);
  });
  it('TRI-012: with Whop’s access API unconfigured, a stale cache keeps the webhook status', async () => {
    await send('u12', 'membership.activated', { id: 'mem_a', status: 'active', renewal_period_end: sec(Date.now() + 20 * DAY) });
    await db.update('members', { whop_user_id: 'u12' }, { checked_at: iso(Date.now() - 11 * 60000) });
    expect((await memberStatus('u12', null))?.status).toBe('active');
    expect(await access('u12')).toBe(true);
  });
  it('TRI-013: a duplicate webhook id is still idempotent after the apply-then-record change', async () => {
    const body = JSON.stringify({ type: 'membership.activated', data: { user: { id: 'u13' }, product: { id: 'prod_reg' }, id: 'mem_a', status: 'active' } });
    const ts = sec(Date.now());
    const sig = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`dup.${ts}.${body}`).digest('base64');
    const h = { 'webhook-id': 'dup', 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` };
    expect((await (await webhook(new Request('https://x', { method: 'POST', body, headers: h }))).json()).status).toBe('active');
    expect((await (await webhook(new Request('https://x', { method: 'POST', body, headers: h }))).json()).duplicate).toBe(true);
  });
  it('applyEvent is pure and ignores events older than the last one applied', () => {
    const a = applyEvent(null, { type: 'membership.activated', data: { id: 'mem_a', status: 'active' }, at: '2026-11-20T00:00:00Z' })!;
    expect(applyEvent(a, { type: 'membership.deactivated', data: { id: 'mem_a' }, at: '2026-11-19T00:00:00Z' })).toBeNull();
    expect(applyEvent(a, { type: 'membership.deactivated', data: { id: 'mem_a' }, at: '2026-11-21T00:00:00Z' })?.status).toBe('expired');
  });
});

describe('canceled/expired regressions', () => {
  it('CAN-001: a canceled event cannot revive an expired or locked-trial account', async () => {
    await send('c1', 'membership.activated', { id: 'mem_a', status: 'trialing', updated_at: iso(Date.now() - 20 * DAY) });
    await send('c1', 'membership.deactivated', { id: 'mem_a', status: 'expired', updated_at: iso(Date.now() - 10 * DAY) });
    await send('c1', 'membership.activated', { id: 'mem_b', status: 'trialing', updated_at: iso(Date.now() - 2 * DAY) });
    await send('c1', 'membership.cancel_at_period_end_changed', { id: 'mem_b', status: 'canceled', renewal_period_end: sec(Date.now() + 5 * DAY), updated_at: iso(Date.now()) });
    expect(await access('c1')).toBe(false);
    await send('c2', 'membership.activated', { id: 'mem_a', status: 'active', updated_at: iso(Date.now() - 3 * DAY) });
    await send('c2', 'membership.deactivated', { id: 'mem_a', updated_at: iso(Date.now() - DAY) });
    await send('c2', 'membership.updated', { id: 'mem_a', status: 'canceled', renewal_period_end: sec(Date.now() + 5 * DAY), updated_at: iso(Date.now()) });
    expect(await access('c2')).toBe(false);
  });
  it('CAN-001: canceling a live membership keeps access to its period end but never extends it', async () => {
    await send('c3', 'membership.activated', { id: 'mem_a', status: 'active', renewal_period_end: sec(Date.now() + 3 * DAY), updated_at: iso(Date.now() - 60000) });
    await send('c3', 'membership.updated', { id: 'mem_a', status: 'canceled', renewal_period_end: sec(Date.now() + 30 * DAY), updated_at: iso(Date.now()) });
    const m = await getMember(db, 'c3');
    expect(m?.status).toBe('canceled');
    expect(Math.abs(Date.parse(m!.expires_at!) - (Date.now() + 3 * DAY))).toBeLessThan(5000);
    expect(await access('c3')).toBe(true);
  });
  it('CAN-002: went_invalid / deactivated ends access immediately', async () => {
    await send('c4', 'membership.activated', { id: 'mem_a', status: 'active', renewal_period_end: sec(Date.now() + 5 * DAY), updated_at: iso(Date.now() - 60000) });
    await send('c4', 'membership.went_invalid', { id: 'mem_a', status: 'canceled', valid: false, updated_at: iso(Date.now()) });
    expect(await access('c4')).toBe(false);
  });
});

describe('TRI-015', () => {
  it('a date-only period end means the end of that day in US Eastern', async () => {
    const { memberDate } = await import('../src/lib/membership');
    const iso = toIso('2026-12-11')!;
    expect(memberDate(iso)).toBe('Dec 11, 2026');
    expect(Date.parse(iso)).toBeGreaterThan(Date.parse('2026-12-11T23:00:00-05:00'));
  });
});
