// Free odds source: ESPN's public scoreboard (no key, no credits). One book (DraftKings), pregame lines only.
// Covers US sports, soccer (3-way with draw) and, when ESPN lists lines for them, tennis matches.
// Mapped into the same OddsEvent shape as The Odds API so the pipeline is unchanged. Unofficial endpoint: any
// failure here falls back to The Odds API for that key (see refreshOdds).
import type { OddsBatch } from '@/core/pipeline';
import type { OddsEvent, OddsMarket } from '@/core/types';
import { getJson, Throttle } from './http';

const throttle = new Throttle(4);
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** Odds API sport key -> ESPN path (+ query). Tennis has one scoreboard per tour (see tennisTour). */
export const ESPN_PATHS: Record<string, string> = {
  basketball_nba: 'basketball/nba/scoreboard?limit=100',
  americanfootball_nfl: 'football/nfl/scoreboard?limit=100',
  icehockey_nhl: 'hockey/nhl/scoreboard?limit=100',
  americanfootball_ncaaf: 'football/college-football/scoreboard?groups=80&limit=400',
  basketball_ncaab: 'basketball/mens-college-basketball/scoreboard?groups=50&limit=400',
  soccer_epl: 'soccer/eng.1/scoreboard?limit=100',
  soccer_spain_la_liga: 'soccer/esp.1/scoreboard?limit=100',
  soccer_spain_segunda_division: 'soccer/esp.2/scoreboard?limit=100',
  soccer_germany_bundesliga: 'soccer/ger.1/scoreboard?limit=100',
  soccer_germany_bundesliga2: 'soccer/ger.2/scoreboard?limit=100',
  soccer_italy_serie_a: 'soccer/ita.1/scoreboard?limit=100',
  soccer_italy_serie_b: 'soccer/ita.2/scoreboard?limit=100',
  soccer_france_ligue_one: 'soccer/fra.1/scoreboard?limit=100',
  soccer_usa_mls: 'soccer/usa.1/scoreboard?limit=100',
  soccer_uefa_champs_league: 'soccer/uefa.champions/scoreboard?limit=100',
  soccer_uefa_europa_league: 'soccer/uefa.europa/scoreboard?limit=100',
  soccer_netherlands_eredivisie: 'soccer/ned.1/scoreboard?limit=100',
  soccer_portugal_primeira_liga: 'soccer/por.1/scoreboard?limit=100',
  soccer_mexico_ligamx: 'soccer/mex.1/scoreboard?limit=100',
};

/** Tennis keys are per tournament (tennis_atp_*, tennis_wta_*); ESPN has one scoreboard per tour. */
const tennisTour = (k: string) => (k.startsWith('tennis_atp') ? 'atp' : k.startsWith('tennis_wta') ? 'wta' : null);
export const isTennisKey = (k: string) => tennisTour(k) !== null;
export const espnCovers = (oddsKey: string) => oddsKey in ESPN_PATHS || isTennisKey(oddsKey);

interface Line { odds?: string; line?: string }
interface Side { close?: Line; open?: Line }
interface EspnOdds {
  provider?: { name?: string; displayName?: string };
  drawOdds?: { moneyLine?: number };
  moneyline?: { home?: Side; away?: Side; draw?: Side };
  pointSpread?: { home?: Side; away?: Side };
  total?: { over?: Side; under?: Side };
}
interface EspnComp {
  id?: string;
  date?: string;
  status?: { type?: { state?: string } };
  odds?: (EspnOdds | null)[];
  competitors?: { homeAway: string; team?: { displayName: string }; athlete?: { displayName: string } }[];
}
interface EspnEvent {
  id: string;
  date: string;
  status?: { type?: { state?: string } };
  competitions?: EspnComp[];
  groupings?: { grouping?: { displayName?: string; slug?: string }; competitions?: EspnComp[] }[];
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
/** "o45.5" / "-3.5" / "PK" -> number. Missing or blank is NaN, never 0 (Number('') is 0, which made fake pick'em and total-0 lines). */
export const num = (s: string | undefined) => {
  const t = (s ?? '').trim().replace(/^[ou]/i, '');
  if (!t) return NaN;
  if (/^(pk|pick|pickem|even)$/i.test(t)) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function eventFromEspn(ev: EspnEvent, sportKey: string, fetchedAt: string): OddsEvent | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  return eventFromComp(ev.id, ev.date, ev.status?.type?.state ?? comp.status?.type?.state, comp, sportKey, fetchedAt);
}

export function eventFromComp(
  id: string, date: string, state: string | undefined, comp: EspnComp, sportKey: string, fetchedAt: string,
): OddsEvent | null {
  if (state && state !== 'pre') return null; // lines vanish once a game starts
  const o = comp.odds?.[0];
  const name = (side: string) => {
    const c = comp.competitors?.find((x) => x.homeAway === side);
    return c?.team?.displayName ?? c?.athlete?.displayName;
  };
  const home = name('home'), away = name('away');
  if (!o || !home || !away) return null;
  const soccer = sportKey.startsWith('soccer_');

  const markets: OddsMarket[] = [];
  const mh = americanStrToDecimal(o.moneyline?.home?.close?.odds), ma = americanStrToDecimal(o.moneyline?.away?.close?.odds);
  if (Number.isFinite(mh) && Number.isFinite(ma)) {
    if (soccer) {
      const md = americanStrToDecimal(o.moneyline?.draw?.close?.odds) || (typeof o.drawOdds?.moneyLine === 'number' ? americanStrToDecimal(String(o.drawOdds.moneyLine)) : NaN);
      if (Number.isFinite(md)) {
        markets.push({ key: 'h2h', last_update: fetchedAt, outcomes: [{ name: away, price: ma }, { name: home, price: mh }, { name: 'Draw', price: md }] });
      }
    } else {
      markets.push({ key: 'h2h', last_update: fetchedAt, outcomes: [{ name: away, price: ma }, { name: home, price: mh }] });
    }
  }
  const sh = o.pointSpread?.home?.close, sa = o.pointSpread?.away?.close;
  const ph = americanStrToDecimal(sh?.odds), pa = americanStrToDecimal(sa?.odds);
  if (sh && sa && Number.isFinite(ph) && Number.isFinite(pa) && Number.isFinite(num(sh.line)) && Number.isFinite(num(sa.line)) && Math.abs(num(sh.line) + num(sa.line)) < 1e-9) {
    markets.push({ key: 'spreads', last_update: fetchedAt, outcomes: [
      { name: away, price: pa, point: num(sa.line) }, { name: home, price: ph, point: num(sh.line) }] });
  }
  const to = o.total?.over?.close, tu = o.total?.under?.close;
  const po = americanStrToDecimal(to?.odds), pu = americanStrToDecimal(tu?.odds);
  if (to && tu && Number.isFinite(po) && Number.isFinite(pu) && num(to.line) > 0 && (tu.line === undefined || !Number.isFinite(num(tu.line)) || num(tu.line) === num(to.line))) {
    markets.push({ key: 'totals', last_update: fetchedAt, outcomes: [
      { name: 'Over', price: po, point: num(to.line) }, { name: 'Under', price: pu, point: num(to.line) }] });
  }
  if (!markets.length) return null;
  const iso = date.length === 17 ? `${date.slice(0, 16)}:00Z` : date; // "2026-11-14T00:00Z" -> full ISO
  return {
    id: `espn-${id}`, sport_key: sportKey, commence_time: iso, home_team: home, away_team: away,
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
  const tour = tennisTour(sportKey);
  const path = tour ? `tennis/${tour}/scoreboard` : ESPN_PATHS[sportKey];
  if (!path) throw new Error(`ESPN does not cover ${sportKey}`);
  const fetchedAt = new Date().toISOString();
  const events = new Map<string, OddsEvent>();
  for (const day of [etDate(0), etDate(1)]) {
    const url = `${BASE}/${path}${path.includes('?') ? '&' : '?'}dates=${day}`;
    const r = await getJson<{ events?: EspnEvent[] }>(url, { throttle, retries: 2 });
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') throw new Error(`ESPN ${sportKey}: HTTP ${r.status}`);
    for (const e of r.body.events ?? []) {
      const list: OddsEvent[] = [];
      if (tour) {
        for (const g of e.groupings ?? []) {
          if (!/singles/i.test(`${g.grouping?.displayName ?? ''} ${g.grouping?.slug ?? ''}`) || /doubles/i.test(g.grouping?.displayName ?? '')) continue;
          for (const c of g.competitions ?? []) {
            const oe = eventFromComp(c.id ?? '', c.date ?? e.date, c.status?.type?.state, c, sportKey, fetchedAt);
            if (oe) list.push(oe);
          }
        }
      } else {
        const oe = eventFromEspn(e, sportKey, fetchedAt);
        if (oe) list.push(oe);
      }
      for (const oe of list) events.set(oe.id, oe);
    }
  }
  return { sportKey, fetchedAt, events: [...events.values()] };
}
