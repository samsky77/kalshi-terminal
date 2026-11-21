/**
 * Item 5: every edge is logged the moment it first appears in the feed (server-side, so no user can
 * influence it), price changes go to a separate table, closing/CLV are filled after the start and
 * result/units after settlement — each exactly once. The database enforces the append-only rules
 * (migration 0002); this module only ever inserts, or fills empty settle-once columns.
 */
import { clv as clvOf, gradeBet, profitUnits, selectionLabel, SPORT_DEFS, type PricedSelection, type Selection } from '@sigmaline/core';
import { getEvents, latestPull, quoteFromSnapshot, type EventRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { selectionConsensus } from './simulate';

export interface EdgeLogRow {
  id?: string;
  edge_key: string;
  first_shown_at: string;
  sport: string;
  league: string;
  event_id: string;
  event_name: string;
  start_time: string;
  market: string;
  selection: string;
  selection_label: string;
  line: number | null;
  player: string | null;
  stat: string | null;
  book: string;
  price_taken: number;
  fair_price: number;
  edge_pct: number;
  grade: 'A' | 'B';
  model_version: string;
  fair_source: string;
  price_ts: string | null;
  closing_price?: number | null;
  closing_p?: number | null;
  clv?: number | null;
  closing_at?: string | null;
  result?: string | null;
  units?: number | null;
  settled_at?: string | null;
}

/** Idempotency key: one row per (event, market, selection, line, book). */
export function edgeKey(eventId: string, p: Pick<PricedSelection, 'selection' | 'key' | 'bestBook'>): string {
  return [eventId, p.selection.market, p.key, p.selection.line ?? '', p.bestBook ?? ''].join('|');
}

export function parseSelection(key: string): Selection {
  const [market, side, line, player, stat] = key.split(':');
  return { market: market as Selection['market'], side: side as Selection['side'], line: line === '' ? undefined : Number(line), player: player || undefined, stat: stat || undefined };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Log graded, fresh edges (rows that passed the feed filter). New keys insert one row (the DB stamps
 * first_shown_at); keys seen before get an edge_price_updates row when their price moved.
 */
export async function logEdges(ctx: Ctx, e: EventRow, modelVersion: string, keep: PricedSelection[]): Promise<{ logged: number; updates: number }> {
  const graded = keep.filter((p) => (p.grade === 'A' || p.grade === 'B') && p.bestBook && p.bestDecimal > 1);
  if (!graded.length || Date.parse(e.commence_time) <= ctx.now().getTime()) return { logged: 0, updates: 0 };
  const now = ctx.now().toISOString();
  const rows: EdgeLogRow[] = graded.map((p) => ({
    id: crypto.randomUUID(), edge_key: edgeKey(e.id, p), first_shown_at: now, sport: e.sport_id, league: e.league_id, event_id: e.id, event_name: `${e.away} @ ${e.home}`,
    start_time: e.commence_time, market: p.selection.market, selection: p.key, selection_label: selectionLabel(p.selection, e.home, e.away),
    line: p.selection.line ?? null, player: p.selection.player ?? null, stat: p.selection.stat ?? null, book: p.bestBook!,
    price_taken: r6(p.bestDecimal), fair_price: r6(p.fairDecimal), edge_pct: r6(p.ev), grade: p.grade as 'A' | 'B', model_version: modelVersion,
    fair_source: p.fairSource, price_ts: p.bestTs,
  }));
  const existing = new Map((await ctx.db.select<EdgeLogRow>('edges_log', { eq: { event_id: e.id } })).map((r) => [r.edge_key, r]));
  const fresh = rows.filter((r) => !existing.has(r.edge_key));
  const logged = fresh.length ? await ctx.db.insertIgnore('edges_log', fresh as unknown as Record<string, unknown>[], 'edge_key') : 0;
  // Price changes on edges already logged.
  const seen = rows.filter((r) => existing.has(r.edge_key));
  let updates = 0;
  if (seen.length) {
    const last = new Map<string, number>();
    for (const u of await ctx.db.select<{ edge_key: string; price: number; seen_at: string }>('edge_price_updates', { in: { edge_key: seen.map((r) => r.edge_key) }, order: [{ col: 'seen_at', asc: true }] })) last.set(u.edge_key, Number(u.price));
    const ups = seen
      .filter((r) => Math.abs((last.get(r.edge_key) ?? Number(existing.get(r.edge_key)!.price_taken)) - r.price_taken) > 1e-9)
      .map((r) => ({ edge_key: r.edge_key, seen_at: now, price: r.price_taken, fair_price: r.fair_price, edge_pct: r.edge_pct, grade: r.grade, price_ts: r.price_ts }));
    if (ups.length) { await ctx.db.insert('edge_price_updates', ups); updates = ups.length; }
  }
  return { logged, updates };
}

/**
 * Closing line + CLV for logged edges whose event has started: uses the closing snapshot, else the
 * latest snapshot taken within 30 min of the start. Leaves the row empty when neither exists
 * (never estimated). CLV = p_close × price_taken − 1 (push-adjusted), via the shared edge function.
 */
export async function closeEdges(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const open = await ctx.db.select<EdgeLogRow>('edges_log', { lt: { start_time: now.toISOString() }, gte: { start_time: new Date(now.getTime() - 2 * 86400000).toISOString() }, isNull: ['closing_at'] });
  if (!open.length) return 0;
  let n = 0;
  const byEvent = new Map<string, EdgeLogRow[]>();
  for (const r of open) { const a = byEvent.get(r.event_id); if (a) a.push(r); else byEvent.set(r.event_id, [r]); }
  for (const [eid, rows] of byEvent) {
    const ev = (await getEvents(ctx.db, { ids: [eid] }))[0];
    if (!ev) continue;
    let pull = await latestPull(ctx.db, eid, 'closing');
    if (!pull.snapshots.length) pull = await latestPull(ctx.db, eid);
    if (!pull.pulledAt || Date.parse(pull.pulledAt) < Date.parse(ev.commence_time) - 30 * 60000) continue;
    const quotes = pull.snapshots.map(quoteFromSnapshot);
    for (const r of rows) {
      const sel = parseSelection(r.selection);
      const c = selectionConsensus(quotes, sel.market, sel.line, sel.side, SPORT_DEFS[ev.sport_id].threeWay, sel.player, sel.stat);
      const target = sel.market === 'spread' && sel.line !== undefined ? (sel.side === 'home' ? sel.line : -sel.line) : sel.line;
      const q = quotes.find((x) => x.book === r.book && x.market === sel.market && (sel.market === 'ml' || x.line === target) && (sel.market !== 'prop' || (x.player === sel.player && x.stat === sel.stat)));
      const closePrice = q ? (q.prices as Record<string, number>)[sel.side] : undefined;
      const mp = (await ctx.db.select<{ model_probs: { push: number } }>('market_prices', { eq: { event_id: eid, selection_key: r.selection }, limit: 1 }))[0];
      const push = Number(mp?.model_probs?.push ?? 0) || 0;
      const patch: Record<string, unknown> = { closing_at: pull.pulledAt };
      if (closePrice && closePrice > 1) patch.closing_price = r6(closePrice);
      if (c) { patch.closing_p = r6(c.p); patch.clv = r6(clvOf(Number(r.price_taken), c.p, push)); }
      try { await ctx.db.update('edges_log', { edge_key: r.edge_key }, patch); n++; } catch (err) { ctx.log(`closeEdges ${r.edge_key}: ${(err as Error).message}`); }
    }
  }
  return n;
}

/** Result and units (1-unit flat stake) for logged edges whose event is final, void or postponed. */
export async function settleEdges(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const open = await ctx.db.select<EdgeLogRow>('edges_log', { lt: { start_time: now.toISOString() }, isNull: ['result'] });
  if (!open.length) return 0;
  const events = new Map((await getEvents(ctx.db, { ids: [...new Set(open.map((r) => r.event_id))] })).map((e) => [e.id, e]));
  let n = 0;
  for (const r of open) {
    const e = events.get(r.event_id);
    if (!e) continue;
    const sel = parseSelection(r.selection);
    let result: ReturnType<typeof gradeBet>;
    if (e.status === 'void' || e.status === 'postponed') result = 'void';
    else if (e.status !== 'final') continue;
    else {
      let props: Record<string, number> | undefined;
      if (sel.market === 'prop' && sel.player && sel.stat) {
        const log = (await ctx.db.select<{ value: number }>('player_logs', { eq: { sport: e.sport_id, player: sel.player, stat: sel.stat }, in: { game_date: gameDates(e) }, limit: 1 }))[0];
        if (!log) {
          if (now.getTime() - Date.parse(e.final_at ?? e.commence_time) < 24 * 3600000) continue;
          props = {};
        } else props = { [`${sel.player}|${sel.stat}`]: Number(log.value) };
      }
      result = gradeBet(sel, e.sport_id, { home: Number(e.home_score), away: Number(e.away_score), winner: (e.winner ?? undefined) as 1 | -1 | 0 | undefined, props });
    }
    try {
      await ctx.db.update('edges_log', { edge_key: r.edge_key }, { result, units: r6(profitUnits(result, 1, Number(r.price_taken))), settled_at: now.toISOString() });
      n++;
    } catch (err) { ctx.log(`settleEdges ${r.edge_key}: ${(err as Error).message}`); }
  }
  return n;
}

/**
 * Dates a player's box score for this game may be stored under: player_logs.game_date is the UTC date
 * of the provider's commence time, but a 7:30 PM ET tip-off is 00:30 UTC the next day, so the US
 * Eastern date is accepted too (BASELINE B18).
 */
export function gameDates(e: Pick<EventRow, 'commence_time'>): string[] {
  const utc = e.commence_time.slice(0, 10);
  const et = new Date(e.commence_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return [...new Set([utc, et])];
}
