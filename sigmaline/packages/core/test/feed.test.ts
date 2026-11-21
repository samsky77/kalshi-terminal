import { describe, expect, it } from 'vitest';
import { filterFeed, GRADE_CONFIG, isStale, priceMarkets, quotesFromEvent, selectionLabel, type MarketQuote, type PricedSelection, type SimSamples } from '../src';

const NOW = Date.parse('2026-11-21T18:00:00Z');
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60000).toISOString();

function row(over: Partial<PricedSelection> = {}): PricedSelection {
  return {
    selection: { market: 'ml', side: 'home' }, key: 'ml:home::::', books: 5, bestBook: 'draftkings', bestDecimal: 2.1, consensusP: 0.5,
    model: { win: 0.5, push: 0, loss: 0.5 }, fair: { win: 0.5, push: 0, loss: 0.5 }, fairDecimal: 2, ev: 0.05, modelEv: 0.05, consensusEv: 0.05,
    grade: 'A', w: 0.35, snapshotTs: iso(1), bestTs: iso(1), fairSource: 'blend', ...over,
  };
}

describe('feed filter (junk rows)', () => {
  const opt = { nowMs: NOW, commenceMs: NOW + 3600000 };
  it('keeps a clean, fresh row', () => {
    const f = filterFeed([row()], opt);
    expect(f.keep.length).toBe(1);
    expect(Object.values(f.counts).every((n) => n === 0)).toBe(true);
  });
  it('drops and counts each kind of junk', () => {
    const f = filterFeed([
      row({ key: 'a', bestBook: null, bestDecimal: NaN }), // no price
      row({ key: 'b', fairDecimal: NaN, ev: NaN }), // no fair
      row({ key: 'c' }), row({ key: 'c' }), // duplicate
      row({ key: 'd', ev: 0.4 }), // sanity cap → anomaly
      row({ key: 'e', ev: -0.3 }), // a very negative edge is a bad price, not bad data: kept (DAT-002)
      row({ key: 'f', bestTs: iso(GRADE_CONFIG.staleMinutes + 1) }), // stale
    ], opt);
    expect(f.counts).toMatchObject({ no_price: 1, no_fair: 1, duplicate: 1, sanity: 1, stale: 1, started: 0 });
    expect(f.keep.map((r) => r.key)).toEqual(['c', 'e']);
    expect(f.anomalies.map((r) => r.key)).toEqual(['d']);
    expect(f.stale[0].grade).toBe('none'); // stale rows are never graded
  });
  it('hides every row once the event has started (no live betting)', () => {
    const f = filterFeed([row(), row({ key: 'x' })], { nowMs: NOW, commenceMs: NOW - 1 });
    expect(f.keep.length).toBe(0);
    expect(f.counts.started).toBe(2);
  });
  it('stale means older than the configured minutes, using the book timestamp', () => {
    expect(isStale(iso(GRADE_CONFIG.staleMinutes - 0.5), NOW)).toBe(false);
    expect(isStale(iso(GRADE_CONFIG.staleMinutes + 0.5), NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });
});

describe('props', () => {
  const samples: SimSamples = { n: 4, home: Int16Array.from([100, 90, 110, 105]), away: Int16Array.from([95, 99, 100, 101]), winner: Int8Array.from([1, -1, 1, 1]) };
  const q = (book: string, over: number, under: number, ts = iso(1)): MarketQuote => ({ book, market: 'prop', line: 24.5, player: 'A Player', stat: 'player_points', prices: { over, under }, ts });
  it('a prop with no player model is priced consensus-only, not dropped', () => {
    const out = priceMarkets(samples, [q('draftkings', 2.2, 1.7), q('fanduel', 1.95, 1.87), q('betmgm', 1.9, 1.9)], { sport: 'nba', threeWay: false, bettable: new Set(['draftkings', 'fanduel', 'betmgm']), w: {} });
    expect(out.length).toBe(2);
    for (const p of out) {
      expect(p.fairSource).toBe('consensus');
      expect(p.fairDecimal).toBeGreaterThan(1);
      expect(p.bestTs).toBe(iso(1));
    }
    const over = out.find((p) => p.selection.side === 'over')!;
    expect(over.bestBook).toBe('draftkings');
    expect(over.ev).toBeCloseTo(over.consensusP * 2.2 - 1, 9); // edge = fair p × decimal − 1
  });
  it('Yes/No props parse as Over/Under 0.5 with readable labels', () => {
    const ev = {
      id: 1, sport_key: 'soccer_epl', commence_time: iso(-60), home_team: 'H', away_team: 'A',
      bookmakers: [{ key: 'draftkings', last_update: iso(2), markets: [{ key: 'player_goals', outcomes: [{ name: 'Yes', price: 3.0, description: 'Striker One' }, { name: 'No', price: 1.36, description: 'Striker One' }] }] }],
    };
    const quotes = quotesFromEvent(ev, 'decimal', iso(0));
    expect(quotes).toEqual([{ book: 'draftkings', market: 'prop', line: 0.5, player: 'Striker One', stat: 'player_goals', prices: { over: 3.0, under: 1.36 }, ts: iso(2) }]);
    expect(selectionLabel({ market: 'prop', side: 'over', line: 0.5, player: 'Striker One', stat: 'player_goals' }, 'H', 'A')).toBe('Striker One Goals 1+: Yes');
    expect(selectionLabel({ market: 'prop', side: 'under', line: 24.5, player: 'A Player', stat: 'player_points' }, 'H', 'A')).toBe('A Player Under 24.5 Points');
  });
  it('suspended / zero-limit outcomes are skipped and counted', () => {
    const stats = { suspended: 0 };
    const ev = {
      id: 1, sport_key: 'x', commence_time: iso(-60), home_team: 'H', away_team: 'A',
      bookmakers: [{ key: 'fanduel', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 1.8, suspended: true }, { name: 'A', price: 2.1, limit: 0 }] }] }],
    };
    const quotes = quotesFromEvent(ev, 'decimal', iso(0), stats);
    expect(stats.suspended).toBe(2);
    expect(quotes[0].prices).toEqual({});
  });
});

describe('QA regressions SHP-001 / SHP-002', () => {
  const samples: SimSamples = { n: 2, home: Int16Array.from([100, 90]), away: Int16Array.from([95, 99]), winner: Int8Array.from([1, -1]) };
  const q = (book: string, line: number, home: number, away: number): MarketQuote => ({ book, market: 'spread', line, prices: { home, away }, ts: iso(1) });
  const bettable = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
  it('SHP-001: a consensus-only market can be B but never A (nothing independent agrees)', () => {
    // main line 3 books, one book far out of line: ~+7% vs consensus
    const out = priceMarkets(samples, [q('a', -3.5, 2.2, 1.7), q('b', -3.5, 1.91, 1.91), q('c', -3.5, 1.9, 1.92)], { sport: 'nba', threeWay: false, bettable, w: {}, marketOnly: true });
    const home = out.find((p) => p.selection.side === 'home')!;
    expect(home.ev).toBeGreaterThan(0.05);
    expect(Number.isNaN(home.modelEv)).toBe(true);
    expect(home.grade).toBe('none'); // ≥ 5% needs agreement for A, and B is 2–5% only (FAQ)
  });
  it('SHP-002: a main line with 3 books is graded; a thin alternate line is not', () => {
    const main = [q('a', -3.5, 2.06, 1.8), q('b', -3.5, 1.91, 1.91), q('c', -3.5, 1.9, 1.92)];
    const alt = [q('a', -10.5, 3.6, 1.3), q('b', -10.5, 3.2, 1.35)];
    const out = priceMarkets(samples, [...main, ...alt], { sport: 'nba', threeWay: false, bettable, w: {}, marketOnly: true });
    const mainHome = out.find((p) => p.selection.line === -3.5 && p.selection.side === 'home')!;
    expect(mainHome.ev).toBeGreaterThanOrEqual(0.02);
    expect(mainHome.ev).toBeLessThan(0.05);
    expect(mainHome.grade).toBe('B');
    for (const p of out.filter((x) => x.selection.line === -10.5 || x.selection.line === 10.5)) expect(p.grade).toBe('none');
  });
});
