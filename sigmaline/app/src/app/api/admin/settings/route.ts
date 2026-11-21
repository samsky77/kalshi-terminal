import { setSetting } from '@sigmaline/db';
import { viewerFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Admin only: the alert threshold. Grade boundaries live in GRADE_CONFIG (code + FAQ), not in settings. */
export async function POST(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.admin) return Response.json({ error: 'admin only' }, { status: 403 });
  const f = await req.formData();
  const alert = Number(f.get('alert'));
  if (!(alert > 0 && alert < 0.5)) return Response.json({ error: 'alert EV must be between 0 and 50%' }, { status: 400 });
  const db = await getDb();
  await setSetting(db, 'alertEv', alert);
  return Response.redirect(new URL('/admin?saved=1', req.url), 303);
}
