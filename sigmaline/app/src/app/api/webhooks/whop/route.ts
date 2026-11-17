import { getDb } from '@/lib/db';
import { statusFor, verifyWebhook } from '@/lib/whop';

export const dynamic = 'force-dynamic';

/**
 * Whop membership webhooks (Standard Webhooks signature). Handles created / renewed (valid,
 * activated, payment succeeded) and cancelled / expired (invalid, deactivated). Idempotent on
 * the webhook-id header.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const secret = process.env.WHOP_WEBHOOK_SECRET ?? '';
  if (!(await verifyWebhook(body, req.headers, secret))) return Response.json({ error: 'bad signature' }, { status: 401 });
  const id = req.headers.get('webhook-id')!;
  let evt: any;
  try { evt = JSON.parse(body); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const type: string = String(evt.type ?? evt.action ?? '');
  const db = await getDb();
  const fresh = await db.insertIgnore('webhook_events', [{ id, type, payload: evt, received_at: new Date().toISOString() }], 'id');
  if (!fresh) return Response.json({ ok: true, duplicate: true });
  const data = evt.data ?? {};
  const productId = data.product?.id ?? data.product_id ?? data.access_pass?.id;
  if (process.env.WHOP_PRODUCT_ID && productId && productId !== process.env.WHOP_PRODUCT_ID) return Response.json({ ok: true, ignored: 'other product' });
  const userId: string | undefined = data.user?.id ?? data.user_id ?? data.member?.user?.id;
  if (!userId) return Response.json({ ok: true, ignored: 'no user' });
  const status = statusFor(type, data);
  if (!status) return Response.json({ ok: true, ignored: type });
  const expires = data.renewal_period_end ?? data.expires_at ?? data.valid_until ?? null;
  await db.upsert('members', {
    whop_user_id: userId, email: data.user?.email ?? data.email ?? undefined, status,
    expires_at: typeof expires === 'number' ? new Date(expires * 1000).toISOString() : expires, checked_at: new Date().toISOString(),
  }, 'whop_user_id');
  return Response.json({ ok: true, status });
}

