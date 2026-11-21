import { getMember } from '@sigmaline/db';
import { getDb } from '@/lib/db';
import { applyEvent, toIso } from '@/lib/membership';
import { verifyWebhook } from '@/lib/whop';

export const dynamic = 'force-dynamic';

/**
 * Whop membership webhooks (Standard Webhooks signature, verified server-side). Each verified event
 * goes through `applyEvent` (lib/membership.ts), which ignores out-of-order events and impossible
 * transitions and enforces one free trial per account. Idempotent on the webhook-id header; an
 * event is marked processed only after it has been applied, so a failure is retried by Whop.
 */
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 256 * 1024) return Response.json({ error: 'too large' }, { status: 413 });
  const secret = process.env.WHOP_WEBHOOK_SECRET ?? '';
  if (!(await verifyWebhook(body, req.headers, secret))) return Response.json({ error: 'bad signature' }, { status: 401 });
  const id = req.headers.get('webhook-id')!;
  let evt: any;
  try { evt = JSON.parse(body); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const type: string = String(evt.type ?? evt.action ?? '');
  const db = await getDb();
  if ((await db.select('webhook_events', { eq: { id }, limit: 1 })).length) return Response.json({ ok: true, duplicate: true });
  const done = async (result: Record<string, unknown>) => {
    await db.insertIgnore('webhook_events', [{ id, type, payload: evt, received_at: new Date().toISOString() }], 'id');
    return Response.json({ ok: true, ...result });
  };
  const data = evt.data ?? {};
  const productId = data.product?.id ?? data.product_id ?? data.access_pass?.id ?? data.plan?.product_id;
  // When a product is configured, an event must name it (an event with no product can't unlock it).
  if (process.env.WHOP_PRODUCT_ID && productId !== process.env.WHOP_PRODUCT_ID) return done({ ignored: productId ? 'other product' : 'no product' });
  const userId: string | undefined = data.user?.id ?? data.user_id ?? data.member?.user?.id;
  if (!userId) return done({ ignored: 'no user' });
  const prev = await getMember(db, userId);
  // Event time: Whop's own updated_at / created_at, else the signed webhook timestamp.
  const at = toIso(data.updated_at ?? evt.created_at ?? data.created_at) ?? toIso(req.headers.get('webhook-timestamp')) ?? new Date().toISOString();
  const next = applyEvent(prev, { type, data, at });
  if (!next) return done({ ignored: `${type} (out of order or no change)` });
  await db.upsert('members', {
    whop_user_id: userId, email: data.user?.email ?? data.email ?? prev?.email ?? undefined,
    status: next.status, expires_at: next.expires_at ?? null, cancel_at_period_end: next.cancel_at_period_end ?? false,
    trial_ends_at: next.trial_ends_at ?? null, first_trial_at: next.first_trial_at ?? null, membership_id: next.membership_id ?? null,
    last_event_at: next.last_event_at ?? null, checked_at: new Date().toISOString(),
  }, 'whop_user_id');
  return done({ status: next.status });
}
