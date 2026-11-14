import { DURATION_HOURS, LEAGUE_SEEDS, TYPE_SUFFIXES, type LeagueSeed } from './sports';
import type { Competitor, FeeInfo, KalshiContract, KalshiGame, MarketKind, Sport, StrikeType } from './types';

// ---- Raw Kalshi API shapes (only the fields we read) ----
export interface RawSeries {
  ticker: string;
  title?: string;
  category?: string;
  tags?: string[] | null;
  fee_type?: string;
  fee_multiplier?: number;
}
export interface RawMarket {
  ticker: string;
  event_ticker: string;
  market_type?: string;
  status?: string;
  strike_type?: string;
  floor_strike?: number | null;
  cap_strike?: number | null;
  yes_sub_title?: string;
  no_sub_title?: string;
  title?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  yes_bid_dollars?: string;
  no_bid_dollars?: string;
  yes_ask_size_fp?: string;
  yes_bid_size_fp?: string;
  yes_ask?: number; // legacy cents
  no_ask?: number;
  yes_bid?: number;
  no_bid?: number;
  occurrence_datetime?: string;
  expected_expiration_time?: string;
  exchange_index?: number;
}
export interface RawEvent {
  event_ticker: string;
  series_ticker: string;
  title?: string;
  sub_title?: string;
  mutually_exclusive?: boolean;
  exchange_index?: number;
  product_metadata?: { competition?: string; competition_scope?: string } | null;
  markets?: RawMarket[];
}
export interface RawMilestone {
  id: string;
  title?: string;
  type?: string;
  start_date?: string;
  primary_event_tickers?: string[];
  related_event_tickers?: string[];
  details?: { best_of?: string | number; tournament_name?: string; league?: string; status?: string } | null;
}

export interface DiscoveredSeries {
  seriesTicker: string;
  seed: LeagueSeed;
  kind: MarketKind;
  fee: FeeInfo;
}

/**
 * Discover v1 series from GET /series?category=Sports. A series qualifies only when its ticker is
 * exactly <seed prefix><allowed type suffix>; the longest matching prefix wins
 * (KXLALIGA2GAME -> KXLALIGA2 + GAME, never KXLALIGA + 2GAME).
 */
export function discoverSeries(series: RawSeries[]): DiscoveredSeries[] {
  const out: DiscoveredSeries[] = [];
  const seeds = [...LEAGUE_SEEDS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const s of series) {
    if (s.category && s.category !== 'Sports') continue;
    for (const seed of seeds) {
      if (!s.ticker.startsWith(seed.prefix)) continue;
      const rest = s.ticker.slice(seed.prefix.length);
      const t = TYPE_SUFFIXES.find((x) => x.suffix === rest);
      if (!t) continue;
      if (t.kind === 'tie' && seed.sport !== 'nfl') break; // soccer ties live inside the GAME event
      out.push({
        seriesTicker: s.ticker,
        seed,
        kind: t.kind,
        fee: { feeType: s.fee_type ?? 'quadratic', feeMultiplier: s.fee_multiplier ?? 1 },
      });
      break;
    }
  }
  return out;
}

/** Guard against anything that is not a single-game, full-game binary market. */
const EXCLUDE_TITLE = /(1st half|first half|2nd half|1st quarter|parlay|multi|combo|series winner|season)/i;
export function isExcluded(ev: RawEvent, m?: RawMarket): string | null {
  if (ev.exchange_index === 1) return 'combo exchange';
  if (/MVE|PARLAY|COMBO/i.test(ev.event_ticker)) return 'parlay';
  if (ev.title && EXCLUDE_TITLE.test(ev.title)) return 'excluded scope';
  if (ev.event_ticker.split('-').length !== 2) return 'not a single-game event';
  if (m) {
    if (m.exchange_index === 1) return 'combo exchange';
    if (/MVE|,/.test(m.ticker)) return 'parlay';
    if (m.market_type && m.market_type !== 'binary') return 'non-binary';
  }
  return null;
}

const num = (s: string | undefined, legacyCents?: number): number | null => {
  if (s !== undefined && s !== null && s !== '') {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }
  if (legacyCents !== undefined && legacyCents !== null) return legacyCents / 100;
  return null;
};
const usableAsk = (x: number | null): number | null => (x === null || x <= 0 || x >= 1 ? null : x);

export function eventStem(eventTicker: string): string {
  return eventTicker.split('-')[1] ?? eventTicker;
}
export function marketSuffix(ticker: string): string {
  const parts = ticker.split('-');
  return parts[parts.length - 1];
}

/** Match a spread market to a competitor: suffix = <code><digits>, else name prefix of yes_sub_title. */
export function spreadCompetitor(m: RawMarket, comps: Competitor[]): string | undefined {
  const suf = marketSuffix(m.ticker);
  const byCode = comps
    .filter((c) => suf.startsWith(c.code) && /^\d*$/.test(suf.slice(c.code.length)))
    .sort((a, b) => b.code.length - a.code.length)[0];
  if (byCode) return byCode.code;
  const label = (m.yes_sub_title ?? '').toLowerCase();
  const byName = comps.filter((c) => label.startsWith(c.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  return byName?.code;
}

export function parseContract(m: RawMarket, ev: RawEvent, kind: MarketKind, fee: FeeInfo, comps: Competitor[]): KalshiContract | null {
  if (isExcluded(ev, m)) return null;
  if (m.status && m.status !== 'active' && m.status !== 'open') return null;
  let code: string | undefined;
  let k: MarketKind = kind;
  if (kind === 'winner') {
    const suf = marketSuffix(m.ticker);
    if (suf === 'TIE') k = 'tie';
    else code = suf;
  } else if (kind === 'spread') {
    code = spreadCompetitor(m, comps);
    if (!code) return null;
  }
  const strikeType = (m.strike_type ?? (kind === 'winner' || kind === 'tie' ? 'structured' : 'greater')) as StrikeType;
  if ((k === 'spread' || k === 'total') && m.floor_strike == null && m.cap_strike == null) return null;
  return {
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    seriesTicker: ev.series_ticker,
    kind: k,
    code,
    strikeType,
    floorStrike: m.floor_strike ?? undefined,
    capStrike: m.cap_strike ?? undefined,
    label: m.yes_sub_title ?? m.title ?? m.ticker,
    yesAsk: usableAsk(num(m.yes_ask_dollars, m.yes_ask)),
    yesAskSize: num(m.yes_ask_size_fp) ?? 0,
    noAsk: usableAsk(num(m.no_ask_dollars, m.no_ask)),
    noAskSize: num(m.yes_bid_size_fp) ?? 0, // a resting Yes bid at p is a No offer at 1-p
    yesBid: num(m.yes_bid_dollars, m.yes_bid),
    noBid: num(m.no_bid_dollars, m.no_bid),
    fee,
    status: m.status ?? 'active',
  };
}

export interface SeriesEvents {
  series: DiscoveredSeries;
  events: RawEvent[];
}

export interface GroupResult {
  games: KalshiGame[];
  excluded: { eventTicker: string; reason: string }[];
}

/**
 * Group one sport's winner/spread/total events into games. A milestone that lists the event
 * tickers is the primary key (it also carries the real start time); otherwise events sharing the
 * league + ticker stem (e.g. 26NOV13NYKIND) are grouped.
 */
export function groupGames(sport: Sport, all: SeriesEvents[], milestones: RawMilestone[]): GroupResult {
  const msByEvent = new Map<string, RawMilestone>();
  for (const ms of milestones) for (const t of ms.primary_event_tickers ?? []) msByEvent.set(t, ms);
  const excluded: GroupResult['excluded'] = [];
  type G = { key: string; league: string; ms?: RawMilestone; parts: { s: DiscoveredSeries; ev: RawEvent }[] };
  const groups = new Map<string, G>();
  // Pass 1: events listed as primary on a milestone. Pass 2: the rest attach by league + stem
  // to an existing group (NFL tie and tennis spread/total events are not milestone primaries).
  const stemToKey = new Map<string, string>();
  const pending: { series: DiscoveredSeries; ev: RawEvent }[] = [];
  const add = (key: string, series: DiscoveredSeries, ev: RawEvent, ms?: RawMilestone) => {
    let g = groups.get(key);
    if (!g) { g = { key, league: series.seed.prefix, ms, parts: [] }; groups.set(key, g); }
    g.parts.push({ s: series, ev });
    const sk = `${series.seed.prefix}:${eventStem(ev.event_ticker)}`;
    if (!stemToKey.has(sk)) stemToKey.set(sk, key);
  };
  for (const { series, events } of all) {
    for (const ev of events) {
      const why = isExcluded(ev);
      if (why) { excluded.push({ eventTicker: ev.event_ticker, reason: why }); continue; }
      const ms = msByEvent.get(ev.event_ticker);
      if (ms) add(`ms:${ms.id}`, series, ev, ms);
      else pending.push({ series, ev });
    }
  }
  for (const { series, ev } of pending) {
    const sk = `${series.seed.prefix}:${eventStem(ev.event_ticker)}`;
    add(stemToKey.get(sk) ?? sk, series, ev);
  }
  const games: KalshiGame[] = [];
  for (const g of groups.values()) {
    const winner = g.parts.find((p) => p.s.kind === 'winner');
    const comps: Competitor[] = [];
    if (winner) {
      for (const m of winner.ev.markets ?? []) {
        const suf = marketSuffix(m.ticker);
        if (suf === 'TIE') continue;
        comps.push({ code: suf, name: m.yes_sub_title ?? suf });
      }
    } else {
      // No winner event: derive competitors from spread labels "X wins by over" / "X -6.5 games".
      const sp = g.parts.find((p) => p.s.kind === 'spread');
      for (const m of sp?.ev.markets ?? []) {
        const code = marketSuffix(m.ticker).replace(/\d+$/, '');
        const name = (m.yes_sub_title ?? '').replace(/\s+(wins by.*|[-+]\d.*)$/i, '').trim();
        if (code && !comps.some((c) => c.code === code)) comps.push({ code, name: name || code });
      }
    }
    if (comps.length !== 2) {
      excluded.push({ eventTicker: g.parts[0].ev.event_ticker, reason: `expected 2 competitors, found ${comps.length}` });
      continue;
    }
    const contracts: KalshiContract[] = [];
    for (const p of g.parts) for (const m of p.ev.markets ?? []) {
      const c = parseContract(m, p.ev, p.s.kind, p.s.fee, comps);
      if (c) contracts.push(c);
    }
    const anyMarket = g.parts.flatMap((p) => p.ev.markets ?? [])[0];
    let startTime = g.ms?.start_date;
    let startSource: KalshiGame['startSource'] = 'milestone';
    if (!startTime) {
      const occ = anyMarket?.occurrence_datetime ?? anyMarket?.expected_expiration_time;
      startTime = occ ? new Date(Date.parse(occ) - DURATION_HOURS[sport] * 3600e3).toISOString() : new Date(0).toISOString();
      startSource = 'occurrence';
    }
    const first = (winner ?? g.parts[0]).ev;
    const bo = g.ms?.details?.best_of;
    games.push({
      id: `${sport}:${g.league}:${eventStem(first.event_ticker)}`,
      sport,
      league: g.league,
      competition: first.product_metadata?.competition ?? g.ms?.details?.tournament_name ?? g.league,
      title: first.title ?? g.ms?.title ?? first.event_ticker,
      startTime,
      startSource,
      competitors: comps,
      bestOf: bo !== undefined ? Number(bo) : undefined,
      eventTickers: g.parts.map((p) => p.ev.event_ticker),
      contracts,
    });
  }
  games.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { games, excluded };
}
