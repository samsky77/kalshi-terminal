import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyChain } from '@sigmaline/core';
import { allPicks, getEvents, MemoryDb } from '@sigmaline/db';
import { makeCtx, mayPull } from '../src/context';
import { gradePicks } from '../src/grade';
import { sendAlerts } from '../src/alerts';
import { snapshotKind } from '../src/ingest';
import { tick } from '../src/tick';

const FIX = resolve(__dirname, '../../fixtures/odds');
const RECORDED = Date.parse('2026-11-14T03:08:00Z');

describe('pipeline on recorded odds (fixtures)', () => {
  it('publishes only inside the pre-game window, never after the start, and the chain verifies', async () => {
    const db = new MemoryDb();
    const shift = 30 * 86400000;
    let clock = new Date(RECORDED + shift - 2 * 3600000);
    const ctx = await makeCtx(db, { DEMO: '1' }, { now: () => clock, fixturesDir: FIX, fixtureShiftMs: shift });
    await tick(ctx, { sports: ['nhl'] });
    const evs = (await getEvents(db, { sport: 'nhl' })).filter((e) => Date.parse(e.commence_time) > clock.getTime() + 3 * 3600000);
    expect(evs.length).toBeGreaterThan(0);
    const target = evs[0];
    // 3h before: nothing published
    clock = new Date(Date.parse(target.commence_time) - 3 * 3600000);
    await tick(ctx, { sports: ['nhl'] });
    expect((await allPicks(db)).filter((p) => p.event_id === target.id)).toHaveLength(0);
    // 75 min before: pre-game snapshot + publish
    clock = new Date(Date.parse(target.commence_time) - 75 * 60000);
    await tick(ctx, { sports: ['nhl'] });
    const ev = (await getEvents(db, { ids: [target.id] }))[0];
    expect(ev.meta.published).toBe(true);
    const picks = await allPicks(db);
    for (const p of picks) {
      expect(Date.parse(p.created_at)).toBeLessThan(Date.parse(p.commence_time));
      expect(['A', 'B']).toContain(p.grade);
      expect(Number(p.ev)).toBeGreaterThanOrEqual(0.02);
    }
    expect((await verifyChain(picks as unknown as Record<string, unknown>[])).ok).toBe(true);
    // after the start: a second tick publishes nothing new for that event
    const before = picks.length;
    clock = new Date(Date.parse(target.commence_time) + 5 * 60000);
    await tick(ctx, { sports: ['nhl'] });
    expect((await allPicks(db)).filter((p) => p.event_id === target.id).length).toBe(picks.filter((p) => p.event_id === target.id).length);
    expect((await allPicks(db)).length).toBeGreaterThanOrEqual(before);
  }, 120000);

  it('labels snapshots by each game\'s own time to start', () => {
    const now = Date.parse('2026-11-17T20:00:00Z');
    expect(snapshotKind(now + 75 * 60000, now)).toBe('pregame');
    expect(snapshotKind(now + 10 * 60000, now)).toBe('closing');
    expect(snapshotKind(now + 5 * 3600000, now)).toBe('refresh');
  });
});

describe('alerts', () => {
  it('sends at most one Discord post per pick, even when called twice', async () => {
    const db = new MemoryDb();
    const ctx = await makeCtx(db, { DEMO: '1', DISCORD_WEBHOOK_URL: 'https://discord.example/webhook', APP_URL: 'https://app.example' }, { fixturesDir: FIX });
    const calls: string[] = [];
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { calls.push(String(init?.body)); return new Response('', { status: 204 }); });
    const pick = {
      id: 'p1', seq: 1, created_at: new Date().toISOString(), sport: 'nba', league: 'nba', event_id: 'e1', event_name: 'New York Knicks @ Boston Celtics',
      commence_time: new Date(Date.now() + 3600000).toISOString(), market: 'spread', selection: 'spread:away:2.5::', label: 'New York Knicks +2.5', line: 2.5,
      book: 'draftkings', price_decimal: 1.909091, fair_decimal: 1.8, ev: 0.075, grade: 'A', model_version: 'nba-v1', stake_units: 2, snapshot_ts: '', writeup: null, prev_hash: '', hash: '',
    } as any;
    await sendAlerts(ctx, [pick]);
    await sendAlerts(ctx, [pick]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('A · NYK +2.5 (−110) · EV +7.5%');
    expect(calls[0]).toContain('https://app.example/game/e1');
    // below the alert threshold: no post
    await sendAlerts(ctx, [{ ...pick, id: 'p2', ev: 0.03 }]);
    expect(calls).toHaveLength(1);
    f.mockRestore();
  });
});

describe('grading', () => {
  it('grades from the final, computes CLV, and never re-grades', async () => {
    const db = new MemoryDb();
    const ctx = await makeCtx(db, { DEMO: '1' }, { fixturesDir: FIX });
    const start = new Date(Date.now() - 5 * 3600000).toISOString();
    await db.insert('events', { id: 'e1', sport_id: 'nba', league_id: 'nba', home: 'Boston Celtics', away: 'New York Knicks', commence_time: start, status: 'final', home_score: 110, away_score: 109, winner: 1, final_at: start, provider_ids: {}, meta: {}, source: 'live' });
    db.tables.picks = [{ id: 'p1', seq: 1, event_id: 'e1', commence_time: start, selection: 'spread:away:2.5::', price_decimal: 2.0, stake_units: 2, sport: 'nba' } as any];
    await db.insert('closing_lines', { event_id: 'e1', selection_key: 'spread:away:2.5::', closing_decimal: 1.9, closing_p: 0.53, push_p: 0, books: 4, ts: start });
    expect(await gradePicks(ctx)).toBe(1);
    const r = db.tables.pick_results[0] as any;
    expect(r.result).toBe('win'); // lost by 1 with +2.5
    expect(r.profit_units).toBeCloseTo(2, 9);
    expect(r.clv).toBeCloseTo(0.53 * 2 - 1, 6);
    expect(await gradePicks(ctx)).toBe(0);
  });
});

describe('budgeter pacing', () => {
  it('spreads the monthly Odds API quota across the month', async () => {
    const db = new MemoryDb();
    const ctx = await makeCtx(db, { ODDS_API_KEY: 'x' }, { now: () => new Date('2026-11-01T12:00:00Z') });
    // 500 credits / 30 days = 16.7/day; 1.5x slack = 25
    ctx.usedToday.set('oddsapi', 24);
    ctx.usage.get('oddsapi')!.used = 24;
    expect(mayPull(ctx, 'oddsapi', 'pregame', 3)).toBe(false);
    ctx.usedToday.set('oddsapi', 10);
    ctx.usage.get('oddsapi')!.used = 10;
    expect(mayPull(ctx, 'oddsapi', 'pregame', 3)).toBe(true);
    ctx.usage.get('oddsapi')!.used = 500;
    expect(mayPull(ctx, 'oddsapi', 'closing', 3)).toBe(false);
  });
});
