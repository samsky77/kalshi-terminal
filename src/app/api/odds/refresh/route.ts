// POST /api/odds/refresh {sport, horizonHours?} -> one credit-spending refresh. The app calls it once a day per sport, only for games starting within horizonHours.
import { json, parseSport } from '@/server/params';
import { planRefresh } from '@/server/plan';
import { oddsStatus, recentBatches, refreshOdds, ReserveError } from '@/server/odds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Refreshes can spend paid credits, so only this app's own pages may trigger one (no other sites, scripts or crawlers). */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = req.headers.get('origin'), host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

const COOLDOWN_MS = 15 * 60_000;

export async function POST(req: Request) {
  if (!sameOrigin(req) || !(req.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'Refresh is only available from inside the app.' }, 403);
  let raw: unknown = null;
  try { raw = await req.json(); } catch { /* empty */ }
  const body = (raw && typeof raw === 'object' ? raw : {}) as { sport?: string; horizonHours?: number };
  const sport = parseSport(body.sport);
  if (!sport) return json({ error: 'bad sport' }, 400);
  try {
    const plan = await planRefresh(sport, typeof body.horizonHours === 'number' && body.horizonHours > 0 ? body.horizonHours : undefined);
    if (!plan.keys.length) return json({ error: 'Kalshi has no open games for this sport that sportsbooks cover right now, so there is nothing to fetch.', plan }, 409);
    // Cooldown: lines fetched in the last 15 minutes are returned as they are, without another upstream call or any credits.
    const recent = recentBatches(plan.keys, COOLDOWN_MS);
    if (recent) {
      const { credits } = await oddsStatus();
      return json({ mode: 'live', sport, keys: plan.keys, cost: 0, creditsBefore: credits.remaining, credits, batches: recent, errors: ['refreshed less than 15 minutes ago, showing those lines'], unmapped: plan.unmapped });
    }
    const r = await refreshOdds(sport, plan.keys, plan.counts);
    return json({ ...r, unmapped: plan.unmapped });
  } catch (e) {
    if (e instanceof ReserveError) return json({ error: e.message, remaining: e.remaining, cost: e.cost }, 409);
    return json({ error: 'The odds source could not be reached. Try again in a minute.' }, 502);
  }
}
