import { describe, expect, it } from 'vitest';
import {
  marginPmf, priceSelection, simulateGame, summarize, type Selection, type SimSamples, type SportId, gradeBet,
  simulateProps, marketImpliedExpectation, priceMarkets, pickHistogram,
} from '../src';

const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };

function consistency(s: SimSamples, sport: SportId, lines: number[], totals: number[]) {
  const ml = priceSelection(s, { market: 'ml', side: 'home' }, sport);
  const mlA = priceSelection(s, { market: 'ml', side: 'away' }, sport);
  // ML home == spread home -0.5 + P(margin exactly 0 resolved as win) — in no-tie sports they're equal at -0.5
  let homeWins = 0;
  for (let i = 0; i < s.n; i++) if (s.winner[i] === 1) homeWins++;
  expect(ml.win).toBeCloseTo(homeWins / s.n, 12);
  expect(ml.win + mlA.win + priceSelection(s, { market: 'ml', side: 'draw' }, sport).win).toBeCloseTo(1, 9);
  let prev = -1;
  for (const L of lines) {
    const h = priceSelection(s, { market: 'spread', side: 'home', line: L }, sport);
    const a = priceSelection(s, { market: 'spread', side: 'away', line: -L }, sport);
    expect(h.win + a.win + h.push).toBeCloseTo(1, 9);
    expect(h.push).toBeCloseTo(a.push, 12);
    expect(h.win).toBeGreaterThanOrEqual(prev - 1e-12); // lines ascending: getting more points can only raise cover %
    prev = h.win;
  }
  let prevO = 2;
  for (const T of totals) {
    const o = priceSelection(s, { market: 'total', side: 'over', line: T }, sport);
    const u = priceSelection(s, { market: 'total', side: 'under', line: T }, sport);
    expect(o.win + u.win + o.push).toBeCloseTo(1, 9);
    expect(o.win).toBeLessThanOrEqual(prevO + 1e-12);
    prevO = o.win;
  }
  return ml;
}

describe('one joint distribution -> consistent ML, spread, total', () => {
  it('NBA: ML equals spread at -0.5 and the summary', () => {
    const { samples: s } = simulateGame({ sport: 'nba', expect: { home: 116, away: 111 }, seed: 1 });
    expect(s.n).toBeGreaterThanOrEqual(10000);
    const ml = consistency(s, 'nba', [-12.5, -5.5, -5, -0.5, 3.5], [210.5, 227, 227.5, 240.5]);
    const sp = priceSelection(s, { market: 'spread', side: 'home', line: -0.5 }, 'nba');
    expect(sp.win).toBeCloseTo(ml.win, 12); // no ties in basketball
    expect(summarize(s).homeWin).toBeCloseTo(ml.win, 12);
    // margin and total moments
    const m = Array.from(s.home, (h, i) => h - s.away[i]);
    expect(mean(m)).toBeGreaterThan(4);
    expect(mean(m)).toBeLessThan(6);
    const sd = Math.sqrt(mean(m.map((x) => (x - mean(m)) ** 2)));
    expect(sd).toBeGreaterThan(12.5);
    expect(sd).toBeLessThan(14.5);
  });
  for (const [sport, e] of [['cbb', { home: 75, away: 70 }], ['nfl', { home: 24, away: 21 }], ['cfb', { home: 31, away: 24 }], ['nhl', { home: 3.2, away: 2.8 }], ['soccer', { home: 1.6, away: 1.1 }]] as const) {
    it(`${sport}: consistent`, () => {
      const { samples: s } = simulateGame({ sport, expect: e, seed: 42 });
      const big = sport === 'nhl' || sport === 'soccer';
      consistency(s, sport, big ? [-2.5, -1.5, -1, -0.75, -0.25, 0, 0.5, 1.5] : [-10.5, -7, -3, -2.5, 0, 3.5], big ? [1.5, 2.25, 2.5, 3, 5.5, 6, 6.5] : [40.5, 44, 47.5, 130.5, 145]);
    });
  }
  it('tennis: consistent and ML comes from sets, not games', () => {
    const { samples: s, params } = simulateGame({ sport: 'tennis', tennis: { tour: 'atp', bestOf: 3, slam: false, anchor: { pHomeMl: 0.65, totalLine: 22.5, pOver: 0.5 } }, seed: 3 });
    const ml = consistency(s, 'tennis', [-4.5, -2.5, -1.5, 0, 2.5], [20.5, 22.5, 24.5]);
    expect(ml.win).toBeGreaterThan(0.6);
    expect(ml.win).toBeLessThan(0.7);
    const tot = mean(Array.from(s.home, (h, i) => h + s.away[i]));
    expect(tot).toBeGreaterThan(21);
    expect(tot).toBeLessThan(24.5);
    expect(params.pA).toBeGreaterThan(params.pB as number);
  });
  it('same seed reproduces the same run', () => {
    const a = simulateGame({ sport: 'nhl', expect: { home: 3, away: 3 }, seed: 99 }).samples;
    const b = simulateGame({ sport: 'nhl', expect: { home: 3, away: 3 }, seed: 99 }).samples;
    expect(Array.from(a.home)).toEqual(Array.from(b.home));
  });
});

describe('model shapes', () => {
  it('NFL keeps key numbers 3 and 7', () => {
    const p = marginPmf('nfl', -2.5, 13.5);
    const at = (m: number) => p.p[m - p.min];
    expect(at(3) + at(-3)).toBeGreaterThan(1.8 * (at(2) + at(-2)));
    expect(at(7) + at(-7)).toBeGreaterThan(at(8) + at(-8));
    let mu = 0;
    for (let i = 0; i < p.p.length; i++) mu += p.p[i] * (p.min + i);
    expect(mu).toBeCloseTo(-2.5, 3);
  });
  it('CFB has no ties', () => {
    const { samples: s } = simulateGame({ sport: 'cfb', expect: { home: 28, away: 28 }, seed: 5 });
    for (let i = 0; i < s.n; i++) expect(s.home[i]).not.toBe(s.away[i]);
  });
  it('NHL: OT/SO always produces a winner and the mean is near λ', () => {
    const { samples: s } = simulateGame({ sport: 'nhl', expect: { home: 3.1, away: 2.9 }, seed: 8 });
    for (let i = 0; i < s.n; i++) expect(s.winner[i]).not.toBe(0);
    const t = mean(Array.from(s.home, (h, i) => h + s.away[i]));
    expect(t).toBeGreaterThan(6.0); // regulation 6.0 + OT/SO goal ~ +0.23
    expect(t).toBeLessThan(6.5);
  });
  it('soccer: realistic draw rate', () => {
    const { samples: s } = simulateGame({ sport: 'soccer', expect: { home: 1.4, away: 1.2 }, seed: 9 });
    const d = priceSelection(s, { market: 'ml', side: 'draw' }, 'soccer').win;
    expect(d).toBeGreaterThan(0.24);
    expect(d).toBeLessThan(0.31);
    // Asian handicap 0 = draw no bet: push equals the draw probability
    const ah0 = priceSelection(s, { market: 'spread', side: 'home', line: 0 }, 'soccer');
    expect(ah0.push).toBeCloseTo(d, 12);
  });
  it('market-implied fallback reproduces the consensus', () => {
    const e = marketImpliedExpectation('nba', { spreadLine: -6.5, pHomeCover: 0.5, totalLine: 228.5, pOver: 0.5 })!;
    expect(e.home - e.away).toBeCloseTo(6.5, 6);
    const { samples } = simulateGame({ sport: 'nba', expect: e, seed: 2 });
    const c = priceSelection(samples, { market: 'spread', side: 'home', line: -6.5 }, 'nba');
    expect(c.win / (c.win + c.loss)).toBeGreaterThan(0.47);
    expect(c.win / (c.win + c.loss)).toBeLessThan(0.53);
    const s = marketImpliedExpectation('soccer', { pHomeMl: 0.45, pDraw: 0.27, totalLine: 2.5, pOver: 0.5 })!;
    expect(s.home).toBeGreaterThan(s.away);
  });
});

describe('props simulate with the game', () => {
  it('player points correlate with team score', () => {
    const { samples } = simulateGame({ sport: 'nba', expect: { home: 115, away: 110 }, seed: 4 });
    simulateProps(samples, [{ player: 'A', stat: 'player_points', team: 'home', mean: 25, dispersion: 20, beta: 1 }], 115, 110, 4);
    const pts = samples.props!['A|player_points'];
    const x = Array.from(samples.home), y = Array.from(pts);
    const mx = mean(x), my = mean(y);
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < x.length; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
    expect(cov / Math.sqrt(vx * vy)).toBeGreaterThan(0.1);
    expect(my).toBeGreaterThan(24);
    expect(my).toBeLessThan(26.5);
    const o = priceSelection(samples, { market: 'prop', side: 'over', line: 24.5, player: 'A', stat: 'player_points' }, 'nba');
    expect(o.win).toBeGreaterThan(0.4);
    expect(o.win).toBeLessThan(0.6);
  });
});

describe('grading', () => {
  const sel = (s: Partial<Selection>): Selection => ({ market: 'spread', side: 'home', ...s }) as Selection;
  it('spreads, totals, quarter lines, NFL tie push', () => {
    expect(gradeBet(sel({ line: -3 }), 'nfl', { home: 24, away: 21 })).toBe('push');
    expect(gradeBet(sel({ line: -2.5 }), 'nfl', { home: 24, away: 21 })).toBe('win');
    expect(gradeBet(sel({ side: 'away', line: 2.5 }), 'nfl', { home: 24, away: 21 })).toBe('loss');
    expect(gradeBet({ market: 'total', side: 'over', line: 44.5 }, 'nfl', { home: 24, away: 21 })).toBe('win');
    expect(gradeBet({ market: 'ml', side: 'home' }, 'nfl', { home: 20, away: 20 })).toBe('push');
    expect(gradeBet({ market: 'ml', side: 'home' }, 'soccer', { home: 1, away: 1 })).toBe('loss');
    expect(gradeBet({ market: 'ml', side: 'draw' }, 'soccer', { home: 1, away: 1 })).toBe('win');
    expect(gradeBet(sel({ line: -0.25 }), 'soccer', { home: 1, away: 1 })).toBe('half_loss');
    expect(gradeBet(sel({ line: -0.75 }), 'soccer', { home: 2, away: 1 })).toBe('half_win');
    expect(gradeBet({ market: 'ml', side: 'home' }, 'tennis', { home: 18, away: 20, winner: 1 })).toBe('win');
    expect(gradeBet({ market: 'prop', side: 'over', line: 20.5, player: 'X', stat: 'player_points' }, 'nba', { home: 1, away: 0, props: {} })).toBe('void');
  });
});

describe('pricing pipeline', () => {
  it('prices quotes, takes best bettable price, grades', () => {
    const { samples } = simulateGame({ sport: 'nba', expect: { home: 118, away: 110 }, seed: 12 });
    const ts = '2026-11-17T22:00:00Z';
    const quotes = [
      { book: 'draftkings', market: 'spread' as const, line: -5.5, prices: { home: 1.91, away: 1.91 }, ts },
      { book: 'fanduel', market: 'spread' as const, line: -5.5, prices: { home: 1.95, away: 1.87 }, ts },
      { book: 'betmgm', market: 'spread' as const, line: -5.5, prices: { home: 1.91, away: 1.91 }, ts },
      { book: 'pinnacle', market: 'spread' as const, line: -5.5, prices: { home: 2.2, away: 1.75 }, ts },
    ];
    const rows = priceMarkets(samples, quotes, { sport: 'nba', threeWay: false, bettable: new Set(['draftkings', 'fanduel', 'betmgm']), w: { spread: 0.35 } });
    const home = rows.find((r) => r.selection.side === 'home')!;
    expect(home.bestBook).toBe('fanduel'); // pinnacle not bettable
    expect(home.books).toBe(4);
    expect(home.ev).toBeGreaterThan(0);
    const h = pickHistogram(summarize(samples), home.selection, 'nba');
    expect(h.bins).toHaveLength(12);
    expect(h.bins.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 9);
    expect(h.bins[h.bins.length - 1].wins).toBe(true);
    expect(h.bins[0].wins).toBe(false);
  });
});
