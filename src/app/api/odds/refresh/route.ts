// POST /api/odds/refresh {sport, horizonHours?} -> one credit-spending refresh. The app calls it once a day per sport, only for games starting within horizonHours.
import { json, parseSport } from '@/server/params';
import { planRefresh } from '@/server/plan';
import { refreshOdds, ReserveError } from '@/server/odds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { sport?: string; horizonHours?: number } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const sport = parseSport(body.sport);
  if (!sport) return json({ error: 'bad sport' }, 400);
  try {
    const plan = await planRefresh(sport, typeof body.horizonHours === 'number' ? body.horizonHours : undefined);
    if (!plan.keys.length) return json({ error: 'No open Kalshi events map to an odds key for this sport; nothing to fetch.', plan }, 409);
    const r = await refreshOdds(sport, plan.keys, plan.counts);
    return json({ ...r, unmapped: plan.unmapped });
  } catch (e) {
    if (e instanceof ReserveError) return json({ error: e.message, remaining: e.remaining, cost: e.cost }, 409);
    return json({ error: (e as Error).message }, 502);
  }
}
