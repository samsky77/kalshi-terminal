// GET /api/odds/status -> mode (live|fixture), credits left (free /v4/sports call), reserve.
import { ODDS_CREDITS_PER_KEY, ODDS_RESERVE } from '@/core/sports';
import { oddsMode, oddsStatus } from '@/server/odds';
import { json } from '@/server/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { credits } = await oddsStatus();
    return json({ mode: oddsMode(), credits, reserve: ODDS_RESERVE, costPerKey: ODDS_CREDITS_PER_KEY });
  } catch (e) {
    return json({ mode: oddsMode(), credits: null, reserve: ODDS_RESERVE, costPerKey: ODDS_CREDITS_PER_KEY, error: (e as Error).message });
  }
}
