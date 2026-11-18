export type SportId = 'nba' | 'nhl' | 'nfl' | 'cbb' | 'cfb' | 'soccer' | 'tennis';
export const SPORTS: SportId[] = ['nba', 'nhl', 'nfl', 'cbb', 'cfb', 'soccer', 'tennis'];

export type MarketType = 'ml' | 'spread' | 'total' | 'prop';
export type Side = 'home' | 'away' | 'draw' | 'over' | 'under';

/** One bettable selection. Spread lines are from the selection's own side (home −2.5). */
export interface Selection {
  market: MarketType;
  side: Side;
  line?: number;
  /** Props only. */
  player?: string;
  stat?: string;
}

/** Fractional outcome of a bet: quarter (Asian) lines split into halves. */
export interface OutcomeProbs {
  win: number;
  push: number;
  loss: number;
}

export type BetResult = 'win' | 'loss' | 'push' | 'half_win' | 'half_loss' | 'void';

/** Joint simulated final-score distribution (one entry per Monte Carlo run). */
export interface SimSamples {
  n: number;
  home: Int16Array;
  away: Int16Array;
  /** 1 home win, -1 away win, 0 draw/tie (after OT/shootout rules for the sport). */
  winner: Int8Array;
  /** Props: player key ("Name|stat") -> simulated stat per run. */
  props?: Record<string, Float32Array>;
}

export interface FinalScore {
  home: number;
  away: number;
  /** Explicit winner when the score alone doesn't decide it (tennis: games ≠ match). */
  winner?: 1 | -1 | 0;
  /** Props: player key -> final stat. Missing key means the player did not play (void). */
  props?: Record<string, number>;
}

export type Grade = 'A' | 'B' | 'none';
