/**
 * Feed cache (item 2). The worker builds these payloads once per tick and stores them in
 * `feed_cache`; the app reads one small row per request instead of thousands of market_prices rows.
 * The same builder runs in the app as a fallback (demo / cold cache), so both always agree.
 */
import { GRADE_CONFIG, isStale, selectionLabel, type Grade, type OutcomeProbs, type Selection, type SportId } from '@sigmaline/core';
import type { Db } from './db';
import { getEvents, type EventRow } from './repo';

export interface FeedPrice {
  event_id: string;
  selection_key: string;
  market: Selection['market'];
  selection: Selection;
  label: string;
  line: number | null;
  fair_decimal: number | null;
  fair_probs: OutcomeProbs;
  consensus_p: number | null;
  best_decimal: number | null;
  best_book: string | null;
  books: number;
  ev: number | null;
  model_ev: number | null;
  consensus_ev: number | null;
  grade: Grade;
  /** Best book's own last_update (provider time). */
  price_ts: string | null;
  fair_source: 'blend' | 'consensus';
}

export interface FeedEvent { id: string; sport: SportId; league: string; home: string; away: string; commence_time: string; label: string }

export interface SlateRow {
  event: FeedEvent;
  top: FeedPrice | null;
  main: FeedPrice | null;
  published: boolean;
  started: boolean;
  props: number;
}

export interface SlatePayload { sport: SportId; builtAt: string; rows: SlateRow[]; asOf: string | null; providers: string[]; filtered: number }
export interface EdgeRow extends FeedPrice { event: FeedEvent }
export interface EdgesPayload { builtAt: string; rows: EdgeRow[] }
export interface PropsPayload { sport: SportId; builtAt: string; rows: EdgeRow[]; events: number }

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export function normPrice(r: any, home: string, away: string): FeedPrice {
  const sel = r.selection as Selection;
  return {
    event_id: r.event_id, selection_key: r.selection_key, market: r.market, selection: sel, label: selectionLabel(sel, home, away), line: num(r.line),
    fair_decimal: num(r.fair_decimal), fair_probs: r.fair_probs, consensus_p: num(r.consensus_p), best_decimal: num(r.best_decimal), best_book: r.best_book ?? null,
    books: Number(r.books), ev: num(r.ev), model_ev: num(r.model_ev), consensus_ev: num(r.consensus_ev),
    // A consensus-only price has no model to agree with, so it can't be an A (SHP-001 / DAT-006).
    grade: r.grade === 'A' && r.fair_source === 'consensus' ? 'none' : r.grade,
    price_ts: r.price_ts ?? r.snapshot_ts ?? null, fair_source: r.fair_source === 'consensus' ? 'consensus' : 'blend',
  };
}

export function shortTeam(team: string): string {
  const w = team.split(' ');
  return w.length > 1 ? w[w.length - 1] : team;
}

export function feedEvent(e: EventRow): FeedEvent {
  // College nicknames don't abbreviate to their last word ("Red Storm" -> "Storm"), so colleges use full names.
  const full = e.sport_id === 'soccer' || e.sport_id === 'tennis' || e.sport_id === 'cbb' || e.sport_id === 'cfb';
  return { id: e.id, sport: e.sport_id, league: e.league_id, home: e.home, away: e.away, commence_time: e.commence_time, label: full ? `${e.away} @ ${e.home}` : `${shortTeam(e.away)} @ ${shortTeam(e.home)}` };
}

/** A row may carry an edge right now: graded, priced, fresh and its event not started. */
export function isLiveEdge(p: FeedPrice, commence: string, nowMs: number, staleMin: number = GRADE_CONFIG.staleMinutes): boolean {
  return p.grade !== 'none' && p.ev !== null && p.best_decimal !== null && Date.parse(commence) > nowMs && !isStale(p.price_ts, nowMs, staleMin);
}

/** 23:59:59 tomorrow in America/New_York, as an absolute time. */
export function endOfTomorrowET(now: Date): Date {
  const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Walk forward in hours until the ET date is two days ahead; the hour before is tomorrow's last.
  const today = ymd(now);
  let t = new Date(now.getTime());
  let days = 0, last = today;
  while (days < 2) { t = new Date(t.getTime() + 3600000); const d = ymd(t); if (d !== last) { days++; last = d; } }
  // t is within the first hour of the day after tomorrow (ET): step back to that day's ET midnight.
  while (ymd(new Date(t.getTime() - 60000)) === last) t = new Date(t.getTime() - 60000);
  return new Date(t.getTime() - 1000);
}

async function windowEvents(db: Db, sport: SportId | null, now: Date): Promise<EventRow[]> {
  const end = endOfTomorrowET(now); // through tomorrow night, US Eastern (DAT-004)
  return (await getEvents(db, { ...(sport ? { sport } : {}), from: now.toISOString(), to: end.toISOString() }))
    .filter((e) => e.source === 'live' && e.status === 'scheduled');
}

async function pricesFor(db: Db, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...await db.select<any>('market_prices', { in: { event_id: ids.slice(i, i + 200) } }));
  return out;
}

/** Main line to display when there is no edge: deepest home spread, else the deepest moneyline. */
function mainPrice(ps: FeedPrice[]): FeedPrice | null {
  const sp = ps.filter((p) => p.market === 'spread' && p.selection.side === 'home' && p.best_decimal);
  if (sp.length) return [...sp].sort((a, b) => b.books - a.books)[0];
  const ml = ps.filter((p) => p.market === 'ml' && p.best_decimal);
  return [...ml].sort((a, b) => b.books - a.books)[0] ?? null;
}

/** Slate for one sport: upcoming games only (started games have no valid pre-game price). */
export async function buildSlate(db: Db, sport: SportId, now = new Date(), staleMin: number = GRADE_CONFIG.staleMinutes): Promise<SlatePayload> {
  const evs = await windowEvents(db, sport, now);
  const ids = evs.map((e) => e.id);
  const raw = ids.length ? await pricesFor(db, ids) : [];
  const picks = ids.length ? await db.select<{ event_id: string }>('picks', { in: { event_id: ids }, columns: 'event_id' }) : [];
  const runs = ids.length ? await db.select<{ inputs: { snapshot?: { providers?: string[] } } }>('sim_runs', { in: { event_id: ids.slice(0, 40) }, order: [{ col: 'created_at', asc: false }], limit: 40, columns: 'inputs' }) : [];
  const providers = [...new Set(runs.flatMap((r) => r.inputs?.snapshot?.providers ?? []))];
  const nowMs = now.getTime();
  let asOf: string | null = null, filtered = 0;
  const rows: SlateRow[] = evs.map((e) => {
    const all = raw.filter((p) => p.event_id === e.id).map((r) => normPrice(r, e.home, e.away));
    const ps = all.filter((p) => p.market !== 'prop');
    const live = ps.filter((p) => isLiveEdge(p, e.commence_time, nowMs, staleMin)).sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
    filtered += ps.filter((p) => p.grade !== 'none' && !isLiveEdge(p, e.commence_time, nowMs, staleMin)).length;
    for (const p of ps) if (p.price_ts && (!asOf || p.price_ts > asOf)) asOf = p.price_ts;
    return {
      event: feedEvent(e), top: live[0] ?? null, main: live[0] ?? mainPrice(ps), published: picks.some((p) => p.event_id === e.id),
      started: Date.parse(e.commence_time) <= nowMs, props: all.length - ps.length,
    };
  });
  rows.sort((a, b) => (b.top?.ev ?? -1) - (a.top?.ev ?? -1) || a.event.commence_time.localeCompare(b.event.commence_time));
  return { sport, builtAt: now.toISOString(), rows, asOf, providers, filtered };
}

/** Every live edge across all sports (game lines and props), best first. */
export async function buildEdges(db: Db, now = new Date(), staleMin: number = GRADE_CONFIG.staleMinutes): Promise<EdgesPayload> {
  const evs = await windowEvents(db, null, now);
  const byId = new Map(evs.map((e) => [e.id, e]));
  const raw = evs.length ? await pricesFor(db, evs.map((e) => e.id)) : [];
  const nowMs = now.getTime();
  const rows: EdgeRow[] = [];
  for (const r of raw) {
    if (r.grade === 'none') continue;
    const e = byId.get(r.event_id)!;
    const p = normPrice(r, e.home, e.away);
    if (isLiveEdge(p, e.commence_time, nowMs, staleMin)) rows.push({ ...p, event: feedEvent(e) });
  }
  rows.sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
  return { builtAt: now.toISOString(), rows };
}

/**
 * Props board for one sport: for each player and stat, the deepest line (most books), both sides.
 * Includes ungraded and stale rows so the Props tab shows every market the provider returned.
 */
export async function buildProps(db: Db, sport: SportId, now = new Date()): Promise<PropsPayload> {
  const evs = await windowEvents(db, sport, now);
  const byId = new Map(evs.map((e) => [e.id, e]));
  const raw = evs.length ? (await pricesFor(db, evs.map((e) => e.id))).filter((r) => r.market === 'prop') : [];
  const deepest = new Map<string, number>();
  const k = (r: any) => `${r.event_id}|${r.selection?.player}|${r.selection?.stat}`;
  for (const r of raw) deepest.set(k(r), Math.max(deepest.get(k(r)) ?? 0, Number(r.books)));
  const rows: EdgeRow[] = [];
  const seenLine = new Map<string, number | null>();
  for (const r of raw.sort((a, b) => Number(b.books) - Number(a.books))) {
    if (Number(r.books) < (deepest.get(k(r)) ?? 0)) continue;
    // one line per player/stat (both sides of it)
    const line = num(r.line);
    if (seenLine.has(k(r)) && seenLine.get(k(r)) !== line) continue;
    seenLine.set(k(r), line);
    const e = byId.get(r.event_id)!;
    rows.push({ ...normPrice(r, e.home, e.away), event: feedEvent(e) });
  }
  rows.sort((a, b) => a.event.commence_time.localeCompare(b.event.commence_time) || (a.selection.player ?? '').localeCompare(b.selection.player ?? '') || (a.selection.stat ?? '').localeCompare(b.selection.stat ?? '') || a.selection.side.localeCompare(b.selection.side));
  return { sport, builtAt: now.toISOString(), rows, events: new Set(raw.map((r) => r.event_id)).size };
}

export const FEED_KEYS = {
  slate: (s: SportId) => `slate:${s}`,
  props: (s: SportId) => `props:${s}`,
  edges: 'edges',
};

/** Cached payload if it is fresher than maxAgeMs, else null. */
export async function readFeed<T>(db: Db, key: string, maxAgeMs: number, now = Date.now()): Promise<T | null> {
  try {
    const r = (await db.select<{ payload: T; built_at: string }>('feed_cache', { eq: { key }, limit: 1 }))[0];
    if (!r || now - Date.parse(r.built_at) > maxAgeMs) return null;
    return r.payload;
  } catch {
    return null; // table missing (migration not applied yet): fall back to a live build
  }
}

export async function writeFeed(db: Db, key: string, payload: unknown, now = new Date()): Promise<void> {
  await db.upsert('feed_cache', { key, payload, built_at: now.toISOString() }, 'key');
}



// ── Edge Finder filters (item 4) ────────────────────────────────────────────
export interface EdgeFilters {
  sport?: SportId | 'all';
  type?: 'all' | 'game' | 'prop';
  book?: string | 'all';
  /** Minimum edge as a fraction (0.03 = 3%). */
  minEdge?: number;
  grade?: 'all' | 'A' | 'B';
  sort?: 'edge' | 'start' | 'updated';
}

/** Parse Edge Finder query params; anything unknown falls back to "all" / defaults. */
export function parseEdgeFilters(q: Record<string, string | undefined>, sports: readonly string[]): Required<EdgeFilters> {
  const min = Number(q.min);
  return {
    sport: (sports.includes(q.sport ?? '') ? q.sport : 'all') as SportId | 'all',
    type: q.type === 'game' || q.type === 'prop' ? q.type : 'all',
    book: q.book && /^[a-z0-9_]{1,40}$/.test(q.book) ? q.book : 'all',
    minEdge: Number.isFinite(min) && min > 0 && min <= 25 ? min / 100 : 0,
    grade: q.grade === 'A' || q.grade === 'B' ? q.grade : 'all',
    sort: q.sort === 'start' || q.sort === 'updated' ? q.sort : 'edge',
  };
}

export function applyEdgeFilters(rows: EdgeRow[], f: EdgeFilters): EdgeRow[] {
  const out = rows.filter((r) =>
    (!f.sport || f.sport === 'all' || r.event.sport === f.sport) &&
    (!f.type || f.type === 'all' || (f.type === 'prop' ? r.market === 'prop' : r.market !== 'prop')) &&
    (!f.book || f.book === 'all' || r.best_book === f.book) &&
    (r.ev ?? -1) >= (f.minEdge ?? 0) &&
    (!f.grade || f.grade === 'all' || r.grade === f.grade));
  const by: Record<string, (a: EdgeRow, b: EdgeRow) => number> = {
    edge: (a, b) => (b.ev ?? 0) - (a.ev ?? 0),
    start: (a, b) => a.event.commence_time.localeCompare(b.event.commence_time) || (b.ev ?? 0) - (a.ev ?? 0),
    updated: (a, b) => (b.price_ts ?? '').localeCompare(a.price_ts ?? '') || (b.ev ?? 0) - (a.ev ?? 0),
  };
  return out.sort(by[f.sort ?? 'edge']);
}
