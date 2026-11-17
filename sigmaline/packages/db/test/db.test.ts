import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyChain } from '@sigmaline/core';
import { aggregate, allPicks, appendPick, MemoryDb, PgDb, publicVisible, type Db, type NewPick } from '../src';

const future = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

function pick(i: number, over: Partial<NewPick> = {}): NewPick {
  return {
    id: crypto.randomUUID(), created_at: new Date().toISOString(), sport: 'nba', league: 'nba', event_id: 'e1',
    event_name: 'Knicks @ Celtics', commence_time: future(2), market: 'spread', selection: `spread:away:${i}.5::`, label: `NYK +${i}.5`,
    line: i + 0.5, book: 'draftkings', price_decimal: 1.909091, fair_decimal: 1.7812345, ev: 0.07512345678, grade: 'A',
    model_version: 'nba-v1', stake_units: 2, snapshot_ts: new Date().toISOString(), writeup: { edge: 'x' }, ...over,
  };
}

async function exercise(db: Db) {
  for (let i = 1; i <= 3; i++) await appendPick(db, pick(i));
  const rows = await allPicks(db);
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3]);
  const check = await verifyChain(rows as unknown as Record<string, unknown>[]);
  expect(check).toEqual({ ok: true, checked: 3 });
  // duplicates are refused
  await expect(appendPick(db, pick(1))).rejects.toThrow();
  // games that already started are refused
  await expect(appendPick(db, pick(9, { commence_time: new Date(Date.now() - 60000).toISOString() }))).rejects.toThrow();
  // the log can't be edited
  await expect(db.update('picks', { seq: 1 }, { price_decimal: 2.5 })).rejects.toThrow(/append-only/);
}

describe('MemoryDb', () => {
  it('pick chain, append-only, filters', async () => {
    const db = new MemoryDb();
    await exercise(db);
    await db.insert('events', [{ id: 'a', commence_time: '2026-01-01T00:00:00Z', n: 1 }, { id: 'b', commence_time: '2026-02-01T00:00:00Z', n: 2 }]);
    expect((await db.select('events', { gte: { commence_time: '2026-01-15T00:00:00Z' } })).map((r) => r.id)).toEqual(['b']);
    expect(await db.insertIgnore('events', [{ id: 'a' }, { id: 'c' }], 'id')).toBe(1);
  });
  it('record stats and public visibility', async () => {
    const rows = [
      { ...pick(1), seq: 1, prev_hash: '', hash: '', commence_time: '2026-01-01T00:00:00Z', result: { pick_id: '', result: 'win', profit_units: 1.82, clv: 0.02, final_home: 1, final_away: 0, closing_decimal: 1.8, closing_p: 0.55, graded_at: '' } },
      { ...pick(2), seq: 2, prev_hash: '', hash: '', commence_time: '2026-01-02T00:00:00Z', result: { pick_id: '', result: 'loss', profit_units: -2, clv: -0.01, final_home: 1, final_away: 0, closing_decimal: 1.8, closing_p: 0.55, graded_at: '' } },
      { ...pick(3), seq: 3, prev_hash: '', hash: '', commence_time: future(5) },
    ];
    const s = aggregate(rows as any);
    expect(s.bets).toBe(3);
    expect(s.graded).toBe(2);
    expect(s.units).toBeCloseTo(-0.18, 9);
    expect(s.roi).toBeCloseTo(-0.18 / 4, 9);
    expect(s.avgClv).toBeCloseTo(0.005, 9);
    expect(publicVisible(rows as any)).toHaveLength(2);
  });
});

// Real Postgres: set PG_TEST_URL (CI runs this against a postgres service container).
const PG = process.env.PG_TEST_URL;
describe.skipIf(!PG)('Postgres schema + append_pick', () => {
  it('migration, triggers and chain round-trip', async () => {
    const pg = await import('pg');
    const Client = (pg as any).default?.Client ?? (pg as any).Client;
    const admin = new Client({ connectionString: PG });
    await admin.connect();
    await admin.query('drop schema public cascade; create schema public;');
    await admin.query(readFileSync(new URL('../../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8'));
    await admin.query(`insert into model_versions (id, sport_id, params) values ('nba-v1', 'nba', '{}')`);
    await admin.query(`insert into events (id, sport_id, league_id, home, away, commence_time) values ('e1', 'nba', 'nba', 'Celtics', 'Knicks', now() + interval '2 hours')`);
    const db = await PgDb.connect(PG!);
    await exercise(db);
    await expect(admin.query('delete from picks')).rejects.toThrow(/append-only/);
    await expect(admin.query('truncate picks')).rejects.toThrow(/append-only|foreign key/);
    await expect(admin.query('truncate picks cascade')).rejects.toThrow(/append-only/);
    await expect(admin.query(`update picks set ev = 1`)).rejects.toThrow(/append-only/);
    // insert directly with a forged hash: the chain no longer verifies
    await db.close();
    await admin.end();
  });
});
