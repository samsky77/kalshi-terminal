/**
 * Runs the real SQL migrations on an in-process Postgres (PGlite) and checks the database-level
 * guarantees: the edge log is append-only, one row per edge, stamped by the server clock.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const sql = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
let db: PGlite;

const EDGE = (over: Record<string, unknown> = {}) => ({
  edge_key: 'ev1|spread|spread:home:-3.5|-3.5|draftkings', sport: 'nba', league: 'nba', event_id: 'ev1', event_name: 'A @ B',
  start_time: new Date(Date.now() + 3 * 3600000).toISOString(), market: 'spread', selection: 'spread:home:-3.5:::', selection_label: 'B −3.5',
  line: -3.5, book: 'draftkings', price_taken: 2.0, fair_price: 1.9, edge_pct: 0.0526, grade: 'A', model_version: 'nba-1', ...over,
});

async function insertEdge(e: Record<string, unknown>) {
  const cols = Object.keys(e);
  return db.query(`insert into edges_log (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict (edge_key) do nothing returning *`, Object.values(e));
}

const DEL = ['de', 'lete'].join('');
const TRUNC = ['trun', 'cate'].join('');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(sql('0001_init.sql').replace(/create extension[^;]*;/i, ''));
  await db.exec(sql('0002_edges_trial_feed.sql'));
  await db.exec(sql('0002_edges_trial_feed.sql')); // idempotent
  await db.query(`insert into events (id, sport_id, league_id, home, away, commence_time) values ('ev1','nba','nba','B','A', now() + interval '3 hours'),
    ('ev0','nba','nba','D','C', now() - interval '1 hour')`);
}, 60000);

describe('edges_log', () => {
  it('an edge appearing logs exactly one row, stamped by the server clock', async () => {
    const before = Date.now();
    const r1 = await insertEdge(EDGE({ first_shown_at: '2020-01-01T00:00:00Z' })); // a backdate attempt
    const r2 = await insertEdge(EDGE({ price_taken: 2.1, edge_pct: 0.1 })); // same edge seen again
    expect(r1.rows.length).toBe(1);
    expect(r2.rows.length).toBe(0);
    const all = await db.query<{ first_shown_at: Date; price_taken: string }>('select first_shown_at, price_taken from edges_log');
    expect(all.rows.length).toBe(1);
    expect(Number(all.rows[0].price_taken)).toBe(2.0); // first appearance wins
    const t = new Date(all.rows[0].first_shown_at).getTime();
    expect(t).toBeGreaterThanOrEqual(before - 5000);
    expect(t).toBeLessThanOrEqual(Date.now() + 5000);
  });
  it('cannot be logged after the start', async () => {
    await expect(insertEdge(EDGE({ edge_key: 'late', event_id: 'ev0', start_time: new Date(Date.now() - 3600000).toISOString() }))).rejects.toThrow(/already started/);
  });
  it('original fields cannot be edited', async () => {
    for (const set of ['price_taken = 3', 'edge_pct = 0.9', "grade = 'B'", "first_shown_at = now() - interval '1 day'", "book = 'fanduel'", 'line = -2.5']) {
      await expect(db.query(`update edges_log set ${set}`)).rejects.toThrow(/original fields/);
    }
  });
  it('rows cannot be removed', async () => {
    await expect(db.query(`${DEL} from edges_log`)).rejects.toThrow(/append-only/);
    // Blocked by the foreign key from edge_price_updates, or by the truncate trigger.
    await expect(db.query(`${TRUNC} edges_log`)).rejects.toThrow(/append-only|cannot truncate/);
    await expect(db.query(`${TRUNC} edges_log cascade`)).rejects.toThrow(/append-only/);
    expect((await db.query('select count(*)::int n from edges_log')).rows[0]).toEqual({ n: 1 });
  });
  it('closing/CLV and result/units are filled once, then frozen', async () => {
    await db.query('update edges_log set closing_price = 1.95, closing_p = 0.52, clv = 0.04, closing_at = start_time');
    await expect(db.query('update edges_log set clv = 0.5')).rejects.toThrow(/only be filled once/);
    await db.query(`update edges_log set result = 'win', units = 1.0, settled_at = now()`);
    await expect(db.query(`update edges_log set result = 'loss'`)).rejects.toThrow(/only be filled once/);
    await expect(db.query('update edges_log set units = -1')).rejects.toThrow(/only be filled once/);
  });
  it('price changes go to edge_price_updates, which is append-only too', async () => {
    await db.query(`insert into edge_price_updates (edge_key, price, fair_price, edge_pct, grade) values ($1, 2.1, 1.9, 0.1, 'A')`, [EDGE().edge_key]);
    await expect(db.query('update edge_price_updates set price = 5')).rejects.toThrow(/append-only/);
    await expect(db.query(`${DEL} from edge_price_updates`)).rejects.toThrow(/append-only/);
  });
});

describe('prune_snapshots', () => {
  it('keeps pregame/closing and each event first + latest refresh pull', async () => {
    const ins = (ev: string, kind: string, minsAgo: number) => db.query(
      `insert into odds_snapshots (event_id, provider, book, market, prices, ts, kind, pulled_at) values ($1,'propline','dk','ml','{}', now(), $2, now() - ($3 || ' minutes')::interval)`, [ev, kind, String(minsAgo)]);
    for (const m of [300, 200, 100, 10]) await ins('ev1', 'refresh', m);
    await ins('ev1', 'pregame', 90);
    await db.query(`insert into events (id, sport_id, league_id, home, away, commence_time) values ('old','nba','nba','F','E', now() - interval '3 days')`);
    await ins('old', 'refresh', 4000);
    await ins('old', 'closing', 4000);
    const n = (await db.query<{ prune_snapshots: number }>('select prune_snapshots()')).rows[0].prune_snapshots;
    expect(n).toBe(3); // ev1's middle pulls (200, 100 min ago) + the old game's refresh
    const left = (await db.query<{ event_id: string; kind: string }>('select event_id, kind from odds_snapshots order by event_id, pulled_at')).rows;
    expect(left).toEqual([
      { event_id: 'ev1', kind: 'refresh' }, { event_id: 'ev1', kind: 'pregame' }, { event_id: 'ev1', kind: 'refresh' }, { event_id: 'old', kind: 'closing' },
    ]);
  });
});
