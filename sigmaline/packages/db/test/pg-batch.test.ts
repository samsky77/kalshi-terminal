import { describe, expect, it } from 'vitest';
import { PgDb } from '../src/backends';

/** Fake pg pool: answers the column-type lookup and records every INSERT. */
function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith('select column_name')) return { rows: [{ column_name: 'id', data_type: 'text' }, { column_name: 'v', data_type: 'integer' }, { column_name: 'j', data_type: 'jsonb' }] };
      calls.push({ sql, params });
      const tuples = (sql.match(/\),\(/g)?.length ?? 0) + 1;
      return { rows: [], rowCount: tuples };
    },
  };
}

describe('PgDb batched inserts', () => {
  it('sends many rows in a few multi-row statements', async () => {
    const pool = fakePool();
    const db = new PgDb(pool);
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `r${i}`, v: i }));
    await db.insert('t', rows);
    expect(pool.calls.length).toBe(3); // 500 + 500 + 200
    expect(pool.calls[0].params.length).toBe(1000);
    expect(pool.calls[2].sql).toContain('values ($1,$2),($3,$4)');
  });

  it('splits on a change of columns and keeps row order', async () => {
    const pool = fakePool();
    await new PgDb(pool).insert('t', [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', j: { x: 1 } }, { id: 'd', v: 4 }]);
    expect(pool.calls.map((c) => c.params)).toEqual([['a', 1, 'b', 2], ['c', '{"x":1}'], ['d', 4]]);
  });

  it('upsert keeps the last row per conflict key in a chunk', async () => {
    const pool = fakePool();
    await new PgDb(pool).upsert('t', [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }], 'id');
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].params).toEqual(['a', 3, 'b', 2]);
    expect(pool.calls[0].sql).toContain('on conflict ("id") do update set "v" = excluded."v"');
  });

  it('insertIgnore returns the inserted count', async () => {
    const pool = fakePool();
    expect(await new PgDb(pool).insertIgnore('t', [{ id: 'a', v: 1 }, { id: 'b', v: 2 }], 'id')).toBe(2);
  });
});
