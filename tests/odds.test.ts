import { describe, expect, it } from 'vitest';
import { americanToDecimal, buildConsensus, modeLine, overround, removeVig } from '../src/core/odds';
import type { OddsEvent } from '../src/core/types';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('vig removal', () => {
  it('-110/-110 becomes 50/50', () => {
    const d = americanToDecimal(-110);
    close(d, 1.909090909, 1e-6);
    const [a, b] = removeVig([d, d]);
    close(a, 0.5); close(b, 0.5);
    close(overround([d, d]), 0.047619, 1e-5);
  });
  it('two-way favourite: -200/+170', () => {
    const [f, u] = removeVig([americanToDecimal(-200), americanToDecimal(170)]);
    // raw 0.6667 + 0.3704 = 1.0370 -> 0.6429 / 0.3571
    close(f, 0.6667 / 1.037, 1e-3);
    close(f + u, 1);
  });
  it('three-way soccer prices sum to 1 and keep ordering', () => {
    const p = removeVig([2.1, 3.4, 3.6]);
    close(p.reduce((a, b) => a + b, 0), 1);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
  });
  it('rejects suspended prices (<= 1.0)', () => {
    expect(removeVig([1.0, 9]).every(Number.isNaN)).toBe(true);
  });
});

describe('consensus', () => {
  const book = (key: string, h: number, a: number, sp: number, sh: number, sa: number, tl: number, o: number, u: number) => ({
    key, title: key, last_update: `2026-11-13T2${key.length}:00:00Z`,
    markets: [
      { key: 'h2h', outcomes: [{ name: 'Home', price: h }, { name: 'Away', price: a }] },
      { key: 'spreads', outcomes: [{ name: 'Home', price: sh, point: sp }, { name: 'Away', price: sa, point: -sp }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: o, point: tl }, { name: 'Under', price: u, point: tl }] },
    ],
  });
  const ev: OddsEvent = {
    id: 'e', sport_key: 'basketball_nba', commence_time: '2026-11-14T00:00:00Z', home_team: 'Home', away_team: 'Away',
    bookmakers: [
      book('a', 1.5, 2.7, -5.5, 1.91, 1.91, 220.5, 1.91, 1.91),
      book('bb', 1.52, 2.6, -5.5, 1.87, 1.95, 220.5, 1.95, 1.87),
      book('ccc', 1.48, 2.8, -6, 1.91, 1.91, 221, 1.91, 1.91),
    ],
  };
  it('takes the median no-vig moneyline across books', () => {
    const c = buildConsensus(ev, false)!;
    const per = [[1.5, 2.7], [1.52, 2.6], [1.48, 2.8]].map(([h, a]) => removeVig([h, a])[0]).sort();
    close(c.pHome, per[1] / (per[1] + (1 - per[1])));
    close(c.pHome + c.pAway, 1);
    expect(c.booksMl).toBe(3);
    expect(c.books).toEqual(['a', 'bb', 'ccc']);
  });
  it('uses the modal main spread/total and the median prob at that line', () => {
    const c = buildConsensus(ev, false)!;
    expect(c.spreadLine).toBe(-5.5);
    expect(c.booksSpread).toBe(2);
    close(c.pHomeCover!, (0.5 + removeVig([1.87, 1.95])[0]) / 2);
    expect(c.totalLine).toBe(220.5);
  });
  it('modeLine breaks ties toward the median', () => {
    expect(modeLine([3, 3.5, 4])).toBe(3.5);
    expect(modeLine([2.5, 2.5, 3, 3])).toBeDefined();
  });
  it('skips Asian quarter lines', () => {
    const q: OddsEvent = { ...ev, bookmakers: [{ key: 'q', title: 'q', last_update: '', markets: [
      { key: 'h2h', outcomes: [{ name: 'Home', price: 2 }, { name: 'Away', price: 2 }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: 1.9, point: 2.25 }, { name: 'Under', price: 1.9, point: 2.25 }] }] }] };
    expect(buildConsensus(q, false)!.totalLine).toBeUndefined();
  });
});
