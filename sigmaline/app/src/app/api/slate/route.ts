import { SPORTS, type SportId } from '@sigmaline/core';
import { unauthorized, viewerFromRequest } from '@/lib/auth';
import { slate } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** Paid: the slate for one sport. Membership is checked on every request (10-min cache). */
export async function GET(req: Request) {
  const v = await viewerFromRequest(req);
  if (!v.active) return unauthorized();
  const s = new URL(req.url).searchParams.get('sport') ?? 'nba';
  if (!(SPORTS as string[]).includes(s)) return Response.json({ error: 'unknown sport' }, { status: 400 });
  return Response.json(await slate(s as SportId), { headers: { 'cache-control': 'private, no-store' } });
}
