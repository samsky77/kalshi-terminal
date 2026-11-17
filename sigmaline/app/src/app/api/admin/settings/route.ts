import { setSetting } from '@sigmaline/db';
import { viewerFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Admin only: grade thresholds and the alert (publish) threshold. */
export async function POST(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.admin) return Response.json({ error: 'admin only' }, { status: 403 });
  const f = await req.formData();
  const a = Number(f.get('a')), b = Number(f.get('b')), alert = Number(f.get('alert'));
  if (!(a > 0 && a < 0.5 && b > 0 && b <= a && alert > 0 && alert < 0.5)) return Response.json({ error: 'thresholds must satisfy 0 < B ≤ A < 50%' }, { status: 400 });
  const db = await getDb();
  await setSetting(db, 'thresholds', { a, b });
  await setSetting(db, 'alertEv', alert);
  return Response.redirect(new URL('/admin?saved=1', req.url), 303);
}
