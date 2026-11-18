/**
 * A tiny table-level data API with three backends:
 *  - SupabaseDb (production; service-role key, server-side only)
 *  - PgDb (any Postgres via DATABASE_URL; used for integration tests and self-hosting)
 *  - MemoryDb (tests and offline demo; optional JSON file persistence)
 * The domain code (repo.ts) only talks to this interface.
 */
import { GENESIS_HASH } from '@sigmaline/core';

export type Row = Record<string, unknown>;

export interface Query {
  eq?: Row;
  neq?: Row;
  in?: Record<string, unknown[]>;
  gte?: Row;
  gt?: Row;
  lte?: Row;
  lt?: Row;
  isNull?: string[];
  notNull?: string[];
  order?: { col: string; asc?: boolean }[];
  limit?: number;
  columns?: string;
}

export interface Db {
  readonly kind: 'supabase' | 'pg' | 'memory';
  select<T = Row>(table: string, q?: Query): Promise<T[]>;
  insert(table: string, rows: Row | Row[]): Promise<void>;
  /** Insert one row and return it as stored (with generated ids). */
  insertReturning<T = Row>(table: string, row: Row): Promise<T>;
  /** Insert or update on conflict of the given comma-separated columns. */
  upsert(table: string, rows: Row | Row[], onConflict: string): Promise<void>;
  /** Insert, silently skipping rows that hit a unique constraint. Returns the rows actually inserted. */
  insertIgnore(table: string, rows: Row[], onConflict: string): Promise<number>;
  update(table: string, match: Row, patch: Row): Promise<void>;
  rpc<T = unknown>(fn: string, args: Row): Promise<T>;
}

// ── Memory ──────────────────────────────────────────────────────────────────
const APPEND_ONLY = new Set(['picks', 'pick_results']);
const SERIAL: Record<string, string> = {
  odds_snapshots: 'id', consensus_lines: 'id', sim_runs: 'id', calibration_reports: 'id', model_changes: 'id',
  backtest_runs: 'id', push_subscriptions: 'id', alert_log: 'id', job_runs: 'id', teams: 'id', players: 'id',
};

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const da = typeof a === 'string' && /^\d{4}-\d\d-\d\d/.test(a) ? Date.parse(a) : NaN;
  const db = typeof b === 'string' && /^\d{4}-\d\d-\d\d/.test(b) ? Date.parse(b) : NaN;
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return String(a) < String(b) ? -1 : 1;
}

export function matches(r: Row, q: Query = {}): boolean {
  for (const [k, v] of Object.entries(q.eq ?? {})) if (r[k] !== v) return false;
  for (const [k, v] of Object.entries(q.neq ?? {})) if (r[k] === v) return false;
  for (const [k, vs] of Object.entries(q.in ?? {})) if (!vs.includes(r[k])) return false;
  for (const [k, v] of Object.entries(q.gte ?? {})) if (!(cmp(r[k], v) >= 0) || r[k] == null) return false;
  for (const [k, v] of Object.entries(q.gt ?? {})) if (!(cmp(r[k], v) > 0) || r[k] == null) return false;
  for (const [k, v] of Object.entries(q.lte ?? {})) if (!(cmp(r[k], v) <= 0) || r[k] == null) return false;
  for (const [k, v] of Object.entries(q.lt ?? {})) if (!(cmp(r[k], v) < 0) || r[k] == null) return false;
  for (const k of q.isNull ?? []) if (r[k] !== null && r[k] !== undefined) return false;
  for (const k of q.notNull ?? []) if (r[k] === null || r[k] === undefined) return false;
  return true;
}

export class MemoryDb implements Db {
  readonly kind = 'memory' as const;
  tables: Record<string, Row[]> = {};
  private seq: Record<string, number> = {};
  constructor(private persist?: { load(): Record<string, Row[]> | null; save(t: Record<string, Row[]>): void }) {
    const loaded = persist?.load();
    if (loaded) this.tables = loaded;
    for (const [t, rows] of Object.entries(this.tables)) {
      const col = SERIAL[t];
      if (col) this.seq[t] = rows.reduce((m, r) => Math.max(m, Number(r[col]) || 0), 0);
    }
  }
  private t(name: string): Row[] { return (this.tables[name] ??= []); }
  private save() { this.persist?.save(this.tables); }
  private withSerial(table: string, r: Row): Row {
    const col = SERIAL[table];
    if (col && (r[col] === undefined || r[col] === null)) { this.seq[table] = (this.seq[table] ?? 0) + 1; return { ...r, [col]: this.seq[table] }; }
    return { ...r };
  }
  async select<T = Row>(table: string, q: Query = {}): Promise<T[]> {
    let rows = this.t(table).filter((r) => matches(r, q));
    for (const o of [...(q.order ?? [])].reverse()) rows = [...rows].sort((a, b) => (o.asc === false ? -1 : 1) * cmp(a[o.col], b[o.col]));
    if (q.limit !== undefined) rows = rows.slice(0, q.limit);
    return structuredClone(rows) as T[];
  }
  async insert(table: string, rows: Row | Row[]): Promise<void> {
    for (const r of Array.isArray(rows) ? rows : [rows]) this.t(table).push(this.withSerial(table, structuredClone(r)));
    this.save();
  }
  async insertReturning<T = Row>(table: string, row: Row): Promise<T> {
    const r = this.withSerial(table, structuredClone(row));
    this.t(table).push(r);
    this.save();
    return structuredClone(r) as T;
  }
  async upsert(table: string, rows: Row | Row[], onConflict: string): Promise<void> {
    if (APPEND_ONLY.has(table)) throw new Error(`table ${table} is append-only`);
    const keys = onConflict.split(',').map((s) => s.trim());
    for (const r of Array.isArray(rows) ? rows : [rows]) {
      const t = this.t(table);
      const i = t.findIndex((x) => keys.every((k) => x[k] === r[k]));
      if (i >= 0) t[i] = { ...t[i], ...structuredClone(r) }; else t.push(this.withSerial(table, structuredClone(r)));
    }
    this.save();
  }
  async insertIgnore(table: string, rows: Row[], onConflict: string): Promise<number> {
    const keys = onConflict.split(',').map((s) => s.trim());
    let n = 0;
    for (const r of rows) {
      const t = this.t(table);
      if (t.some((x) => keys.every((k) => x[k] === r[k]))) continue;
      t.push(this.withSerial(table, structuredClone(r))); n++;
    }
    this.save();
    return n;
  }
  async update(table: string, match: Row, patch: Row): Promise<void> {
    if (APPEND_ONLY.has(table)) throw new Error(`table ${table} is append-only: UPDATE is not allowed`);
    for (const r of this.t(table)) if (matches(r, { eq: match })) Object.assign(r, structuredClone(patch));
    this.save();
  }
  async rpc<T = unknown>(fn: string, args: Row): Promise<T> {
    if (fn !== 'append_pick') throw new Error(`unknown rpc ${fn}`);
    const p = args.p as Row;
    const picks = this.t('picks');
    const last = picks.reduce<Row | null>((m, r) => (!m || Number(r.seq) > Number(m.seq) ? r : m), null);
    const lastSeq = last ? Number(last.seq) : 0, lastHash = last ? String(last.hash) : GENESIS_HASH;
    if (Number(p.seq) !== lastSeq + 1) throw new Error(`chain: expected seq ${lastSeq + 1}, got ${p.seq}`);
    if (p.prev_hash !== lastHash) throw new Error('chain: prev_hash mismatch');
    if (Date.parse(String(p.commence_time)) <= Date.parse(String(p.created_at))) throw new Error('chain: game has already started');
    if (picks.some((r) => r.event_id === p.event_id && r.selection === p.selection)) throw new Error('duplicate pick');
    picks.push(structuredClone(p));
    this.save();
    return p as T;
  }
}

/** File persistence for MemoryDb (offline demo; Node only). */
export async function fileMemoryDb(path: string): Promise<MemoryDb> {
  const fs = await import('node:fs');
  return new MemoryDb({
    load: () => (fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null),
    save: (t) => { fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(path, JSON.stringify(t)); },
  });
}
