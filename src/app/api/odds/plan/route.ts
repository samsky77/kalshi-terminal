// GET /api/odds/plan?sport=soccer -> odds keys with a matching open Kalshi event, and the credit cost.
import { json, parseSport } from '@/server/params';
import { planRefresh } from '@/server/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const sport = parseSport(new URL(req.url).searchParams.get('sport'));
  if (!sport) return json({ error: 'bad sport' }, 400);
  try { return json(await planRefresh(sport)); } catch (e) { return json({ error: (e as Error).message }, 502); }
}
