import { unauthorized, viewerFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Paid: save (POST) or remove (DELETE) this device's Web Push subscription. */
export async function POST(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.active || !v.session) return unauthorized();
  const body = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!body?.endpoint || !/^https:\/\//.test(body.endpoint) || !body.keys?.p256dh || !body.keys?.auth) return Response.json({ error: 'bad subscription' }, { status: 400 });
  const db = await getDb();
  await db.upsert('members', { whop_user_id: v.session.uid, push_enabled: true }, 'whop_user_id');
  await db.upsert('push_subscriptions', { whop_user_id: v.session.uid, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null }, 'endpoint');
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.active || !v.session) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  const db = await getDb();
  if (body.endpoint) await db.update('push_subscriptions', { endpoint: body.endpoint, whop_user_id: v.session.uid }, { auth: 'expired' });
  await db.upsert('members', { whop_user_id: v.session.uid, push_enabled: false }, 'whop_user_id');
  return Response.json({ ok: true });
}
