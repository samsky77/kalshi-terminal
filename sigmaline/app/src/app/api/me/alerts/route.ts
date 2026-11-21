import { unauthorized, viewerFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Paid: quiet hours and time zone. */
export async function POST(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.active || !v.session) return unauthorized();
  const f = await req.formData().catch(() => null);
  const start = String(f?.get('quiet_start') ?? ''), end = String(f?.get('quiet_end') ?? ''), tz = String(f?.get('time_zone') ?? 'America/New_York');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return Response.json({ error: 'bad time zone' }, { status: 400 }); }
  const db = await getDb();
  await db.upsert('members', { whop_user_id: v.session.uid, quiet_start: HM.test(start) ? start : null, quiet_end: HM.test(end) ? end : null, time_zone: tz }, 'whop_user_id');
  return Response.redirect(appUrl('/alerts?saved=1', req), 303);
}
