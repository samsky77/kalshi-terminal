// Read-only Kalshi public market-data client. No auth and no account or trading endpoints.
import { discoverSeries, groupGames, type DiscoveredSeries, type RawEvent, type RawMilestone, type RawSeries } from '@/core/kalshi';
import type { KalshiGame, Sport } from '@/core/types';
import { getJson, Throttle } from './http';

export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const throttle = new Throttle(5); // spec: 5 requests / second
const TTL = 30_000; // spec: cache responses for 30 seconds
const SERIES_TTL = 6 * 3600_000; // the 6.7 MB series catalogue changes rarely (DECISIONS.md)

let seriesMemo: { at: number; list: DiscoveredSeries[] } | null = null;

export async function discover(): Promise<DiscoveredSeries[]> {
  if (seriesMemo && Date.now() - seriesMemo.at < SERIES_TTL) return seriesMemo.list;
  const r = await getJson<{ series: RawSeries[] }>(`${KALSHI_BASE}/series?category=Sports`, { throttle, ttlMs: SERIES_TTL });
  if (r.status !== 200 || !r.body?.series) throw new Error(`Kalshi /series failed: HTTP ${r.status}`);
  seriesMemo = { at: Date.now(), list: discoverSeries(r.body.series) };
  return seriesMemo.list;
}

/** All open events (with nested markets and milestones) for a series, following cursors. */
export async function openEvents(seriesTicker: string): Promise<{ events: RawEvent[]; milestones: RawMilestone[] }> {
  const events: RawEvent[] = [];
  const milestones: RawMilestone[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ series_ticker: seriesTicker, status: 'open', with_nested_markets: 'true', with_milestones: 'true', limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const r = await getJson<{ events: RawEvent[]; milestones?: RawMilestone[]; cursor?: string }>(`${KALSHI_BASE}/events?${q}`, { throttle, ttlMs: TTL });
    if (r.status !== 200) throw new Error(`Kalshi /events ${seriesTicker} failed: HTTP ${r.status}`);
    events.push(...(r.body.events ?? []));
    milestones.push(...(r.body.milestones ?? []));
    cursor = r.body.cursor ?? '';
    if (!cursor || !(r.body.events ?? []).length) break;
  }
  return { events, milestones };
}

export interface SportSnapshot {
  sport: Sport;
  fetchedAt: string;
  source: 'live' | 'fixture';
  series: { ticker: string; kind: string; feeType: string; feeMultiplier: number; events: number }[];
  games: KalshiGame[];
  excluded: { eventTicker: string; reason: string }[];
}

/** Trim raw API objects to the fields the core reads (keeps fixtures and payloads small). */
export function trimEvent(e: RawEvent): RawEvent {
  return {
    event_ticker: e.event_ticker,
    series_ticker: e.series_ticker,
    title: e.title,
    sub_title: e.sub_title,
    mutually_exclusive: e.mutually_exclusive,
    exchange_index: e.exchange_index,
    product_metadata: e.product_metadata,
    markets: (e.markets ?? []).map((m) => ({
      ticker: m.ticker, event_ticker: m.event_ticker, market_type: m.market_type, status: m.status,
      strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike,
      yes_sub_title: m.yes_sub_title, no_sub_title: m.no_sub_title, title: m.title,
      yes_ask_dollars: m.yes_ask_dollars, no_ask_dollars: m.no_ask_dollars, yes_bid_dollars: m.yes_bid_dollars,
      no_bid_dollars: m.no_bid_dollars, yes_ask_size_fp: m.yes_ask_size_fp, yes_bid_size_fp: m.yes_bid_size_fp,
      occurrence_datetime: m.occurrence_datetime, expected_expiration_time: m.expected_expiration_time, exchange_index: m.exchange_index,
    })),
  };
}
export function trimMilestone(m: RawMilestone): RawMilestone {
  return {
    id: m.id, title: m.title, type: m.type, start_date: m.start_date, primary_event_tickers: m.primary_event_tickers,
    details: m.details ? { best_of: m.details.best_of, tournament_name: m.details.tournament_name, league: m.details.league, status: m.details.status } : null,
  };
}

export interface RawSportDump {
  sport: Sport;
  fetchedAt: string;
  series: DiscoveredSeries[];
  bySeries: { seriesTicker: string; events: RawEvent[] }[];
  milestones: RawMilestone[];
}

export async function fetchRawSport(sport: Sport): Promise<RawSportDump> {
  const all = (await discover()).filter((s) => s.seed.sport === sport);
  const bySeries: RawSportDump['bySeries'] = [];
  const msMap = new Map<string, RawMilestone>();
  for (const s of all) {
    const { events, milestones } = await openEvents(s.seriesTicker);
    bySeries.push({ seriesTicker: s.seriesTicker, events: events.map(trimEvent) });
    for (const m of milestones) msMap.set(m.id, trimMilestone(m));
  }
  return { sport, fetchedAt: new Date().toISOString(), series: all, bySeries, milestones: [...msMap.values()] };
}

export function snapshotFromRaw(d: RawSportDump, source: 'live' | 'fixture'): SportSnapshot {
  const inputs = d.series.map((s) => ({ series: s, events: d.bySeries.find((b) => b.seriesTicker === s.seriesTicker)?.events ?? [] }));
  const { games, excluded } = groupGames(d.sport, inputs, d.milestones);
  return {
    sport: d.sport,
    fetchedAt: d.fetchedAt,
    source,
    series: inputs.map((x) => ({ ticker: x.series.seriesTicker, kind: x.series.kind, feeType: x.series.fee.feeType, feeMultiplier: x.series.fee.feeMultiplier, events: x.events.length })),
    games,
    excluded,
  };
}

export async function loadSport(sport: Sport): Promise<SportSnapshot> {
  return snapshotFromRaw(await fetchRawSport(sport), 'live');
}
