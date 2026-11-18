/**
 * The Odds API (the-odds-api.com): fallback game lines, plus scores and results.
 *
 * LICENSE NOTE (see docs/licensing.md): commercial display is allowed as long as their data isn't
 * the main thing being sold. Sigmaline sells model output; odds appear only as pick context.
 * Free plan: 500 credits/month. Cost of /odds = markets × regions (a `bookmakers` list of up to
 * 10 books counts as one region); /scores with daysFrom = 2; historical = 10×. /sports and
 * /events are free. Usage is read from the x-requests-used / x-requests-remaining headers.
 */
import { SPORT_DEFS, type OddsApiEvent, type SportId } from '@sigmaline/core';
import { getJson } from './http';
import { cleanEvents, type DataProvider, type LeagueRef, type ProviderResult, type ScoreRow } from './types';

const BASE = 'https://api.the-odds-api.com/v4';
/** 10 books = 1 region-equivalent. Pinnacle is included for the consensus (double weight). */
export const ODDSAPI_BOOKS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'espnbet', 'fanatics', 'ballybet', 'hardrockbet'];

export class OddsApiProvider implements DataProvider {
  readonly id = 'oddsapi' as const;
  constructor(private key: string | undefined) {}
  get enabled() { return !!this.key; }

  leagueKey(sport: SportId, leagueId: string): string | null {
    if (sport === 'tennis') return leagueId.startsWith('tennis_') ? leagueId : null;
    return SPORT_DEFS[sport].leagues.find((l) => l.id === leagueId)?.oddsApiKey ?? null;
  }

  private remaining(h: Headers): number | undefined {
    const r = h.get('x-requests-remaining');
    return r === null ? undefined : Number(r);
  }
  private last(h: Headers, fallback: number): number {
    const l = h.get('x-requests-last');
    return l === null ? fallback : Number(l);
  }

  /** Free: active sports, used to discover tennis tournament keys. */
  async activeTennisKeys(): Promise<string[]> {
    const { body } = await getJson<{ key: string; active: boolean }[]>(`${BASE}/sports?apiKey=${this.key}`);
    return body.filter((s) => s.active && s.key.startsWith('tennis_')).map((s) => s.key);
  }

  async getEvents(league: LeagueRef): Promise<ProviderResult<OddsApiEvent[]>> {
    const { body, headers } = await getJson<OddsApiEvent[]>(`${BASE}/sports/${league.key}/events?apiKey=${this.key}&dateFormat=iso`);
    return { data: body, cost: this.last(headers, 0), remaining: this.remaining(headers), priceFormat: 'decimal' };
  }

  async getOdds(league: LeagueRef, opts: { markets: string[]; eventIds?: string[] }): Promise<ProviderResult<OddsApiEvent[]>> {
    const markets = opts.markets.join(',');
    const ids = opts.eventIds?.length ? `&eventIds=${opts.eventIds.join(',')}` : '';
    const url = `${BASE}/sports/${league.key}/odds?apiKey=${this.key}&bookmakers=${ODDSAPI_BOOKS.join(',')}&markets=${markets}&oddsFormat=decimal&dateFormat=iso${ids}`;
    const { body, headers } = await getJson<OddsApiEvent[]>(url);
    return { data: cleanEvents(body), cost: this.last(headers, opts.markets.length), remaining: this.remaining(headers), priceFormat: 'decimal' };
  }

  async getScores(league: LeagueRef, daysFrom: number): Promise<ProviderResult<ScoreRow[]>> {
    type S = { id: string; sport_key: string; commence_time: string; completed: boolean; home_team: string; away_team: string; scores: { name: string; score: string }[] | null };
    const { body, headers } = await getJson<S[]>(`${BASE}/sports/${league.key}/scores?apiKey=${this.key}&daysFrom=${Math.min(3, Math.max(1, daysFrom))}&dateFormat=iso`);
    const data = body.map((s) => {
      const hs = s.scores?.find((x) => x.name === s.home_team)?.score, as = s.scores?.find((x) => x.name === s.away_team)?.score;
      return {
        providerEventId: s.id, sportKey: s.sport_key, home: s.home_team, away: s.away_team, commence: s.commence_time, completed: s.completed,
        homeScore: hs === undefined ? null : Number(hs), awayScore: as === undefined ? null : Number(as),
      };
    });
    return { data, cost: this.last(headers, 2), remaining: this.remaining(headers), priceFormat: 'decimal' };
  }

  async getHistory(league: LeagueRef, dateIso: string, markets: string[]): Promise<ProviderResult<OddsApiEvent[]>> {
    const url = `${BASE}/historical/sports/${league.key}/odds?apiKey=${this.key}&bookmakers=${ODDSAPI_BOOKS.join(',')}&markets=${markets.join(',')}&oddsFormat=decimal&date=${dateIso}`;
    const { body, headers } = await getJson<{ data: OddsApiEvent[] }>(url);
    return { data: cleanEvents(body.data ?? []), cost: this.last(headers, 10 * markets.length), remaining: this.remaining(headers), priceFormat: 'decimal' };
  }
}
