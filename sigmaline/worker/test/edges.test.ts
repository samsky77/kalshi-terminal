import { describe, expect, it } from 'vitest';
import type { PricedSelection } from '@sigmaline/core';
import { MemoryDb, type EventRow } from '@sigmaline/db';
import { makeCtx } from '../src/context';
import { closeEdges, edgeKey, gameDates, logEdges, settleEdges } from '../src/edges';
import { keepDeepLines } from '../src/ingest';

const T0 = Date.parse('2026-11-21T18:00:00Z');
const START = new Date(T0 + 3 * 3600000).toISOString();

function ev(): EventRow {
  return {
    id: 'nba-1', sport_id: 'nba', league_id: 'nba', home: 'Home Team', away: 'Away Team', commence_time: START, status: 'scheduled',
    home_score: null, away_score: null, winner: null, final_at: null, provider_ids: {}, meta: {}, source: 'live', updated_at: new Date(T0).toISOString(),
  };
}

function edge(price: number, over: Partial<PricedSelection> = {}): PricedSelection {
  return {
    selection: { market: 'spread', side: 'home', line: -3.5 }, key: 'spread:home:-3.5::', books: 8, bestBook: 'draftkings', bestDecimal: price, consensusP: 0.5,
    model: { win: 0.53, push: 0, loss: 0.47 }, fair: { win: 0.52, push: 0, loss: 0.48 }, fairDecimal: 1 / 0.52, ev: 0.52 * price - 1, modelEv: 0.05, consensusEv: 0.02,
    grade: 'B', w: 0.35, snapshotTs: new Date(T0).toISOString(), bestTs: new Date(T0 - 60000).toISOString(), fairSource: 'blend', ...over,
  };
}

describe('edge log', () => {
  it('an edge appearing → exactly one row with the time it was first shown; repeats only add price updates', async () => {
    const db = new MemoryDb();
    let now = new Date(T0);
    const ctx = await makeCtx(db, { DEMO: '1' }, { now: () => now, fixturesDir: '.' });
    const e = ev();
    await db.upsert('events', e as unknown as Record<string, unknown>, 'id');
    expect(await logEdges(ctx, e, 'nba-v1', [edge(1.98)])).toEqual({ logged: 1, updates: 0 });
    now = new Date(T0 + 15 * 60000);
    expect(await logEdges(ctx, e, 'nba-v1', [edge(1.98)])).toEqual({ logged: 0, updates: 0 }); // same price: nothing
    expect(await logEdges(ctx, e, 'nba-v1', [edge(2.0)])).toEqual({ logged: 0, updates: 1 }); // moved: one update
    const rows = await db.select<any>('edges_log');
    expect(rows.length).toBe(1);
    expect(rows[0].first_shown_at).toBe(new Date(T0).toISOString());
    expect(rows[0].price_taken).toBe(1.98);
    expect(rows[0].edge_key).toBe(edgeKey('nba-1', edge(1.98)));
    expect(rows[0].price_ts).toBe(new Date(T0 - 60000).toISOString());
    expect((await db.select('edge_price_updates')).length).toBe(1);
  });
  it('ungraded rows and started events are never logged', async () => {
    const db = new MemoryDb();
    const ctx = await makeCtx(db, { DEMO: '1' }, { now: () => new Date(T0), fixturesDir: '.' });
    expect((await logEdges(ctx, ev(), 'v', [edge(1.9, { grade: 'none' })])).logged).toBe(0);
    expect((await logEdges(ctx, { ...ev(), commence_time: new Date(T0 - 1).toISOString() }, 'v', [edge(1.98)])).logged).toBe(0);
  });
  it('original fields cannot be edited; settlement is filled once', async () => {
    const db = new MemoryDb();
    let now = new Date(T0);
    const ctx = await makeCtx(db, { DEMO: '1' }, { now: () => now, fixturesDir: '.' });
    const e = ev();
    await db.upsert('events', e as unknown as Record<string, unknown>, 'id');
    await logEdges(ctx, e, 'v', [edge(1.98)]);
    const key = edgeKey('nba-1', edge(1.98));
    await expect(db.update('edges_log', { edge_key: key }, { price_taken: 2.5 })).rejects.toThrow(/original fields/);
    await expect(db.upsert('edges_log', { edge_key: key, price_taken: 2.5 }, 'edge_key')).rejects.toThrow(/append-only/);
    // closing line from the latest snapshot taken near the start
    await db.insert('odds_snapshots', ['draftkings', 'fanduel', 'betmgm'].map((book, i) => ({
      event_id: 'nba-1', provider: 'propline', book, market: 'spread', line: -3.5, player: null, stat: null, prices: { home: 1.91 + i * 0.01, away: 1.91 - i * 0.01 }, ts: START, kind: 'closing', pulled_at: new Date(Date.parse(START) - 10 * 60000).toISOString(),
    })));
    now = new Date(Date.parse(START) + 60000);
    expect(await closeEdges(ctx)).toBe(1);
    const closed = (await db.select<any>('edges_log'))[0];
    expect(closed.closing_price).toBe(1.91);
    expect(closed.clv).toBeCloseTo(closed.closing_p * 1.98 - 1, 6);
    await db.update('events', { id: 'nba-1' }, { status: 'final', home_score: 110, away_score: 100, winner: 1, final_at: now.toISOString() });
    expect(await settleEdges(ctx)).toBe(1);
    const settled = (await db.select<any>('edges_log'))[0];
    expect(settled.result).toBe('win');
    expect(settled.units).toBeCloseTo(0.98, 9);
    expect(await settleEdges(ctx)).toBe(0); // never re-settled
    await expect(db.update('edges_log', { edge_key: key }, { result: 'loss' })).rejects.toThrow(/only be filled once/);
  });
});

describe('ingest helpers', () => {
  it('keeps main and well-quoted lines only', () => {
    const q = (book: string, market: 'spread' | 'total' | 'prop', line: number, extra = {}) => ({ book, market, line, prices: { home: 1.9, away: 1.9 }, ts: '', ...extra });
    const quotes = [
      ...['a', 'b', 'c', 'd'].map((b) => q(b, 'spread', -3.5)), // main
      q('a', 'spread', -10.5), q('b', 'spread', -10.5), // thin alternate
      ...['a', 'b', 'c'].map((b) => q(b, 'spread', -2.5)), // alternate with 3 books: can never be graded (PCFB-001)
      ...['a', 'b', 'c', 'd', 'e'].map((b) => q(b, 'spread', -1.5)), // alternate with 5 books: kept
      q('a', 'prop', 24.5, { player: 'P', stat: 'player_points' }), q('b', 'prop', 24.5, { player: 'P', stat: 'player_points' }),
      q('a', 'prop', 30.5, { player: 'P', stat: 'player_points' }),
    ];
    const kept = keepDeepLines(quotes as any).map((x) => `${x.market}${x.line}`);
    expect(kept.filter((k) => k === 'spread-10.5').length).toBe(0);
    expect(kept.filter((k) => k === 'spread-1.5').length).toBe(5);
    expect(kept.filter((k) => k === 'spread-2.5').length).toBe(0);
    expect(kept.filter((k) => k === 'prop24.5').length).toBe(2);
    expect(kept.filter((k) => k === 'prop30.5').length).toBe(0);
  });
  it('box scores are found under the UTC or the US Eastern date', () => {
    expect(gameDates({ commence_time: '2026-11-21T00:30:00Z' })).toEqual(['2026-11-21', '2026-11-20']);
    expect(gameDates({ commence_time: '2026-11-21T18:00:00Z' })).toEqual(['2026-11-21']);
  });
});

describe('prop settlement mappings (PNBA-001..004)', () => {
  it('every requested prop market can be read from a box score', async () => {
    const { PROP_MARKETS } = await import('@sigmaline/core');
    const { settleableStat, statValue } = await import('../src/simulate');
    for (const [sport, markets] of Object.entries(PROP_MARKETS)) for (const m of markets) expect(settleableStat(m), `${sport} ${m}`).toBe(true);
    expect(statValue('player_blocks', { blocks: 3 })).toBe(3);
    expect(statValue('player_steals', { stl: 2 })).toBe(2);
    expect(statValue('player_turnovers', { turnovers: 4 })).toBe(4);
    expect(statValue('player_anytime_td', { rushing_touchdowns: 0, receiving_touchdowns: 1 })).toBe(1);
    expect(statValue('player_anytime_td', { rushing_touchdowns: 0 })).toBeUndefined(); // missing part: don't guess
    expect(statValue('goalie_saves', { saves: 31 })).toBe(31);
  });
});
