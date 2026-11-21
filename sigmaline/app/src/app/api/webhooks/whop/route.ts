import { getDb } from '@/lib/db';
import { getMember } from '@sigmaline/db';
import { isRepeatTrial, statusFromWebhook } from '@/lib/membership';
import { verifyWebhook } from '@/lib/whop';

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
  const status = statusFromWebhook(type, data);
  if (!status) return Response.json({ ok: true, ignored: type });
  const toIso = (x: unknown) => (typeof x === 'number' ? new Date(x * 1000).toISOString() : typeof x === 'string' && x ? x : null);
  const expires = toIso(data.renewal_period_end ?? data.expires_at ?? data.valid_until);
  const membershipId: string | null = data.id && String(data.id).startsWith('mem_') ? String(data.id) : data.membership_id ?? data.membership?.id ?? null;
  const prev = await getMember(db, userId);
  const now = new Date().toISOString();
  // One free trial per Whop account: a second trial on a new membership doesn't unlock the app.
  const repeat = isRepeatTrial(prev, { status, membership_id: membershipId });
  await db.upsert('members', {
    whop_user_id: userId, email: data.user?.email ?? data.email ?? prev?.email ?? undefined,
    status: repeat ? 'trial_used' : status,
    expires_at: expires ?? prev?.expires_at ?? null,
    cancel_at_period_end: typeof data.cancel_at_period_end === 'boolean' ? data.cancel_at_period_end : (prev?.cancel_at_period_end ?? false),
    trial_ends_at: status === 'trialing' ? expires : (prev?.trial_ends_at ?? null),
    first_trial_at: prev?.first_trial_at ?? (status === 'trialing' ? now : null),
    membership_id: membershipId ?? prev?.membership_id ?? null,
    checked_at: now,
  }, 'whop_user_id');
  return Response.json({ ok: true, status: repeat ? 'trial_used' : status });
}

