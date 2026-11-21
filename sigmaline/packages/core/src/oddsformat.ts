import { americanToDecimal } from './odds';
import type { MarketQuote } from './pricing';
import type { Side } from './types';

/** The Odds API v4 event shape (PropLine returns the same shape). */
export interface OddsApiOutcome {
  name: string; price: number; point?: number | null; description?: string;
  /** Provider flags we honour when present (PropLine / exchanges): suspended or no stake allowed. */
  suspended?: boolean; is_suspended?: boolean; limit?: number | null; redacted?: boolean;
}
export interface OddsApiMarket { key: string; last_update?: string; outcomes: OddsApiOutcome[]; team?: string | null }
export interface OddsApiBookmaker { key: string; title?: string; last_update?: string; markets: OddsApiMarket[] }
export interface OddsApiEvent {
  id: string | number;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmaker[];
}

const PROP_MARKETS = /^(player_|batter_|pitcher_|goalie_)/;

/**
 * Flatten an Odds-API-shaped event into per-book, per-line quotes. Spread lines are normalised to
 * the home side; quotes missing a side are kept (the pricer only builds consensus from complete
 * quotes, but a one-sided quote can still be the best price).
 */
/** Outcome is suspended, zero-limit or has no usable price (item 8: never quoted or graded). */
export function isSuspendedOutcome(o: OddsApiOutcome): boolean {
  return !!(o.suspended || o.is_suspended || o.redacted || o.limit === 0 || typeof o.price !== 'number' || !Number.isFinite(o.price));
}

export function quotesFromEvent(ev: OddsApiEvent, priceFormat: 'decimal' | 'american', fetchedAt: string, stats?: { suspended: number }): MarketQuote[] {
  const toDec = (p: number) => (priceFormat === 'american' ? americanToDecimal(p) : p);
  const out: MarketQuote[] = [];
  for (const bk of ev.bookmakers ?? []) {
    for (const m0 of bk.markets ?? []) {
      const live = m0.outcomes.filter((o) => !isSuspendedOutcome(o));
      if (stats) stats.suspended += m0.outcomes.length - live.length;
      const m = { ...m0, outcomes: live };
      // Provider's own last_update (market, else bookmaker); fetch time only if the provider sends none.
      const raw = m.last_update ?? bk.last_update ?? fetchedAt;
      // A book can't have updated a price after we fetched it (clock skew / replays): clamp (DAT-005).
      const ts = Date.parse(raw) > Date.parse(fetchedAt) ? fetchedAt : raw;
      if (m.key === 'h2h' || m.key === 'h2h_3_way') {
        const prices: Partial<Record<Side, number>> = {};
        for (const o of m.outcomes) {
          if (o.name === ev.home_team) prices.home = toDec(o.price);
          else if (o.name === ev.away_team) prices.away = toDec(o.price);
          else if (/^draw$/i.test(o.name)) prices.draw = toDec(o.price);
        }
        out.push({ book: bk.key, market: 'ml', prices, ts });
      } else if (m.key === 'spreads') {
        const h = m.outcomes.find((o) => o.name === ev.home_team), a = m.outcomes.find((o) => o.name === ev.away_team);
        const line = h?.point ?? (a?.point !== undefined && a?.point !== null ? -a.point : undefined);
        if (line === undefined) continue;
        // Both sides must be at mirrored lines to count as one market.
        if (h && a && a.point !== undefined && a.point !== null && Math.abs((h.point ?? 0) + a.point) > 1e-9) continue;
        const prices: Partial<Record<Side, number>> = {};
        if (h) prices.home = toDec(h.price);
        if (a) prices.away = toDec(a.price);
        out.push({ book: bk.key, market: 'spread', line, prices, ts });
      } else if (m.key === 'totals') {
        if (m.team) continue; // team totals ride the same key on PropLine; skip them
        const o = m.outcomes.find((x) => /^over$/i.test(x.name)), u = m.outcomes.find((x) => /^under$/i.test(x.name));
        const line = o?.point ?? u?.point;
        if (line === undefined || line === null) continue;
        if (o && u && o.point !== u.point) continue;
        const prices: Partial<Record<Side, number>> = {};
        if (o) prices.over = toDec(o.price);
        if (u) prices.under = toDec(u.price);
        out.push({ book: bk.key, market: 'total', line, prices, ts });
      } else if (PROP_MARKETS.test(m.key)) {
        const byPlayer = new Map<string, { line: number; prices: Partial<Record<Side, number>> }>();
        for (const o of m.outcomes) {
          if (!o.description) continue;
          // Over/Under props carry a point. Yes/No props (anytime scorer / TD) are "1 or more",
          // i.e. Over/Under 0.5 of the same stat, which grades identically.
          const yesNo = /^(yes|no)$/i.test(o.name) && (o.point === undefined || o.point === null);
          const point = yesNo ? 0.5 : o.point;
          if (point === undefined || point === null) continue;
          const side: Side | null = /^(over|yes)$/i.test(o.name) ? 'over' : /^(under|no)$/i.test(o.name) ? 'under' : null;
          if (!side) continue;
          const k = `${o.description}|${point}`;
          const cur = byPlayer.get(k) ?? { line: point, prices: {} };
          cur.prices[side] = toDec(o.price);
          byPlayer.set(k, cur);
        }
        for (const [k, v] of byPlayer) {
          out.push({ book: bk.key, market: 'prop', line: v.line, player: k.split('|')[0], stat: m.key, prices: v.prices, ts });
        }
      }
    }
  }
  return out;
}

/** Most common line across books (ties broken toward the median). */
export function mainLine(quotes: MarketQuote[], market: 'spread' | 'total'): number | undefined {
  const lines = quotes.filter((q) => q.market === market && q.line !== undefined).map((q) => q.line!);
  if (!lines.length) return undefined;
  const c = new Map<number, number>();
  for (const l of lines) c.set(l, (c.get(l) ?? 0) + 1);
  const max = Math.max(...c.values());
  const sorted = [...lines].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  return [...c.entries()].filter(([, n]) => n === max).map(([l]) => l).sort((a, b) => Math.abs(a - med) - Math.abs(b - med))[0];
}
