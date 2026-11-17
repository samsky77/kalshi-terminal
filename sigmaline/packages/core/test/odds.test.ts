import { describe, expect, it } from 'vitest';
import {
  americanToDecimal, blendFair, clv, consensus, decimalToAmerican, expectedValue, fairDecimal, gradePick,
  noVigMultiplicative, noVigPower, pickFilters, weightedMedian,
} from '../src';

describe('odds conversions (hand-worked)', () => {
  it('american <-> decimal', () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.909091, 6);
    expect(americanToDecimal(+150)).toBeCloseTo(2.5, 9);
    expect(decimalToAmerican(1.909091)).toBe(-110);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(Number.isNaN(americanToDecimal(50))).toBe(true);
  });
});

describe('no-vig', () => {
  it('-110/-110 is 50/50', () => {
    const [a, b] = noVigMultiplicative([americanToDecimal(-110), americanToDecimal(-110)]);
    expect(a).toBeCloseTo(0.5, 12);
    expect(b).toBeCloseTo(0.5, 12);
  });
  it('-150/+130 multiplicative', () => {
    // implied 0.6 and 0.434783; sum 1.034783 -> 0.579832 / 0.420168
    const [a, b] = noVigMultiplicative([americanToDecimal(-150), americanToDecimal(130)]);
    expect(a).toBeCloseTo(0.6 / (0.6 + 1 / 2.3), 9);
    expect(a).toBeCloseTo(0.579832, 5);
    expect(b).toBeCloseTo(0.420168, 5);
  });
  it('power method sums to 1 and shades the longshot more than multiplicative', () => {
    const prices = [2.1, 3.6, 3.4]; // home, away, draw (overround ~5.8%)
    const p = noVigPower(prices);
    const m = noVigMultiplicative(prices);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    // power: p_i = q_i^k with k>1 -> favourite keeps a larger share
    expect(p[0]).toBeGreaterThan(m[0]);
    expect(p[1]).toBeLessThan(m[1]);
    // hand check: k solves sum q^k = 1
    const q = prices.map((d) => 1 / d);
    const k = Math.log(p[0]) / Math.log(q[0]);
    expect(q.reduce((s, x) => s + Math.pow(x, k), 0)).toBeCloseTo(1, 9);
  });
});

describe('consensus', () => {
  it('weighted median: Pinnacle counts double', () => {
    // weights 1,1,2 -> cumulative 1,2,4; half = 2 lands exactly between 0.52 and 0.55
    expect(weightedMedian([{ v: 0.5, w: 1 }, { v: 0.52, w: 1 }, { v: 0.55, w: 2 }])).toBeCloseTo(0.535, 12);
    expect(weightedMedian([{ v: 0.5, w: 1 }, { v: 0.52, w: 1 }, { v: 0.55, w: 1 }])).toBeCloseTo(0.52, 12);
  });
  it('builds a normalised median across books', () => {
    const c = consensus([
      { book: 'draftkings', prices: [1.91, 1.91] },
      { book: 'fanduel', prices: [1.87, 1.95] },
      { book: 'pinnacle', prices: [1.95, 1.95] },
    ])!;
    expect(c.books).toBe(3);
    expect(c.hasPinnacle).toBe(true);
    expect(c.probs[0] + c.probs[1]).toBeCloseTo(1, 12);
    // fanduel side-0 is ~0.5104; with pinnacle weight 2 the median is 0.5 for both sides
    expect(c.probs[0]).toBeCloseTo(0.5, 6);
  });
});

describe('EV, fair and blend (hand-worked)', () => {
  it('EV = p x decimal - 1', () => {
    expect(expectedValue({ win: 0.55, push: 0, loss: 0.45 }, 1 + 100 / 110)).toBeCloseTo(0.05, 9);
    expect(expectedValue({ win: 0.5, push: 0, loss: 0.5 }, 1.909091)).toBeCloseTo(-0.0454545, 6);
  });
  it('blend 0.35 * 0.60 + 0.65 * 0.50 = 0.535', () => {
    const f = blendFair({ win: 0.6, push: 0, loss: 0.4 }, 0.5, 0.35);
    expect(f.win).toBeCloseTo(0.535, 12);
  });
  it('blend keeps the model push probability (spread -3)', () => {
    // model 45/10/45 -> 0.5 conditional; c = .35*.5 + .65*.52 = .513; win = .513*.9 = .4617
    const f = blendFair({ win: 0.45, push: 0.1, loss: 0.45 }, 0.52, 0.35);
    expect(f.win).toBeCloseTo(0.4617, 9);
    expect(f.push).toBeCloseTo(0.1, 12);
    expect(expectedValue(f, 2.0)).toBeCloseTo(0.4617 * 2 + 0.1 - 1, 9);
    expect(fairDecimal(f)).toBeCloseTo(0.9 / 0.4617, 9);
  });
  it('w is clamped to [0.15, 0.6]', () => {
    expect(blendFair({ win: 1, push: 0, loss: 0 }, 0, 0.99).win).toBeCloseTo(0.6, 12);
    expect(blendFair({ win: 1, push: 0, loss: 0 }, 0, 0).win).toBeCloseTo(0.15, 12);
  });
  it('grades', () => {
    expect(gradePick(0.06, 0.1, 0.01)).toBe('A');
    expect(gradePick(0.06, 0.1, -0.01)).toBe('B'); // consensus disagrees -> not A
    expect(gradePick(0.03, 0.05, 0.01)).toBe('B');
    expect(gradePick(0.019, 0.05, 0.01)).toBe('none');
  });
  it('CLV vs the no-vig close', () => {
    // took +110 (2.10); closed at 50% no-vig -> 0.5*2.1-1 = +5%
    expect(clv(2.1, 0.5)).toBeCloseTo(0.05, 12);
  });
  it('pick filters', () => {
    expect(pickFilters({ snapshotAgeMin: 30, books: 3, isProp: false, keyPlayerUnknown: false }).ok).toBe(true);
    expect(pickFilters({ snapshotAgeMin: 95, books: 5, isProp: false, keyPlayerUnknown: false }).ok).toBe(false);
    expect(pickFilters({ snapshotAgeMin: 10, books: 2, isProp: false, keyPlayerUnknown: false }).ok).toBe(false);
    expect(pickFilters({ snapshotAgeMin: 10, books: 2, isProp: true, keyPlayerUnknown: false }).ok).toBe(true);
    expect(pickFilters({ snapshotAgeMin: 10, books: 4, isProp: false, keyPlayerUnknown: true }).ok).toBe(false);
  });
});

describe('cold start: market-only pricing', () => {
  it('fair = consensus, so only line shopping can create an edge', async () => {
    const { simulateGame, priceMarkets } = await import('../src');
    const { samples } = simulateGame({ sport: 'nba', expect: { home: 120, away: 110 }, seed: 1 });
    const ts = '2026-11-17T00:00:00Z';
    const q = (book: string, h: number, a: number) => ({ book, market: 'ml' as const, prices: { home: h, away: a }, ts });
    const rows = priceMarkets(samples, [q('draftkings', 1.8, 2.05), q('fanduel', 1.8, 2.05), q('betmgm', 1.8, 2.25)], {
      sport: 'nba', threeWay: false, bettable: new Set(['draftkings', 'fanduel', 'betmgm']), w: {}, marketOnly: true,
    });
    const away = rows.find((r) => r.selection.side === 'away')!;
    const home = rows.find((r) => r.selection.side === 'home')!;
    expect(away.fair.win).toBeCloseTo(away.consensusP, 12);
    expect(away.bestBook).toBe('betmgm');
    expect(away.ev).toBeGreaterThan(0.02); // betmgm's 2.25 beats the market
    expect(home.ev).toBeLessThan(0); // the model's lean toward home is ignored without ratings
    expect(pickFilters({ snapshotAgeMin: 1, books: 3, isProp: false, keyPlayerUnknown: false, ev: 0.3 }).ok).toBe(false);
  });
});
