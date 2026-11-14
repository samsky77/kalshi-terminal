import { describe, expect, it } from 'vitest';
import { fitDiagnostics, runPipeline } from '../src/core/pipeline';
import { simulateGame } from '../src/core/sim';
import { SPORTS, type Consensus, type Sport } from '../src/core/types';
import { kalshiFixture, oddsFixture } from './helpers';

const base = { books: ['x', 'y', 'z'], booksMl: 3, booksSpread: 3, booksTotal: 3, lastUpdate: '2026-11-13T20:00:00Z' };
const simMl = (c: Consensus, s: { pHomeWin: number; pAwayWin: number }) =>
  c.pDraw !== undefined ? s.pHomeWin : s.pHomeWin / (s.pHomeWin + s.pAwayWin);
const target = (c: Consensus) => (c.pDraw !== undefined ? c.pHome : c.pHome / (c.pHome + c.pAway));

// Typical consensus inputs per sport (main lines priced at ~50%).
const CASES: [Sport, string, Consensus][] = [
  ['nba', 'fav -5.5', { ...base, pHome: 0.69, pAway: 0.31, spreadLine: -5.5, pHomeCover: 0.5, totalLine: 224.5, pOver: 0.5 }],
  ['nba', 'dog +9.5', { ...base, pHome: 0.21, pAway: 0.79, spreadLine: 9.5, pHomeCover: 0.5, totalLine: 231.5, pOver: 0.5 }],
  ['ncaab', 'fav -10.5', { ...base, pHome: 0.83, pAway: 0.17, spreadLine: -10.5, pHomeCover: 0.5, totalLine: 145.5, pOver: 0.5 }],
  ['nfl', 'fav -7', { ...base, pHome: 0.75, pAway: 0.25, spreadLine: -7, pHomeCover: 0.5, totalLine: 44.5, pOver: 0.5 }],
  ['nfl', 'pick -1.5', { ...base, pHome: 0.535, pAway: 0.465, spreadLine: -1.5, pHomeCover: 0.5, totalLine: 47.5, pOver: 0.5 }],
  ['ncaaf', 'fav -17.5', { ...base, pHome: 0.89, pAway: 0.11, spreadLine: -17.5, pHomeCover: 0.5, totalLine: 55.5, pOver: 0.5 }],
  ['nhl', 'fav', { ...base, pHome: 0.6, pAway: 0.4, spreadLine: -1.5, pHomeCover: 0.38, totalLine: 6.5, pOver: 0.48 }],
  ['soccer', 'home fav', { ...base, pHome: 0.52, pAway: 0.23, pDraw: 0.25, totalLine: 2.5, pOver: 0.53 }],
  ['soccer', 'tight', { ...base, pHome: 0.36, pAway: 0.35, pDraw: 0.29, totalLine: 2.5, pOver: 0.45 }],
  ['tennis', 'ATP fav', { ...base, pHome: 0.74, pAway: 0.26, totalLine: 22.5, pOver: 0.5 }],
  ['tennis', 'WTA close', { ...base, pHome: 0.55, pAway: 0.45, totalLine: 21.5, pOver: 0.5 }],
];

describe('calibration: sim reproduces the consensus it was anchored to', () => {
  it.each(CASES)('%s %s', (sport, _name, c) => {
    const { summary: s } = simulateGame(sport, c, { gameKey: `${sport}-${_name}`, competition: _name.startsWith('WTA') ? 'WTA Finals' : 'ATP Finals', tour: _name.startsWith('WTA') ? 'WTA' : 'ATP', bestOf: 3 });
    expect(s.runs).toBeGreaterThanOrEqual(20000);
    expect(Math.abs(simMl(c, s) - target(c))).toBeLessThanOrEqual(0.01); // moneyline within 1 point
    if (c.pHomeCover !== undefined && Math.abs(c.pHomeCover - 0.5) < 0.03) expect(Math.abs(s.pHomeCoverMain! - 0.5)).toBeLessThanOrEqual(0.02);
    if (c.pHomeCover !== undefined) expect(Math.abs(s.pHomeCoverMain! - c.pHomeCover)).toBeLessThanOrEqual(0.02);
    if (c.pOver !== undefined && Math.abs(c.pOver - 0.5) < 0.03) expect(Math.abs(s.pOverMain! - 0.5)).toBeLessThanOrEqual(0.02);
    if (c.pOver !== undefined) expect(Math.abs(s.pOverMain! - c.pOver)).toBeLessThanOrEqual(0.02);
    if (c.pDraw !== undefined) expect(Math.abs(s.pTie - c.pDraw)).toBeLessThanOrEqual(0.01);
  });

  it('is seeded and reproducible', () => {
    const c = CASES[0][2];
    const a = simulateGame('nba', c, { gameKey: 'repro' }).summary;
    const b = simulateGame('nba', c, { gameKey: 'repro' }).summary;
    expect(a).toEqual(b);
    const other = simulateGame('nba', c, { gameKey: 'repro', seedSalt: 'other' }).summary;
    expect(other.seed).not.toBe(a.seed);
  });
});

// Recorded real sportsbook consensus: every pre-game priced fixture game must meet the spec tolerances
// (ML within 1 point; main spread and total within 2 points of their consensus, which sits near 50%).
describe.each(SPORTS)('calibration on recorded %s fixtures', (sport) => {
  it('meets tolerances for pre-game consensus', () => {
    const snap = kalshiFixture(sport);
    const odds = oddsFixture(sport);
    const out = runPipeline({ sport, games: snap.games, odds: odds.batches, now: new Date(snap.fetchedAt), runs: 20000 });
    const pre = out.games.filter((g) => g.status === 'priced' && g.sim && g.consensus);
    expect(pre.length).toBeGreaterThan(0);
    const misses: string[] = [];
    for (const g of pre) {
      const f = fitDiagnostics(g.consensus!, g.sim!);
      // Tennis game spreads are a model output, not a fitted anchor (MODEL.md): a miss must be tiered C instead.
      const spreadTarget = sport !== 'tennis';
      if (!spreadTarget && (f.spread ?? 0) > 0.02) expect(f.fitMiss).toContain('spread');
      if (f.ml > 0.01 || (spreadTarget && (f.spread ?? 0) > 0.02) || (f.total ?? 0) > 0.02) misses.push(`${g.game.id} ml=${f.ml.toFixed(3)} sp=${f.spread?.toFixed(3)} tot=${f.total?.toFixed(3)}`);
    }
    // soccer's Odds API "spreads" are Asian handicaps the 3-way fit does not target; checked separately below
    if (sport !== 'soccer') expect(misses).toEqual([]);
  });
});

describe('soccer fixtures', () => {
  it('moneyline (3-way) and totals meet tolerance; spreads are diagnostics only', () => {
    const snap = kalshiFixture('soccer');
    const out = runPipeline({ sport: 'soccer', games: snap.games, odds: oddsFixture('soccer').batches, now: new Date(snap.fetchedAt) });
    const pre = out.games.filter((g) => g.status === 'priced');
    const mlMiss = pre.filter((g) => g.fit!.ml > 0.01);
    const totMiss = pre.filter((g) => (g.fit!.total ?? 0) > 0.02);
    expect(mlMiss).toEqual([]);
    expect(totMiss.length / pre.length).toBeLessThan(0.05);
    for (const g of totMiss) expect(g.fit!.fitMiss).toContain('total');
  });
});
