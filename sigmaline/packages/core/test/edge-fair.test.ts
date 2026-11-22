import { describe, expect, it } from 'vitest';
import { priceMarkets, type MarketQuote } from '../src/pricing';
import { consensus } from '../src/odds';
import { edgePct } from '../src/edge';
import type { SimSamples } from '../src/types';

describe('fair price is the no-vig consensus, not the simulation', () => {
  // A sim that says the home team wins every time must not move the fair price at all.
  const sim: SimSamples = { n: 2, home: Int16Array.from([100, 100]), away: Int16Array.from([90, 90]), winner: Int8Array.from([1, 1]) };
  const ts = '2026-11-22T17:00:00Z';
  const q = (book: string, home: number, away: number): MarketQuote => ({ book, market: 'ml', prices: { home, away }, ts });
  const quotes = [q('pinnacle', 1.95, 1.95), q('a', 1.91, 1.91), q('b', 1.9, 1.92), q('c', 2.05, 1.8)];
  it('uses consensus probability and the real best price', () => {
    const out = priceMarkets(sim, quotes, { sport: 'nba', threeWay: false, bettable: new Set(['a', 'b', 'c']), w: { ml: 0.6 } });
    const home = out.find((p) => p.selection.side === 'home')!;
    const c = consensus(quotes.map((x) => ({ book: x.book, prices: [x.prices.home!, x.prices.away!] })))!;
    expect(home.fair.win).toBeCloseTo(c.probs[0], 9);
    expect(home.bestBook).toBe('c');
    expect(home.ev).toBeCloseTo(edgePct(c.probs[0], 2.05), 9);
    expect(home.fairSource).toBe('consensus');
  });
  it('shows no fair price (never a made-up one) when no book quotes every side', () => {
    const out = priceMarkets(sim, [{ book: 'a', market: 'ml', prices: { home: 2 }, ts }], { sport: 'nba', threeWay: false, bettable: new Set(['a']), w: {} });
    const home = out.find((p) => p.selection.side === 'home')!;
    expect(Number.isNaN(home.ev)).toBe(true);
    expect(home.grade).toBe('none');
  });
});
