import { describe, expect, it } from 'vitest';
import { MemoryDb, type EventRow } from '@sigmaline/db';
import { makeCtx } from '../src/context';
import { edgesToday } from '../src/edges-today';

const T0 = Date.parse('2026-11-22T18:00:00Z');
const START = new Date(T0 + 2 * 3600000).toISOString();
const ev = (id: string): EventRow => ({
  id, sport_id: 'nba', league_id: 'nba', home: 'Miami Heat', away: 'Oklahoma City Thunder', commence_time: START, status: 'scheduled',
  home_score: null, away_score: null, winner: null, final_at: null, provider_ids: {}, meta: {}, source: 'live', updated_at: new Date(T0).toISOString(),
});
const row = (event_id: string, key: string, ev: number, priceAgeMin: number) => ({
  event_id, selection_key: key, market: 'ml', selection: { market: 'ml', side: 'home' }, line: null, fair_decimal: 2.1, fair_probs: { win: 0.476, push: 0, loss: 0.524 },
  model_probs: null, consensus_p: 0.476, best_decimal: 2.2, best_book: 'draftkings', books: 12, ev, model_ev: null, consensus_ev: ev, grade: ev >= 0.02 ? 'B' : 'none',
  snapshot_ts: new Date(T0).toISOString(), price_ts: new Date(T0 - priceAgeMin * 60000).toISOString(), fair_source: 'consensus', updated_at: new Date(T0).toISOString(),
});

describe('edges command', () => {
  it('lists edges at or above the flag threshold, marks stale prices, and says "No data" for empty sports', async () => {
    const db = new MemoryDb();
    const ctx = await makeCtx(db, { DEMO: '1' }, { now: () => new Date(T0), fixturesDir: '.' });
    await db.upsert('events', [ev('nba-1'), ev('nba-2')] as unknown as Record<string, unknown>[], 'id');
    await db.upsert('market_prices', [row('nba-1', 'ml:home:::', 0.034, 3), row('nba-2', 'ml:home:::', 0.05, 45), row('nba-1', 'ml:away:::', 0.01, 3)] as unknown as Record<string, unknown>[], 'event_id,selection_key');
    const text = await edgesToday(ctx);
    expect(text).toContain('flag threshold 2.0%');
    expect(text).toContain('3.4%');
    expect(text).toContain('5.0%');
    expect(text).not.toContain(' 1.0%'); // below the threshold: not listed
    expect(text).toMatch(/5\.0%[^\n]*STALE/); // 45 minutes old
    expect(text).not.toMatch(/3\.4%[^\n]*STALE/);
    expect(text).toMatch(/nhl\s+0\s+0\s+0\s+No data/);
  });
  it('reports no data when the slate is empty', async () => {
    const ctx = await makeCtx(new MemoryDb(), { DEMO: '1' }, { now: () => new Date(T0), fixturesDir: '.' });
    expect(await edgesToday(ctx)).toContain('No data');
  });
});
