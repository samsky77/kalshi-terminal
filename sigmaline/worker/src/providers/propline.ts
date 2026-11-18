/**
 * PropLine (prop-line.com): player props, and game lines / scores / injuries on the same key.
 *
 * LICENSE NOTE (see docs/licensing.md): individual odds values may be shown inside the product;
 * no bulk exports. Licensed sportsbook prices are not on the free plan, so we only show what the
 * free plan returns (free-tier responses can carry `redacted` / null prices, which are dropped).
 * DFS boards (PrizePicks, Underdog, Pick6) and Kalshi are excluded from consensus and best price.
 * Free plan: 1,000 requests/day; quota is read from X-Daily-Used / X-Daily-Remaining.
 * Responses use The Odds API's event shape with American prices.
 */
import { SPORT_DEFS, type OddsApiEvent, type SportId } from '@sigmaline/core';
import { getJson } from './http';
import { cleanEvents, type DataProvider, type InjuryRow, type LeagueRef, type PlayerGameRow, type ProviderResult, type ScoreRow } from './types';

const BASE = 'https://api.prop-line.com/v1';

function dropRedacted(evs: OddsApiEvent[]): OddsApiEvent[] {
  return evs.map((e) => ({
    ...e,
    bookmakers: (e.bookmakers ?? []).map((b) => ({
      ...b,
      markets: (b.markets ?? []).map((m) => ({ ...m, outcomes: m.outcomes.filter((o) => typeof o.price === 'number' && Number.isFinite(o.price) && !(o as any).redacted) })),
    })),
  }));
}

export class PropLineProvider implements DataProvider {
  readonly id = 'propline' as const;
  constructor(private key: string | undefined) {}
  get enabled() { return !!this.key; }

  leagueKey(sport: SportId, leagueId: string): string | null {
    return SPORT_DEFS[sport].leagues.find((l) => l.id === leagueId)?.propLineKey ?? null;
  }
  private h() { return { 'X-API-Key': this.key! }; }
  private rem(h: Headers): number | undefined {
    const r = h.get('X-Daily-Remaining');
    return r === null ? undefined : Number(r);
  }

  async getEvents(league: LeagueRef): Promise<ProviderResult<OddsApiEvent[]>> {
    const { body, headers } = await getJson<OddsApiEvent[]>(`${BASE}/sports/${league.key}/events`, { headers: this.h() });
    return { data: body, cost: 1, remaining: this.rem(headers), priceFormat: 'american' };
  }

  async getOdds(league: LeagueRef, opts: { markets: string[]; eventIds?: string[] }): Promise<ProviderResult<OddsApiEvent[]>> {
    const { body, headers } = await getJson<OddsApiEvent[]>(`${BASE}/sports/${league.key}/odds?markets=${opts.markets.join(',')}`, { headers: this.h() });
    const ids = opts.eventIds ? new Set(opts.eventIds) : null;
    const evs = ids ? body.filter((e) => ids.has(String(e.id))) : body;
    return { data: cleanEvents(dropRedacted(evs)), cost: 1, remaining: this.rem(headers), priceFormat: 'american' };
  }

  async getProps(league: LeagueRef, providerEventId: string, markets: string[]): Promise<ProviderResult<OddsApiEvent | null>> {
    const { body, headers } = await getJson<OddsApiEvent>(`${BASE}/sports/${league.key}/events/${encodeURIComponent(providerEventId)}/odds?markets=${markets.join(',')}`, { headers: this.h() });
    return { data: body ? cleanEvents(dropRedacted([body]))[0] : null, cost: 1, remaining: this.rem(headers), priceFormat: 'american' };
  }

  async getScores(league: LeagueRef, daysFrom: number): Promise<ProviderResult<ScoreRow[]>> {
    type S = { id: string | number; sport_key: string; commence_time: string; status: string; home_team: string; away_team: string; home_score: number | null; away_score: number | null };
    const { body, headers } = await getJson<S[]>(`${BASE}/sports/${league.key}/scores?daysFrom=${daysFrom}`, { headers: this.h() });
    return {
      data: body.map((s) => ({
        providerEventId: String(s.id), sportKey: s.sport_key, home: s.home_team, away: s.away_team, commence: s.commence_time,
        completed: s.status === 'final', homeScore: s.home_score, awayScore: s.away_score,
      })),
      cost: 1, remaining: this.rem(headers), priceFormat: 'american',
    };
  }

  async getInjuries(league: LeagueRef): Promise<ProviderResult<InjuryRow[]>> {
    type R = { players: { player_name: string; team: string | null; status: string; status_code: string }[] };
    const { body, headers } = await getJson<R>(`${BASE}/sports/${league.key}/injuries`, { headers: this.h() });
    return { data: (body.players ?? []).map((p) => ({ player: p.player_name, team: p.team, status: p.status, code: p.status_code })), cost: 1, remaining: this.rem(headers), priceFormat: 'american' };
  }

  async getPlayerGames(league: LeagueRef, player: string, limit: number): Promise<ProviderResult<PlayerGameRow[]>> {
    type R = { games: { event_id: string; commence_time: string; status: string; stats: Record<string, number> }[] };
    const { body, headers } = await getJson<R>(`${BASE}/sports/${league.key}/players/${encodeURIComponent(player)}/games?limit=${limit}`, { headers: this.h() });
    return {
      data: (body.games ?? []).filter((g) => g.status === 'final' || !g.status).map((g) => ({ date: g.commence_time, eventId: g.event_id, stats: g.stats ?? {}, minutes: g.stats?.minutes })),
      cost: 1, remaining: this.rem(headers), priceFormat: 'american',
    };
  }
}
