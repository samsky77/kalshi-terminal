// Free odds source: ESPN's public scoreboard (no key, no credits). One book (DraftKings), pregame lines only.
// Mapped into the same OddsEvent shape as The Odds API so the pipeline is unchanged. Unofficial endpoint: any
// failure here falls back to The Odds API for that key (see refreshOdds).
import type { OddsBatch } from '@/core/pipeline';
import type { OddsEvent, OddsMarket } from '@/core/types';
import { getJson, Throttle } from './http';

const throttle = new Throttle(4);
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** Odds API sport key -> ESPN path (+ query). Soccer and tennis are not covered: ESPN does not carry reliable odds for them. */
export const ESPN_PATHS: Record<string, string> = {
  basketball_nba: 'basketball/nba/scoreboard?limit=100',
  americanfootball_nfl: 'football/nfl/scoreboard?limit=100',
  icehockey_nhl: 'hockey/nhl/scoreboard?limit=100',
  americanfootball_ncaaf: 'football/college-football/scoreboard?groups=80&limit=400',
  basketball_ncaab: 'basketball/mens-college-basketball/scoreboard?groups=50&limit=400',
};

export const espnCovers = (oddsKey: string) => oddsKey in ESPN_PATHS;

interface Line { odds?: string; line?: string }
interface Side { close?: Line; open?: Line }
interface EspnOdds {
  provider?: { name?: string; displayName?: string };
  moneyline?: { home?: Side; away?: Side };
  pointSpread?: { home?: Side; away?: Side };
  total?: { over?: Side; under?: Side };
}
interface EspnEvent {
  id: string;
  date: string;
  status?: { type?: { state?: string } };
  competitions?: { odds?: EspnOdds[]; competitors?: { homeAway: string; team: { displayName: string } }[] }[];
}

/** "+120" / "-142" / "EVEN" -> decimal odds, or NaN. */
export function americanStrToDecimal(s: string | undefined): number {
  if (!s) return NaN;
  const t = s.trim().toUpperCase();
  if (t === 'EVEN' || t === 'EV') return 2;
  const n = Number(t.replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return NaN;
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
}
const num = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/^[ou]/i, ''));
  return Number.isFinite(n) ? n : NaN;
};

export function eventFromEspn(ev: EspnEvent, sportKey: string, fetchedAt: string): OddsEvent | null {
  if (ev.status?.type?.state && ev.status.type.state !== 'pre') return null; // lines vanish once a game starts
  const comp = ev.competitions?.[0];
  const o = comp?.odds?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === 'home')?.team.displayName;
  const away = comp?.competitors?.find((c) => c.homeAway === 'away')?.team.displayName;
  if (!o || !home || !away) return null;

  const markets: OddsMarket[] = [];
  const mh = americanStrToDecimal(o.moneyline?.home?.close?.odds), ma = americanStrToDecimal(o.moneyline?.away?.close?.odds);
  if (Number.isFinite(mh) && Number.isFinite(ma)) {
    markets.push({ key: 'h2h', last_update: fetchedAt, outcomes: [{ name: away, price: ma }, { name: home, price: mh }] });
  }
  const sh = o.pointSpread?.home?.close, sa = o.pointSpread?.away?.close;
  const ph = americanStrToDecimal(sh?.odds), pa = americanStrToDecimal(sa?.odds);
  if (sh && sa && Number.isFinite(ph) && Number.isFinite(pa) && Number.isFinite(num(sh.line)) && Number.isFinite(num(sa.line))) {
    markets.push({ key: 'spreads', last_update: fetchedAt, outcomes: [
      { name: away, price: pa, point: num(sa.line) }, { name: home, price: ph, point: num(sh.line) }] });
  }
  const to = o.total?.over?.close, tu = o.total?.under?.close;
  const po = americanStrToDecimal(to?.odds), pu = americanStrToDecimal(tu?.odds);
  if (to && tu && Number.isFinite(po) && Number.isFinite(pu) && Number.isFinite(num(to.line))) {
    markets.push({ key: 'totals', last_update: fetchedAt, outcomes: [
      { name: 'Over', price: po, point: num(to.line) }, { name: 'Under', price: pu, point: num(to.line) }] });
  }
  if (!markets.length) return null;
  const date = ev.date.length === 17 ? `${ev.date.slice(0, 16)}:00Z` : ev.date; // "2026-11-14T00:00Z" -> full ISO
  return {
    id: `espn-${ev.id}`, sport_key: sportKey, commence_time: date, home_team: home, away_team: away,
    bookmakers: [{ key: 'draftkings', title: o.provider?.displayName ?? 'DraftKings', last_update: fetchedAt, markets }],
  };
}

function etDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).replace(/-/g, '');
}

/** Today's and tomorrow's (ET) pregame lines for one Odds-API-style key. Throws if the feed is unreachable. */
export async function espnBatch(sportKey: string): Promise<OddsBatch> {
  const path = ESPN_PATHS[sportKey];
  if (!path) throw new Error(`ESPN does not cover ${sportKey}`);
  const fetchedAt = new Date().toISOString();
  const events = new Map<string, OddsEvent>();
  for (const day of [etDate(0), etDate(1)]) {
    const r = await getJson<{ events?: EspnEvent[] }>(`${BASE}/${path}&dates=${day}`, { throttle, retries: 2 });
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') throw new Error(`ESPN ${sportKey}: HTTP ${r.status}`);
    for (const e of r.body.events ?? []) {
      const oe = eventFromEspn(e, sportKey, fetchedAt);
      if (oe) events.set(oe.id, oe);
    }
  }
  return { sportKey, fetchedAt, events: [...events.values()] };
}
