import type { SportId } from './types';

export interface LeagueDef {
  id: string;
  label: string;
  /** The Odds API sport key (tennis keys are discovered from /v4/sports at run time). */
  oddsApiKey?: string;
  /** PropLine sport key. */
  propLineKey?: string;
  /** SharpAPI league id (best guess; adapter is off by default — see docs/licensing.md). */
  sharpApiLeague?: string;
}

export interface SportDef {
  id: SportId;
  tab: string;
  label: string;
  leagues: LeagueDef[];
  threeWay: boolean;
  /** Recency half-life (days) for ratings; retuned nightly. */
  halfLifeDays: number;
  ridge: number;
  hfaPrior: number;
  /** Min games per team before ratings are used instead of the market-implied fallback. */
  minGames: number;
  /** Relative pull weight for the request budgeter (bigger slates get more pulls). */
  budgetWeight: number;
  propsFlag?: 'PROPS_NBA_ENABLED' | 'PROPS_NFL_ENABLED';
  /** Expected game length in hours (used to decide when to look for a final score). */
  durationHours: number;
}

export const SPORT_DEFS: Record<SportId, SportDef> = {
  nba: {
    id: 'nba', tab: 'NBA', label: 'NBA', threeWay: false, halfLifeDays: 45, ridge: 3, hfaPrior: 2.4, minGames: 8, budgetWeight: 3,
    leagues: [{ id: 'nba', label: 'NBA', oddsApiKey: 'basketball_nba', propLineKey: 'basketball_nba', sharpApiLeague: 'nba' }],
    propsFlag: 'PROPS_NBA_ENABLED', durationHours: 2.6,
  },
  nhl: {
    id: 'nhl', tab: 'NHL', label: 'NHL', threeWay: false, halfLifeDays: 60, ridge: 4, hfaPrior: 0.05, minGames: 10, budgetWeight: 2,
    leagues: [{ id: 'nhl', label: 'NHL', oddsApiKey: 'icehockey_nhl', propLineKey: 'hockey_nhl', sharpApiLeague: 'nhl' }],
    durationHours: 2.8,
  },
  nfl: {
    id: 'nfl', tab: 'NFL', label: 'NFL', threeWay: false, halfLifeDays: 120, ridge: 2, hfaPrior: 1.7, minGames: 4, budgetWeight: 3,
    leagues: [{ id: 'nfl', label: 'NFL', oddsApiKey: 'americanfootball_nfl', propLineKey: 'football_nfl', sharpApiLeague: 'nfl' }],
    propsFlag: 'PROPS_NFL_ENABLED', durationHours: 3.4,
  },
  cbb: {
    id: 'cbb', tab: 'CBB', label: 'College Basketball', threeWay: false, halfLifeDays: 50, ridge: 3, hfaPrior: 3.2, minGames: 6, budgetWeight: 3,
    leagues: [{ id: 'ncaab', label: 'NCAAB', oddsApiKey: 'basketball_ncaab', propLineKey: 'basketball_ncaab', sharpApiLeague: 'ncaab' }],
    durationHours: 2.3,
  },
  cfb: {
    id: 'cfb', tab: 'CFB', label: 'College Football', threeWay: false, halfLifeDays: 120, ridge: 2, hfaPrior: 2.6, minGames: 4, budgetWeight: 2,
    leagues: [{ id: 'ncaaf', label: 'NCAAF', oddsApiKey: 'americanfootball_ncaaf', propLineKey: 'football_ncaaf', sharpApiLeague: 'ncaaf' }],
    durationHours: 3.6,
  },
  soccer: {
    id: 'soccer', tab: 'SOC', label: 'Soccer', threeWay: true, halfLifeDays: 180, ridge: 3, hfaPrior: 0.22, minGames: 6, budgetWeight: 2,
    leagues: [
      { id: 'epl', label: 'EPL', oddsApiKey: 'soccer_epl', propLineKey: 'soccer_epl', sharpApiLeague: 'epl' },
      { id: 'laliga', label: 'La Liga', oddsApiKey: 'soccer_spain_la_liga', propLineKey: 'soccer_la_liga', sharpApiLeague: 'laliga' },
      { id: 'seriea', label: 'Serie A', oddsApiKey: 'soccer_italy_serie_a', propLineKey: 'soccer_serie_a', sharpApiLeague: 'seriea' },
      { id: 'bundesliga', label: 'Bundesliga', oddsApiKey: 'soccer_germany_bundesliga', propLineKey: 'soccer_bundesliga', sharpApiLeague: 'bundesliga' },
      { id: 'ligue1', label: 'Ligue 1', oddsApiKey: 'soccer_france_ligue_one', propLineKey: 'soccer_ligue_1', sharpApiLeague: 'ligue1' },
      { id: 'mls', label: 'MLS', oddsApiKey: 'soccer_usa_mls', propLineKey: 'soccer_mls', sharpApiLeague: 'mls' },
      { id: 'ucl', label: 'Champions League', oddsApiKey: 'soccer_uefa_champs_league', sharpApiLeague: 'ucl' },
    ],
    durationHours: 2,
  },
  tennis: {
    id: 'tennis', tab: 'TEN', label: 'Tennis', threeWay: false, halfLifeDays: 120, ridge: 1, hfaPrior: 0, minGames: 10, budgetWeight: 1,
    leagues: [{ id: 'tennis', label: 'ATP/WTA', propLineKey: 'tennis', sharpApiLeague: 'tennis' }],
    durationHours: 3,
  },
};

export function sportOfOddsKey(key: string): SportId | null {
  if (key.startsWith('tennis_')) return 'tennis';
  for (const s of Object.values(SPORT_DEFS)) if (s.leagues.some((l) => l.oddsApiKey === key)) return s.id;
  return null;
}
