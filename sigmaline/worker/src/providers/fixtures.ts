/**
 * Offline fixtures: real Odds API responses recorded on 2026-11-14 (see /fixtures/odds). Used for
 * tests and the local demo only (DEMO=1). Times are shifted so the recorded games sit in the
 * future relative to "now". Never used against a production database.
 */
import { readFileSync } from 'node:fs';
import { SPORT_DEFS, type OddsApiEvent, type SportId } from '@sigmaline/core';
import type { DataProvider, LeagueRef, ProviderResult, ScoreRow } from './types';

const FILES: Record<string, string> = { nba: 'nba', nhl: 'nhl', nfl: 'nfl', ncaab: 'ncaab', ncaaf: 'ncaaf', soccer: 'soccer', tennis: 'tennis' };

export class FixtureProvider implements DataProvider {
  readonly id = 'oddsapi' as const;
  readonly enabled = true;
  private cache = new Map<string, OddsApiEvent[]>();
  constructor(private dir: string, private shiftMs: number) {}
  leagueKey(sport: SportId, leagueId: string): string | null {
    if (sport === 'tennis') return 'tennis';
    return SPORT_DEFS[sport].leagues.find((l) => l.id === leagueId)?.oddsApiKey ?? null;
  }
  private load(league: LeagueRef): OddsApiEvent[] {
    const file = league.sport === 'soccer' ? 'soccer' : league.sport === 'tennis' ? 'tennis' : FILES[league.leagueId];
    const k = `${file}`;
    if (!this.cache.has(k)) {
      const raw = JSON.parse(readFileSync(`${this.dir}/${file}.json`, 'utf8')) as { batches: { sportKey: string; events: OddsApiEvent[] }[] };
      const evs = raw.batches.flatMap((b) => b.events);
      this.cache.set(k, evs);
    }
    const shift = (s: string) => new Date(Date.parse(s) + this.shiftMs).toISOString();
    return this.cache.get(k)!
      .filter((e) => league.sport === 'soccer' ? e.sport_key === league.key : league.sport === 'tennis' ? e.sport_key.startsWith('tennis_') : true)
      .map((e) => ({
        ...e, commence_time: shift(e.commence_time),
        bookmakers: (e.bookmakers ?? []).map((b) => ({ ...b, last_update: b.last_update ? shift(b.last_update) : undefined, markets: b.markets.map((m) => ({ ...m, last_update: m.last_update ? shift(m.last_update) : undefined })) })),
      }));
  }
  async getEvents(league: LeagueRef): Promise<ProviderResult<OddsApiEvent[]>> {
    return { data: this.load(league).map(({ bookmakers, ...e }) => e), cost: 0, priceFormat: 'decimal' };
  }
  async getOdds(league: LeagueRef, opts: { markets: string[]; eventIds?: string[] }): Promise<ProviderResult<OddsApiEvent[]>> {
    const ids = opts.eventIds ? new Set(opts.eventIds) : null;
    return { data: this.load(league).filter((e) => !ids || ids.has(String(e.id))), cost: opts.markets.length, priceFormat: 'decimal' };
  }
  async getScores(): Promise<ProviderResult<ScoreRow[]>> {
    return { data: [], cost: 0, priceFormat: 'decimal' };
  }
}
