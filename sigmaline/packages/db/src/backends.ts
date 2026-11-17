import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Db, Query, Row } from './db';

// ── Supabase (PostgREST) ────────────────────────────────────────────────────
export class SupabaseDb implements Db {
  readonly kind = 'supabase' as const;
  private c: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.c = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  private apply(qb: any, q: Query = {}) {
    for (const [k, v] of Object.entries(q.eq ?? {})) qb = qb.eq(k, v);
    for (const [k, v] of Object.entries(q.neq ?? {})) qb = qb.neq(k, v);
    for (const [k, v] of Object.entries(q.in ?? {})) qb = qb.in(k, v);
    for (const [k, v] of Object.entries(q.gte ?? {})) qb = qb.gte(k, v);
    for (const [k, v] of Object.entries(q.gt ?? {})) qb = qb.gt(k, v);
    for (const [k, v] of Object.entries(q.lte ?? {})) qb = qb.lte(k, v);
    for (const [k, v] of Object.entries(q.lt ?? {})) qb = qb.lt(k, v);
    for (const k of q.isNull ?? []) qb = qb.is(k, null);
    for (const k of q.notNull ?? []) qb = qb.not(k, 'is', null);
    for (const o of q.order ?? []) qb = qb.order(o.col, { ascending: o.asc !== false });
    if (q.limit !== undefined) qb = qb.limit(q.limit);
    return qb;
  }
  async select<T = Row>(table: string, q: Query = {}): Promise<T[]> {
    // PostgREST caps responses at 1000 rows; page through when no limit was asked for.
    const page = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += page) {
      let qb = this.apply(this.c.from(table).select(q.columns ?? '*'), q);
      if (q.limit === undefined) qb = qb.range(from, from + page - 1);
      const { data, error } = await qb;
      if (error) throw new Error(`select ${table}: ${error.message}`);
      out.push(...((data ?? []) as T[]));
      if (q.limit !== undefined || (data ?? []).length < page) break;
    }
    return out;
  }
  async insert(table: string, rows: Row | Row[]): Promise<void> {
    const list = Array.isArray(rows) ? rows : [rows];
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await this.c.from(table).insert(list.slice(i, i + 500));
      if (error) throw new Error(`insert ${table}: ${error.message}`);
    }
  }
  async insertReturning<T = Row>(table: string, row: Row): Promise<T> {
    const { data, error } = await this.c.from(table).insert(row).select().single();
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    return data as T;
  }
  async upsert(table: string, rows: Row | Row[], onConflict: string): Promise<void> {
    const list = Array.isArray(rows) ? rows : [rows];
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await this.c.from(table).upsert(list.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    }
  }
  async insertIgnore(table: string, rows: Row[], onConflict: string): Promise<number> {
    if (!rows.length) return 0;
    const { data, error } = await this.c.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }).select();
    if (error) throw new Error(`insertIgnore ${table}: ${error.message}`);
    return (data ?? []).length;
  }
  async update(table: string, match: Row, patch: Row): Promise<void> {
    let qb: any = this.c.from(table).update(patch);
    for (const [k, v] of Object.entries(match)) qb = qb.eq(k, v);
    const { error } = await qb;
    if (error) throw new Error(`update ${table}: ${error.message}`);
  }
  async rpc<T = unknown>(fn: string, args: Row): Promise<T> {
    const { data, error } = await this.c.rpc(fn, args);
    if (error) throw new Error(`rpc ${fn}: ${error.message}`);
    return data as T;
  }
}

// ── Plain Postgres ──────────────────────────────────────────────────────────
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

export class PgDb implements Db {
  readonly kind = 'pg' as const;
  private pool: any;
  private colTypes = new Map<string, Map<string, string>>();
  constructor(pool: unknown) { this.pool = pool; }
  static async connect(url: string): Promise<PgDb> {
    const pg = await import('pg');
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    return new PgDb(new Pool({ connectionString: url, max: 4 }));
  }
  async close() { await this.pool.end(); }
  private async types(table: string): Promise<Map<string, string>> {
    let m = this.colTypes.get(table);
    if (!m) {
      const r = await this.pool.query('select column_name, data_type from information_schema.columns where table_name = $1', [table]);
      m = new Map(r.rows.map((x: any) => [x.column_name, x.data_type]));
      this.colTypes.set(table, m);
    }
    return m;
  }
  private val(v: unknown, type?: string): unknown {
    if (v === undefined) return null;
    if (type === 'jsonb' || type === 'json') return v === null ? null : JSON.stringify(v);
    return v;
  }
  private where(q: Query, params: unknown[]): string {
    const parts: string[] = [];
    const push = (op: string, obj?: Row) => { for (const [k, v] of Object.entries(obj ?? {})) { params.push(v); parts.push(`${ident(k)} ${op} $${params.length}`); } };
    push('=', q.eq); push('<>', q.neq); push('>=', q.gte); push('>', q.gt); push('<=', q.lte); push('<', q.lt);
    for (const [k, vs] of Object.entries(q.in ?? {})) { params.push(vs); parts.push(`${ident(k)} = any($${params.length})`); }
    for (const k of q.isNull ?? []) parts.push(`${ident(k)} is null`);
    for (const k of q.notNull ?? []) parts.push(`${ident(k)} is not null`);
    return parts.length ? ` where ${parts.join(' and ')}` : '';
  }
  async select<T = Row>(table: string, q: Query = {}): Promise<T[]> {
    const params: unknown[] = [];
    let sql = `select * from ${ident(table)}${this.where(q, params)}`;
    if (q.order?.length) sql += ` order by ${q.order.map((o) => `${ident(o.col)} ${o.asc === false ? 'desc' : 'asc'}`).join(', ')}`;
    if (q.limit !== undefined) sql += ` limit ${Number(q.limit)}`;
    const r = await this.pool.query(sql, params);
    return r.rows.map(normaliseRow) as T[];
  }
  async insert(table: string, rows: Row | Row[]): Promise<void> {
    await this.insRows(table, Array.isArray(rows) ? rows : [rows], () => '');
  }
  async insertReturning<T = Row>(table: string, row: Row): Promise<T> {
    const t = await this.types(table);
    const cols = Object.keys(row).filter((k) => row[k] !== undefined);
    const r = await this.pool.query(
      `insert into ${ident(table)} (${cols.map(ident).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
      cols.map((c) => this.val(row[c], t.get(c))),
    );
    return normaliseRow(r.rows[0]) as T;
  }
  async upsert(table: string, rows: Row | Row[], onConflict: string): Promise<void> {
    const keys = onConflict.split(',').map((s) => s.trim());
    await this.insRows(table, Array.isArray(rows) ? rows : [rows], (cols) => {
      const set = cols.filter((c) => !keys.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
      return ` on conflict (${keys.map(ident).join(',')}) do ${set.length ? `update set ${set.join(', ')}` : 'nothing'}`;
    });
  }
  async insertIgnore(table: string, rows: Row[], onConflict: string): Promise<number> {
    const keys = onConflict.split(',').map((s) => s.trim());
    return this.insRows(table, rows, () => ` on conflict (${keys.map(ident).join(',')}) do nothing`);
  }
  private async insRows(table: string, rows: Row[], suffix: (cols: string[]) => string): Promise<number> {
    if (!rows.length) return 0;
    const t = await this.types(table);
    let n = 0;
    for (const r of rows) {
      const cols = Object.keys(r).filter((k) => r[k] !== undefined);
      const params = cols.map((c) => this.val(r[c], t.get(c)));
      const sql = `insert into ${ident(table)} (${cols.map(ident).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})${suffix(cols)}`;
      const res = await this.pool.query(sql, params);
      n += res.rowCount ?? 0;
    }
    return n;
  }
  async update(table: string, match: Row, patch: Row): Promise<void> {
    const t = await this.types(table);
    const params: unknown[] = [];
    const set = Object.entries(patch).map(([k, v]) => { params.push(this.val(v, t.get(k))); return `${ident(k)} = $${params.length}`; });
    const where = this.where({ eq: match }, params);
    await this.pool.query(`update ${ident(table)} set ${set.join(', ')}${where}`, params);
  }
  async rpc<T = unknown>(fn: string, args: Row): Promise<T> {
    const names = Object.keys(args);
    const r = await this.pool.query(`select * from ${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})`, names.map((n) => (typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
    return normaliseRow(r.rows[0]) as T;
  }
}

/** Make pg rows look like PostgREST rows: numerics as numbers-in-strings are left; dates -> ISO strings. */
function normaliseRow(r: Row): Row {
  const o: Row = {};
  for (const [k, v] of Object.entries(r ?? {})) o[k] = v instanceof Date ? v.toISOString() : v;
  return o;
}
