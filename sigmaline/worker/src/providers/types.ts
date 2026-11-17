import type { OddsApiEvent, ProviderId, SportId } from '@sigmaline/core';

export interface ScoreRow {
  providerEventId: string;
  sportKey: string;
  home: string;
  away: string;
  commence: string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface InjuryRow { player: string; team: string | null; status: string; code: string }
export interface PlayerGameRow { date: string; eventId?: string; stats: Record<string, number>; minutes?: number }

export interface ProviderResult<T> {
  data: T;
  /** Quota units consumed by this call (credits for The Odds API, requests elsewhere). */
  cost: number;
  /** Remaining quota reported by the provider, if it reports one. */
  remaining?: number;
  priceFormat: 'decimal' | 'american';
}

export interface LeagueRef { sport: SportId; leagueId: string; key: string }

/**
 * Shared provider interface (spec §4.1). Every method may throw; callers treat a failure as
 * "no data this tick" and never crash the job.
 */
export interface DataProvider {
  readonly id: ProviderId;
  readonly enabled: boolean;
  /** Provider's sport/league key for one of our leagues, or null if not covered. */
  leagueKey(sport: SportId, leagueId: string): string | null;
  getEvents(league: LeagueRef): Promise<ProviderResult<OddsApiEvent[]>>;
  getOdds(league: LeagueRef, opts: { markets: string[]; eventIds?: string[] }): Promise<ProviderResult<OddsApiEvent[]>>;
  getProps?(league: LeagueRef, providerEventId: string, markets: string[]): Promise<ProviderResult<OddsApiEvent | null>>;
  getScores(league: LeagueRef, daysFrom: number): Promise<ProviderResult<ScoreRow[]>>;
  /** Historical odds (The Odds API only; costs 10×). Not used by default. */
  getHistory?(league: LeagueRef, dateIso: string, markets: string[]): Promise<ProviderResult<OddsApiEvent[]>>;
  getInjuries?(league: LeagueRef): Promise<ProviderResult<InjuryRow[]>>;
  getPlayerGames?(league: LeagueRef, player: string, limit: number): Promise<ProviderResult<PlayerGameRow[]>>;
}

/** Books never used for consensus or best price. */
export const EXCLUDED_BOOKS = new Set(['kalshi', 'polymarket', 'prizepicks', 'underdog', 'pick6', 'sleeper', 'betfair_ex_us', 'novig', 'prophetx']);

export function cleanEvents(evs: OddsApiEvent[]): OddsApiEvent[] {
  return evs.map((e) => ({ ...e, bookmakers: (e.bookmakers ?? []).filter((b) => !EXCLUDED_BOOKS.has(b.key)) }));
}
