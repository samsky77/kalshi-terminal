// GET /api/kalshi?sport=nba[&source=fixture] -> grouped games + contracts for one sport (read-only proxy).
import { kalshiFixtureSnapshot } from '@/server/fixtures';
import { loadSport } from '@/server/kalshi';
import { json, parseSport } from '@/server/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const sport = parseSport(u.searchParams.get('sport'));
  if (!sport) return json({ error: 'sport must be one of nba,nfl,nhl,ncaaf,ncaab,tennis,soccer' }, 400);
  if (u.searchParams.get('source') === 'fixture') {
    const snap = kalshiFixtureSnapshot(sport);
    return snap ? json(snap) : json({ error: 'no fixture' }, 404);
  }
  try {
    const snap = await loadSport(sport);
    // drop games that started more than 6 hours ago (already decided or nearly so)
    snap.games = snap.games.filter((g) => Date.parse(g.startTime) > Date.now() - 6 * 3600e3);
    return json(snap, 200, { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=30' });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
