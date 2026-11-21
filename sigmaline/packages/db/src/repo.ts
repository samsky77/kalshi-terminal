/** Domain-level reads and writes shared by the worker and the web app. */
import {
  DEFAULT_THRESHOLDS, GENESIS_HASH, pickHash, seedFrom, SPORT_DEFS, W_DEFAULT,
  type GradeThresholds, type MarketQuote, type MarketType, type SportId,
} from '@sigmaline/core';
import type { Db, Row } from './db';

// ── Settings ────────────────────────────────────────────────────────────────
export interface AppSettings {
  thresholds: GradeThresholds;
  alertEv: number;
  bettableBooks: string[];
  quotas: Record<string, { period: 'day' | 'month'; limit: number }>;
  refreshHours: number;
  /** Picks may publish once a game is this many hours out (latest fresh prices); 1.5 = pre-game window only. */
  publishHoursBefore: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  thresholds: DEFAULT_THRESHOLDS,
  alertEv: 0.04,
  bettableBooks: ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'espnbet', 'fanatics', 'hardrockbet', 'ballybet', 'betparx', 'fliff'],
  quotas: { oddsapi: { period: 'month', limit: 500 }, propline: { period: 'day', limit: 1000 }, sharpapi: { period: 'day', limit: 5000 } },
  refreshHours: 6,
  publishHoursBefore: 12,
};

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  thresholds: 'thresholds', alertEv: 'alert_ev', bettableBooks: 'bettable_books', quotas: 'quotas', refreshHours: 'refresh_hours', publishHoursBefore: 'publish_hours_before',
};

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select<{ key: string; value: unknown }>('settings');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const out = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  for (const [k, key] of Object.entries(SETTING_KEYS) as [keyof AppSettings, string][]) {
    if (m.has(key)) (out as any)[k] = m.get(key);
  }
  return out;
}

export async function setSetting(db: Db, key: keyof AppSettings, value: unknown): Promise<void> {
  await db.upsert('settings', { key: SETTING_KEYS[key], value, updated_at: new Date().toISOString() }, 'key');
}

// ── Model versions ──────────────────────────────────────────────────────────
export interface ModelParams {
  /** Blend weight per market type. */
  w: Record<MarketType, number>;
  halfLifeDays: number;
  nSims: number;
}

export interface ModelVersion { id: string; sport_id: SportId; created_at: string; params: ModelParams; parent: string | null; notes: string | null }

/**
 * Starting blend weights. Default 0.35 (spec). NFL starts at the 0.15 floor: in the walk-forward
 * backtest (2017–2025, nflverse closing lines) a results-only rating model scored Brier 0.222 vs the
 * closing market's 0.210, so a heavier model weight only adds noise (docs/decisions.md). The
 * nightly job moves every weight by at most ±0.05 when held-out log loss improves.
 */
export const INITIAL_W: Partial<Record<SportId, number>> = { nfl: 0.15 };

export function defaultModelParams(sport: SportId): ModelParams {
  const w = INITIAL_W[sport] ?? W_DEFAULT;
  return { w: { ml: w, spread: w, total: w, prop: W_DEFAULT }, halfLifeDays: SPORT_DEFS[sport].halfLifeDays, nSims: 10000 };
}

export async function currentModel(db: Db, sport: SportId): Promise<ModelVersion> {
  const rows = await db.select<ModelVersion>('model_versions', { eq: { sport_id: sport }, order: [{ col: 'created_at', asc: false }], limit: 1 });
  if (rows[0]) return rows[0];
  const v: ModelVersion = { id: `${sport}-v1`, sport_id: sport, created_at: new Date().toISOString(), params: defaultModelParams(sport), parent: null, notes: 'initial defaults' };
  await db.upsert('model_versions', v as unknown as Row, 'id');
  return v;
}

export async function saveModelVersion(db: Db, sport: SportId, params: ModelParams, parent: string, notes: string): Promise<ModelVersion> {
  const day = new Date().toISOString().slice(0, 10);
  const existing = await db.select<ModelVersion>('model_versions', { eq: { sport_id: sport } });
  const id = `${sport}-${day}-${existing.length + 1}`;
  const v: ModelVersion = { id, sport_id: sport, created_at: new Date().toISOString(), params, parent, notes };
  await db.insert('model_versions', v as unknown as Row);
  return v;
}

// ── Events ──────────────────────────────────────────────────────────────────
export interface EventRow {
  id: string;
  sport_id: SportId;
  league_id: string;
  home: string;
  away: string;
  commence_time: string;
  status: 'scheduled' | 'live' | 'final' | 'void' | 'postponed';
  home_score: number | null;
  away_score: number | null;
  winner: number | null;
  final_at: string | null;
  provider_ids: Record<string, string>;
  meta: Record<string, unknown>;
  source: 'live' | 'history';
  updated_at?: string;
}

/** Club-name affixes that differ between sources ("FC Bayern München" vs "Bayern Munich"). */
const SOCCER_STRIP = new Set(['fc', 'afc', 'cf', 'cfc', 'sc', 'ssc', 'ac', 'acf', 'as', 'ss', 'us', 'cd', 'ud', 'rc', 'rcd', 'sd', 'ca', 'club', 'de', 'futbol',
  'calcio', 'bc', 'osc', 'ogc', 'sco', 'aj', 'vfb', 'vfl', 'tsg', 'sv', 'fsv', 'bsc', '1', '04', '05', '29', 'cp', 'sk', 'fk']);
const SOCCER_ALIAS: Record<string, string> = {
  'bayern munchen': 'bayern munich', 'internazionale milano': 'inter milan', 'inter': 'inter milan', athletic: 'athletic bilbao',
  'espanyol barcelona': 'espanyol', 'rayo vallecano madrid': 'rayo vallecano', 'real betis balompie': 'real betis', 'olympique lyonnais': 'lyon',
  'olympique marseille': 'marseille', 'stade rennais': 'rennes', 'stade brestois': 'brest', 'racing lens': 'lens', 'strasbourg alsace': 'strasbourg',
  'deportivo alaves': 'alaves', 'atletico madrid': 'atletico madrid', 'celta vigo': 'celta vigo', 'paris saint germain': 'paris saint germain',
  'wolverhampton wanderers': 'wolverhampton wanderers', 'wolves': 'wolverhampton wanderers', 'tottenham': 'tottenham hotspur',
  'brighton': 'brighton and hove albion', 'newcastle': 'newcastle united', 'west ham': 'west ham united', 'koln': 'koln', 'hamburger': 'hamburg',
};

export function normTeam(s: string, sport?: string): string {
  const base = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (sport !== 'soccer') return base;
  const t = base.split(' ').filter((w) => !SOCCER_STRIP.has(w) && !/^(18|19|20)\d\d$/.test(w)).join(' ');
  return SOCCER_ALIAS[t] ?? t;
}

export function eventId(sport: SportId, league: string, commence: string, home: string, away: string): string {
  const key = `${sport}|${league}|${commence.slice(0, 10)}|${normTeam(home)}|${normTeam(away)}`;
  return `${sport}-${seedFrom(key).toString(16).padStart(8, '0')}${seedFrom(key + '#').toString(16).padStart(8, '0')}`;
}

export async function getEvents(db: Db, q: { sport?: SportId; from?: string; to?: string; ids?: string[]; status?: string[] }): Promise<EventRow[]> {
  return db.select<EventRow>('events', {
    eq: q.sport ? { sport_id: q.sport } : undefined,
    gte: q.from ? { commence_time: q.from } : undefined,
    lt: q.to ? { commence_time: q.to } : undefined,
    in: { ...(q.ids ? { id: q.ids } : {}), ...(q.status ? { status: q.status } : {}) },
    order: [{ col: 'commence_time', asc: true }],
  });
}

export async function getEvent(db: Db, id: string): Promise<EventRow | null> {
  return (await db.select<EventRow>('events', { eq: { id }, limit: 1 }))[0] ?? null;
}

// ── Odds ────────────────────────────────────────────────────────────────────
export interface SnapshotRow {
  id?: number;
  event_id: string;
  provider: string;
  book: string;
  market: MarketType;
  line: number | null;
  player: string | null;
  stat: string | null;
  /** Props: the player's team (migration 0002). */
  team?: string | null;
  prices: Record<string, number>;
  ts: string;
  kind: 'pregame' | 'closing' | 'refresh' | 'history';
  pulled_at: string;
}

export function quoteFromSnapshot(s: SnapshotRow): MarketQuote {
  return {
    book: s.book, market: s.market, line: s.line === null ? undefined : Number(s.line),
    player: s.player ?? undefined, stat: s.stat ?? undefined, team: s.team ?? undefined, prices: s.prices as MarketQuote['prices'], ts: s.ts,
  };
}

/** Latest pull for an event (all books from the most recent pull), optionally of one kind. */
export async function latestPull(db: Db, eventIdv: string, kind?: SnapshotRow['kind']): Promise<{ pulledAt: string | null; kind: string | null; snapshots: SnapshotRow[] }> {
  // Two small reads instead of loading every snapshot the event ever had (that made ticks take minutes).
  const eq = { event_id: eventIdv, ...(kind ? { kind } : {}) };
  const head = await db.select<SnapshotRow>('odds_snapshots', { eq, order: [{ col: 'pulled_at', asc: false }], limit: 1, columns: 'pulled_at,kind' });
  if (!head.length) return { pulledAt: null, kind: null, snapshots: [] };
  const top = head[0].pulled_at;
  // Everything pulled within 2 minutes of the newest pull counts as the same snapshot (props + lines).
  const from = new Date(Date.parse(top) - 119999).toISOString();
  const snaps = await db.select<SnapshotRow>('odds_snapshots', { eq, gte: { pulled_at: from }, order: [{ col: 'pulled_at', asc: false }] });
  return { pulledAt: top, kind: head[0].kind, snapshots: snaps };
}

// ── Picks ───────────────────────────────────────────────────────────────────
export interface PickRow {
  id: string;
  seq: number;
  created_at: string;
  sport: SportId;
  league: string;
  event_id: string;
  event_name: string;
  commence_time: string;
  market: MarketType;
  selection: string;
  label: string;
  line: number | null;
  book: string;
  price_decimal: number;
  fair_decimal: number;
  ev: number;
  grade: 'A' | 'B';
  model_version: string;
  stake_units: number;
  snapshot_ts: string;
  writeup: unknown;
  prev_hash: string;
  hash: string;
}

export type NewPick = Omit<PickRow, 'seq' | 'prev_hash' | 'hash'>;

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Append a pick to the hash chain. Values are rounded first so what is hashed is exactly what the
 * database stores. Retries if another writer won the race for the next seq.
 */
export async function appendPick(db: Db, p: NewPick): Promise<PickRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = (await db.select<PickRow>('picks', { order: [{ col: 'seq', asc: false }], limit: 1 }))[0];
    const seq = last ? Number(last.seq) + 1 : 1;
    const prev = last ? last.hash : GENESIS_HASH;
    const row: Row = {
      ...p,
      created_at: new Date(p.created_at).toISOString(),
      commence_time: new Date(p.commence_time).toISOString(),
      line: p.line === null ? null : Math.round(p.line * 100) / 100,
      price_decimal: r4(p.price_decimal), fair_decimal: r4(p.fair_decimal), ev: r6(p.ev), stake_units: p.stake_units, seq,
    };
    row.prev_hash = prev;
    row.hash = await pickHash(prev, row);
    try {
      await db.rpc('append_pick', { p: row });
      return row as unknown as PickRow;
    } catch (e) {
      const msg = String((e as Error).message);
      if (/chain: expected seq|prev_hash mismatch/.test(msg) && attempt < 4) continue;
      throw e;
    }
  }
  throw new Error('appendPick: gave up after retries');
}

export async function allPicks(db: Db): Promise<PickRow[]> {
  return db.select<PickRow>('picks', { order: [{ col: 'seq', asc: true }] });
}

export interface PickResultRow {
  pick_id: string;
  result: string;
  profit_units: number;
  final_home: number | null;
  final_away: number | null;
  closing_decimal: number | null;
  closing_p: number | null;
  clv: number | null;
  graded_at: string;
}

// ── Usage ───────────────────────────────────────────────────────────────────
export async function addUsage(db: Db, provider: string, n: number, remaining?: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const cur = (await db.select<{ used: number }>('provider_usage', { eq: { provider, day }, limit: 1 }))[0];
  await db.upsert('provider_usage', {
    provider, day, used: (cur ? Number(cur.used) : 0) + n,
    ...(remaining !== undefined ? { last_remaining: remaining } : {}), updated_at: new Date().toISOString(),
  }, 'provider,day');
}

export async function usageRows(db: Db, sinceDay: string): Promise<{ provider: string; day: string; used: number; last_remaining: number | null }[]> {
  return db.select('provider_usage', { gte: { day: sinceDay }, order: [{ col: 'day', asc: true }] });
}

/** Usage in the current quota period (calendar day or calendar month, UTC). */
export async function periodUsage(db: Db, provider: string, period: 'day' | 'month'): Promise<number> {
  const now = new Date();
  const since = period === 'day' ? now.toISOString().slice(0, 10) : `${now.toISOString().slice(0, 7)}-01`;
  const rows = await db.select<{ used: number }>('provider_usage', { eq: { provider }, gte: { day: since } });
  return rows.reduce((s, r) => s + Number(r.used), 0);
}

// ── Members ─────────────────────────────────────────────────────────────────
export interface MemberRow {
  whop_user_id: string;
  email: string | null;
  username: string | null;
  status: string;
  expires_at: string | null;
  checked_at: string | null;
  push_enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  time_zone: string;
  age_confirmed_at: string | null;
  /** Migration 0002 (trial states). Optional so older databases still read. */
  membership_id?: string | null;
  cancel_at_period_end?: boolean | null;
  trial_ends_at?: string | null;
  first_trial_at?: string | null;
  last_event_at?: string | null;
}

export async function getMember(db: Db, id: string): Promise<MemberRow | null> {
  return (await db.select<MemberRow>('members', { eq: { whop_user_id: id }, limit: 1 }))[0] ?? null;
}

// ── Jobs ────────────────────────────────────────────────────────────────────
export async function startJob(db: Db, job: string): Promise<number> {
  const r = await db.insertReturning<{ id: number }>('job_runs', { job, started_at: new Date().toISOString(), status: 'running' });
  return Number(r.id);
}
export async function finishJob(db: Db, id: number, status: 'ok' | 'error', detail: unknown): Promise<void> {
  await db.update('job_runs', { id }, { finished_at: new Date().toISOString(), status, detail });
}
