// GET /api/odds/fixture?sport=nba -> recorded odds batches (demo mode and offline development).
import { oddsFixtureFile } from '@/server/fixtures';
import { json, parseSport } from '@/server/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sport = parseSport(new URL(req.url).searchParams.get('sport'));
  if (!sport) return json({ error: 'bad sport' }, 400);
  const f = oddsFixtureFile(sport);
  return f ? json(f) : json({ error: 'no fixture' }, 404);
}
