import { ODDS_CREDITS_PER_KEY } from '@/core/sports';
import type { Sport } from '@/core/types';
import { loadSport } from './kalshi';
import { kalshiFixtureSnapshot } from './fixtures';
import { keysForGames, oddsMode, oddsStatus } from './odds';

/** Which odds keys a refresh of this sport would fetch, and what it costs. Free to compute. */
export async function planRefresh(sport: Sport) {
  const { sports, credits } = await oddsStatus();
  const snap = oddsMode() === 'live' ? await loadSport(sport) : kalshiFixtureSnapshot(sport);
  const { keys, unmapped } = keysForGames(sport, snap?.games ?? [], sports);
  return { sport, keys, unmapped, cost: oddsMode() === 'live' ? keys.length * ODDS_CREDITS_PER_KEY : 0, credits };
}
