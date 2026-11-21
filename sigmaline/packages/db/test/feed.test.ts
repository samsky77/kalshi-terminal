import { describe, expect, it } from 'vitest';
import { applyEdgeFilters, parseEdgeFilters, type EdgeRow } from '../src';

const SPORTS = ['nba', 'nhl', 'nfl', 'cbb', 'cfb', 'soccer', 'tennis'];
function r(id: string, over: Partial<EdgeRow> & { sport?: string; start?: string } = {}): EdgeRow {
  const { sport = 'nba', start = '2026-11-21T20:00:00Z', ...rest } = over;
  return {
    event_id: id, selection_key: `${id}-k`, market: 'spread', selection: { market: 'spread', side: 'home', line: -3.5 }, label: 'X −3.5', line: -3.5,
    fair_decimal: 1.9, fair_probs: { win: 0.52, push: 0, loss: 0.48 }, consensus_p: 0.5, best_decimal: 2, best_book: 'draftkings', books: 6, ev: 0.04,
    model_ev: 0.04, consensus_ev: 0.02, grade: 'B', price_ts: '2026-11-21T17:55:00Z', fair_source: 'blend',
    event: { id, sport: sport as any, league: sport, home: 'H', away: 'A', commence_time: start, label: 'A @ H' }, ...rest,
  };
}

describe('Edge Finder filters', () => {
  const rows = [
    r('a', { ev: 0.06, grade: 'A' }),
    r('b', { ev: 0.03, sport: 'nhl', best_book: 'fanduel', start: '2026-11-21T19:00:00Z' }),
    r('c', { ev: 0.025, market: 'prop', selection: { market: 'prop', side: 'over', line: 24.5, player: 'P', stat: 'player_points' }, price_ts: '2026-11-21T17:59:00Z' }),
  ];
  it('filters by sport, market type, book, minimum edge and grade', () => {
    expect(applyEdgeFilters(rows, { sport: 'nhl' }).map((x) => x.event_id)).toEqual(['b']);
    expect(applyEdgeFilters(rows, { type: 'prop' }).map((x) => x.event_id)).toEqual(['c']);
    expect(applyEdgeFilters(rows, { type: 'game' }).map((x) => x.event_id)).toEqual(['a', 'b']);
    expect(applyEdgeFilters(rows, { book: 'fanduel' }).map((x) => x.event_id)).toEqual(['b']);
    expect(applyEdgeFilters(rows, { minEdge: 0.03 }).map((x) => x.event_id)).toEqual(['a', 'b']);
    expect(applyEdgeFilters(rows, { grade: 'A' }).map((x) => x.event_id)).toEqual(['a']);
    expect(applyEdgeFilters(rows, { sport: 'nba', type: 'game', grade: 'B' })).toEqual([]);
  });
  it('sorts by edge, start time or last update', () => {
    expect(applyEdgeFilters(rows, { sort: 'edge' }).map((x) => x.event_id)).toEqual(['a', 'b', 'c']);
    expect(applyEdgeFilters(rows, { sort: 'start' }).map((x) => x.event_id)).toEqual(['b', 'a', 'c']);
    expect(applyEdgeFilters(rows, { sort: 'updated' }).map((x) => x.event_id)).toEqual(['c', 'a', 'b']);
  });
  it('every combination of filters and sorts returns a subset, sorted, without throwing', () => {
    for (const sport of ['all', ...SPORTS]) for (const type of ['all', 'game', 'prop']) for (const book of ['all', 'draftkings', 'fanduel', 'nope'])
      for (const min of ['', '2', '5', '30', 'x']) for (const grade of ['all', 'A', 'B', 'C']) for (const sort of ['edge', 'start', 'updated', 'zzz']) {
        const f = parseEdgeFilters({ sport, type, book, min, grade, sort }, SPORTS);
        const out = applyEdgeFilters(rows, f);
        expect(out.length).toBeLessThanOrEqual(rows.length);
        for (const x of out) expect(x.ev!).toBeGreaterThanOrEqual(f.minEdge);
      }
  });
  it('rejects junk query params', () => {
    expect(parseEdgeFilters({ sport: 'kalshi', book: 'x"><script>', min: '-5', grade: 'Z', sort: 'drop' }, SPORTS)).toEqual({ sport: 'all', type: 'all', book: 'all', minEdge: 0, grade: 'all', sort: 'edge' });
  });
});

describe('DAT-004: slate window ends at the end of tomorrow, US Eastern', () => {
  it('works across the UTC day boundary', async () => {
    const { endOfTomorrowET } = await import('../src/feed');
    // 2026-11-21 03:00 UTC = Nov 20, 10 PM ET -> window ends Nov 21 23:59:59 ET = Nov 22 04:59:59 UTC
    expect(endOfTomorrowET(new Date('2026-11-21T03:00:00Z')).toISOString()).toBe('2026-11-22T04:59:59.000Z');
    // 2026-11-21 18:00 UTC = Nov 21, 1 PM ET -> Nov 22 23:59:59 ET = Nov 23 04:59:59 UTC
    expect(endOfTomorrowET(new Date('2026-11-21T18:00:00Z')).toISOString()).toBe('2026-11-23T04:59:59.000Z');
  });
});
