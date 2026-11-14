import type { MarketKind, Sport } from './types';

/**
 * SEED MAP: Kalshi league prefixes -> sport + The Odds API sport key.
 * This is the only hardcoded part of discovery. Actual series tickers are discovered
 * from GET /series?category=Sports by matching `<prefix><TYPE SUFFIX>` (see kalshi/discover.ts).
 * For tennis the Odds API key is chosen per tournament at runtime (oddsKey = null here).
 */
export interface LeagueSeed {
  prefix: string;
  sport: Sport;
  oddsKey: string | null;
  name: string;
}

export const LEAGUE_SEEDS: LeagueSeed[] = [
  { prefix: 'KXNBA', sport: 'nba', oddsKey: 'basketball_nba', name: 'NBA' },
  { prefix: 'KXNFL', sport: 'nfl', oddsKey: 'americanfootball_nfl', name: 'NFL' },
  { prefix: 'KXNHL', sport: 'nhl', oddsKey: 'icehockey_nhl', name: 'NHL' },
  { prefix: 'KXNCAAF', sport: 'ncaaf', oddsKey: 'americanfootball_ncaaf', name: 'NCAAF (FBS)' },
  { prefix: 'KXNCAAFCS', sport: 'ncaaf', oddsKey: 'americanfootball_ncaaf_fcs', name: 'NCAAF (FCS)' },
  { prefix: 'KXNCAAMB', sport: 'ncaab', oddsKey: 'basketball_ncaab', name: "NCAAB (Men's)" },
  { prefix: 'KXATP', sport: 'tennis', oddsKey: null, name: 'ATP' },
  { prefix: 'KXWTA', sport: 'tennis', oddsKey: null, name: 'WTA' },
  { prefix: 'KXEPL', sport: 'soccer', oddsKey: 'soccer_epl', name: 'Premier League' },
  { prefix: 'KXLALIGA', sport: 'soccer', oddsKey: 'soccer_spain_la_liga', name: 'La Liga' },
  { prefix: 'KXLALIGA2', sport: 'soccer', oddsKey: 'soccer_spain_segunda_division', name: 'La Liga 2' },
  { prefix: 'KXBUNDESLIGA', sport: 'soccer', oddsKey: 'soccer_germany_bundesliga', name: 'Bundesliga' },
  { prefix: 'KXBUNDESLIGA2', sport: 'soccer', oddsKey: 'soccer_germany_bundesliga2', name: 'Bundesliga 2' },
  { prefix: 'KXSERIEA', sport: 'soccer', oddsKey: 'soccer_italy_serie_a', name: 'Serie A' },
  { prefix: 'KXSERIEB', sport: 'soccer', oddsKey: 'soccer_italy_serie_b', name: 'Serie B' },
  { prefix: 'KXLIGUE1', sport: 'soccer', oddsKey: 'soccer_france_ligue_one', name: 'Ligue 1' },
  { prefix: 'KXMLS', sport: 'soccer', oddsKey: 'soccer_usa_mls', name: 'MLS' },
  { prefix: 'KXUCL', sport: 'soccer', oddsKey: 'soccer_uefa_champs_league', name: 'Champions League' },
  { prefix: 'KXUEL', sport: 'soccer', oddsKey: 'soccer_uefa_europa_league', name: 'Europa League' },
  { prefix: 'KXEREDIVISIE', sport: 'soccer', oddsKey: 'soccer_netherlands_eredivisie', name: 'Eredivisie' },
  { prefix: 'KXLIGAPORTUGAL', sport: 'soccer', oddsKey: 'soccer_portugal_primeira_liga', name: 'Primeira Liga' },
  { prefix: 'KXLIGAMX', sport: 'soccer', oddsKey: 'soccer_mexico_ligamx', name: 'Liga MX' },
];

/**
 * Series type suffixes accepted in v1. Anything else under a league prefix (1H, quarters,
 * props, futures, team totals, series, parlays/MVE) is excluded by construction.
 */
export const TYPE_SUFFIXES: { suffix: string; kind: MarketKind }[] = [
  { suffix: 'GAME', kind: 'winner' },
  { suffix: 'MATCH', kind: 'winner' },
  { suffix: 'SPREAD', kind: 'spread' },
  { suffix: 'GSPREAD', kind: 'spread' }, // tennis game spread
  { suffix: 'TOTAL', kind: 'total' },
  { suffix: 'GTOTAL', kind: 'total' }, // tennis total games
  { suffix: 'TIE', kind: 'tie' }, // NFL tie market
];

export const SPORT_LABEL: Record<Sport, string> = {
  nba: 'NBA',
  nfl: 'NFL',
  nhl: 'NHL',
  ncaaf: 'CFB',
  ncaab: 'CBB',
  tennis: 'TEN',
  soccer: 'SOC',
};

/** One "score unit" for confidence tier B (strike within one unit of the main line). */
export const SCORE_UNIT: Record<Sport, number> = {
  nba: 3, // a three-pointer
  ncaab: 3,
  nfl: 3, // a field goal
  ncaaf: 3,
  nhl: 1, // a goal
  soccer: 1,
  tennis: 1, // a game
};

/** Typical game duration, used only to back out a start time when no milestone exists. */
export const DURATION_HOURS: Record<Sport, number> = {
  nba: 2.5, ncaab: 2.25, nfl: 3.25, ncaaf: 3.5, nhl: 2.5, soccer: 2, tennis: 2,
};

/**
 * Model constants for the correlated-normal sports. See docs/MODEL.md for sources and caveats.
 * totalSd: SD of final total points around the closing total.
 * rho: correlation between home margin and total (signed). 0 by symmetry, see MODEL.md.
 * sigmaFallback / sigmaRange: margin SD used when the moneyline is uninformative (pick'em) and bounds for the solve.
 * regMinutes / otMinutes: for basketball OT simulation.
 */
export interface NormalConstants {
  totalSd: number;
  rho: number;
  sigmaFallback: number;
  sigmaRange: [number, number];
  regMinutes?: number;
  otMinutes?: number;
  /** |spread| below which sigma is not solved from the moneyline (ill-conditioned). */
  minSolveSpread: number;
  /** Football key-number snap probabilities (see MODEL.md). */
  keySnap?: { s3: number; s7: number };
}

export const NORMAL_CONSTANTS: Record<'nba' | 'ncaab' | 'nfl' | 'ncaaf', NormalConstants> = {
  nba: { totalSd: 18.0, rho: 0, sigmaFallback: 12.0, sigmaRange: [7.5, 15], regMinutes: 48, otMinutes: 5, minSolveSpread: 3 },
  ncaab: { totalSd: 16.0, rho: 0, sigmaFallback: 11.0, sigmaRange: [7, 14.5], regMinutes: 40, otMinutes: 5, minSolveSpread: 3 },
  nfl: { totalSd: 13.5, rho: 0, sigmaFallback: 13.86, sigmaRange: [10, 16.5], minSolveSpread: 3, keySnap: { s3: 0.8, s7: 0.35 } },
  ncaaf: { totalSd: 16.0, rho: 0, sigmaFallback: 16.0, sigmaRange: [12, 22], minSolveSpread: 3, keySnap: { s3: 0.5, s7: 0.15 } },
};

/** NHL: share of OT/shootout games decided in 3-on-3 OT (rest by shootout, treated as a coin flip). */
export const NHL_OT_DECIDED_SHARE = 0.6;
/**
 * NHL late-game goalie pull (see MODEL.md). When regulation ends with a 1-goal lead the trailing team
 * has pulled its goalie: leader adds an empty-net goal with EN_LEAD1, trailer equalises with EQ_LEAD1.
 * With a 2-goal lead the leader adds an empty-netter with EN_LEAD2.
 */
export const NHL_EMPTY_NET = { EN_LEAD1: 0.22, EQ_LEAD1: 0.08, EN_LEAD2: 0.12 };
/** NFL regular season: P(game still tied after the 10-minute OT period). */
export const NFL_OT_TIE_RATE = 0.12;

/** Tennis tour-average serve-point win rates, used when no totals line is available. */
export const TENNIS_SERVE_AVG = { ATP: 0.64, WTA: 0.56 };

export const SIM_RUNS = 20000;
export const VALUE_MIN_EDGE = 0.02;
export const STALE_HOURS = 6;
export const MATCH_WINDOW_HOURS = 3;
export const ODDS_RESERVE = 30;
export const ODDS_CREDITS_PER_KEY = 3; // markets (h2h,spreads,totals) x regions (us)
