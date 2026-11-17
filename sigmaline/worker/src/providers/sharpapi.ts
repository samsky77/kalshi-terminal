/**
 * SharpAPI (sharpapi.io): intended primary game-line feed. OFF BY DEFAULT (SHARPAPI_ENABLED=false).
 *
 * LICENSE NOTE (see docs/licensing.md): keep disabled until SharpAPI confirms in writing that the
 * free plan allows showing its odds to paying end users. From Dec 1, 2026 every screen that shows
 * SharpAPI odds must display "Data provided by SharpAPI" (the UI does this automatically for any
 * price whose provider is 'sharpapi').
 *
 * TECHNICAL NOTE: base https://api.sharpapi.io/api/v1, X-API-Key header, GET /odds?league=…
 * Their docs host was unreachable from the build environment, so the field mapping below is
 * defensive (several candidate field names). Verify against a live response before enabling.
 */
import { SPORT_DEFS, americanToDecimal, type OddsApiEvent, type SportId } from '@sigmaline/core';
import { getJson } from './http';
import { cleanEvents, type DataProvider, type LeagueRef, type ProviderResult, type ScoreRow } from './types';

const BASE = 'https://api.sharpapi.io/api/v1';

type Item = Record<string, any>;
const pick = (o: Item, ...ks: string[]) => { for (const k of ks) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return undefined; };

/** Convert a flat SharpAPI odds list into Odds-API-shaped events. */
export function sharpToEvents(items: Item[]): OddsApiEvent[] {
  const evs = new Map<string, OddsApiEvent>();
  for (const it of items) {
    const id = String(pick(it, 'event_id', 'eventId', 'id'));
    const home = pick(it, 'home_team', 'homeTeam', 'home'), away = pick(it, 'away_team', 'awayTeam', 'away');
    const start = pick(it, 'start_time', 'commence_time', 'startTime', 'start');
    if (!home || !away || !start) continue;
    const ev: OddsApiEvent = evs.get(id) ?? { id, sport_key: String(pick(it, 'league', 'sport') ?? ''), commence_time: start, home_team: home, away_team: away, bookmakers: [] };
    evs.set(id, ev);
    const book = String(pick(it, 'sportsbook', 'book', 'bookmaker') ?? '').toLowerCase();
    const mType = String(pick(it, 'market_type', 'market', 'marketType') ?? '').toLowerCase();
    const key = /money|h2h|ml/.test(mType) ? 'h2h' : /spread|handicap|run_line|puck/.test(mType) ? 'spreads' : /total|over/.test(mType) ? 'totals' : null;
    if (!book || !key) continue;
    const sel = String(pick(it, 'selection', 'outcome', 'name') ?? '');
    const dec = Number(pick(it, 'odds_decimal', 'decimal', 'price_decimal')) || americanToDecimal(Number(pick(it, 'odds_american', 'american', 'price')));
    if (!(dec > 1)) continue;
    const point = pick(it, 'line', 'point', 'handicap');
    const name = /^home$/i.test(sel) ? home : /^away$/i.test(sel) ? away : sel;
    let bk = ev.bookmakers!.find((b) => b.key === book);
    if (!bk) { bk = { key: book, markets: [] }; ev.bookmakers!.push(bk); }
    let m = bk.markets.find((x) => x.key === key);
    if (!m) { m = { key, outcomes: [], last_update: pick(it, 'updated_at', 'timestamp', 'ts') }; bk.markets.push(m); }
    m.outcomes.push({ name, price: dec, ...(point !== undefined ? { point: Number(point) } : {}) });
  }
  return [...evs.values()];
}

export class SharpApiProvider implements DataProvider {
  readonly id = 'sharpapi' as const;
  constructor(private key: string | undefined, private on: boolean) {}
  get enabled() { return !!this.key && this.on; }
  leagueKey(sport: SportId, leagueId: string): string | null {
    return SPORT_DEFS[sport].leagues.find((l) => l.id === leagueId)?.sharpApiLeague ?? null;
  }
  private h() { return { 'X-API-Key': this.key! }; }
  async getEvents(league: LeagueRef): Promise<ProviderResult<OddsApiEvent[]>> {
    const { body } = await getJson<{ data?: Item[] } | Item[]>(`${BASE}/events?league=${league.key}`, { headers: this.h() });
    const items = Array.isArray(body) ? body : body.data ?? [];
    return { data: sharpToEvents(items.map((e) => ({ ...e, sportsbook: undefined }))), cost: 1, priceFormat: 'decimal' };
  }
  async getOdds(league: LeagueRef, opts: { markets: string[]; eventIds?: string[] }): Promise<ProviderResult<OddsApiEvent[]>> {
    const items: Item[] = [];
    let cursor: string | undefined, calls = 0;
    do {
      const { body } = await getJson<{ data?: Item[]; next_cursor?: string; cursor?: string }>(`${BASE}/odds?league=${league.key}${cursor ? `&cursor=${cursor}` : ''}`, { headers: this.h() });
      items.push(...(body.data ?? []));
      cursor = body.next_cursor ?? undefined;
      calls++;
    } while (cursor && calls < 10);
    let evs = sharpToEvents(items);
    if (opts.eventIds) { const s = new Set(opts.eventIds); evs = evs.filter((e) => s.has(String(e.id))); }
    return { data: cleanEvents(evs), cost: calls, priceFormat: 'decimal' };
  }
  async getScores(): Promise<ProviderResult<ScoreRow[]>> {
    return { data: [], cost: 0, priceFormat: 'decimal' };
  }
}
