import { createRng } from '../rng';
import { propKey } from '../markets';
import type { SimSamples } from '../types';

/**
 * Player props (NBA, NFL): each player's stat is negative binomial around a projected mean, and
 * the mean is scaled per simulation run by how the player's team scored in that run, so props stay
 * correlated with the game script (a shootout lifts every scorer's points).
 */
export interface PlayerProjection {
  player: string;
  stat: string;
  team: 'home' | 'away';
  /** Projected mean for this game (already adjusted for minutes/usage, opponent and pace). */
  mean: number;
  /** NB dispersion r (variance = mean + mean²/r). */
  dispersion: number;
  /** Elasticity of the stat to team scoring (1 = proportional). */
  beta: number;
}

/** How strongly each stat follows team scoring. */
export const PROP_BETA: Record<string, number> = {
  player_points: 1, player_threes: 0.9, player_assists: 0.8, player_rebounds: 0.4,
  player_points_rebounds_assists: 0.85, player_pass_yds: 0.8, player_pass_tds: 1,
  player_rush_yds: 0.4, player_reception_yds: 0.8, player_receptions: 0.6,
};

export interface GameLogRow { value: number; minutes?: number; daysAgo: number }

/**
 * Recency-weighted mean and dispersion from a player's game logs, scaled to projected minutes
 * when minutes are available, then adjusted for opponent and pace multipliers.
 */
export function projectFromLogs(
  logs: GameLogRow[],
  opts: { halfLifeDays: number; projectedMinutes?: number; opponentFactor?: number; paceFactor?: number },
): { mean: number; dispersion: number } | null {
  const rows = logs.filter((r) => Number.isFinite(r.value));
  if (rows.length < 5) return null;
  let sw = 0, sv = 0, sm = 0, smw = 0;
  for (const r of rows) {
    const w = Math.pow(0.5, r.daysAgo / opts.halfLifeDays);
    sw += w; sv += w * r.value;
    if (r.minutes && r.minutes > 0) { sm += w * r.minutes; smw += w; }
  }
  let mean = sv / sw;
  if (opts.projectedMinutes && smw > 0) mean *= opts.projectedMinutes / (sm / smw);
  mean *= (opts.opponentFactor ?? 1) * (opts.paceFactor ?? 1);
  // Method-of-moments dispersion on the raw logs.
  const m0 = rows.reduce((s, r) => s + r.value, 0) / rows.length;
  const v0 = rows.reduce((s, r) => s + (r.value - m0) ** 2, 0) / Math.max(1, rows.length - 1);
  const excess = v0 - m0;
  const dispersion = excess > 1e-6 ? Math.min(60, Math.max(1.5, (m0 * m0) / excess)) : 60;
  return { mean: Math.max(0, mean), dispersion };
}

/** Add prop draws to an existing game simulation (in place) and return it. */
export function simulateProps(game: SimSamples, players: PlayerProjection[], expectedHome: number, expectedAway: number, seed: number): SimSamples {
  const rng = createRng(seed ^ 0x5bd1e995);
  const props: Record<string, Float32Array> = { ...(game.props ?? {}) };
  for (const pl of players) {
    const arr = new Float32Array(game.n);
    const exp = pl.team === 'home' ? expectedHome : expectedAway;
    for (let i = 0; i < game.n; i++) {
      const sc = pl.team === 'home' ? game.home[i] : game.away[i];
      const scale = exp > 0 ? Math.pow(Math.max(0.2, sc / exp), pl.beta) : 1;
      arr[i] = rng.negBin(pl.mean * scale, pl.dispersion);
    }
    props[propKey(pl.player, pl.stat)] = arr;
  }
  game.props = props;
  return game;
}
