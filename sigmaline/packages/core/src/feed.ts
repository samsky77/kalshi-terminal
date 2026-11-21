/**
 * The feed filter (item 8): decides which priced rows may appear in the edge feed, be graded and be
 * logged. Every dropped row is counted by reason so data loss is visible, and implausible edges are
 * returned separately so the worker can write them to `data_anomalies`.
 *
 *  - no_price   no bettable best price
 *  - no_fair    no fair price (no consensus and no model)
 *  - started    the event has started (live betting is not supported)
 *  - duplicate  the same selection appeared twice (two providers quoting one book/line)
 *  - suspended  outcomes the provider flags suspended / zero-limit, or with no usable price
 *               (counted at ingest by quotesFromEvent, see oddsformat.ts)
 *  - sanity     |edge| above GRADE_CONFIG.sanityCap: bad data, logged as an anomaly
 *  - stale      best book's own last_update older than GRADE_CONFIG.staleMinutes
 *
 * Stale rows are kept on the price board (dimmed, STALE, ungraded) but never reach the edge feed;
 * all other reasons hide the row entirely.
 */
import { GRADE_CONFIG } from './grades';
import type { PricedSelection } from './pricing';

export type DropReason = 'no_price' | 'no_fair' | 'started' | 'duplicate' | 'suspended' | 'sanity' | 'stale';
export const DROP_REASONS: DropReason[] = ['no_price', 'no_fair', 'started', 'duplicate', 'suspended', 'sanity', 'stale'];

export interface FeedFilterResult {
  /** Fresh, well-formed rows: may be graded, shown in the edge feed and logged. */
  keep: PricedSelection[];
  /** Stale rows: shown on the price board as STALE with no grade. */
  stale: PricedSelection[];
  /** |edge| over the sanity cap: hidden, written to data_anomalies. */
  anomalies: PricedSelection[];
  counts: Record<DropReason, number>;
}

/** Minutes since a provider timestamp (Infinity when unknown). */
export function ageMinutes(ts: string | null | undefined, nowMs: number): number {
  if (!ts) return Infinity;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 60000) : Infinity;
}

export function isStale(ts: string | null | undefined, nowMs: number, staleMinutes: number = GRADE_CONFIG.staleMinutes): boolean {
  return ageMinutes(ts, nowMs) > staleMinutes;
}

export function filterFeed(
  rows: PricedSelection[],
  opt: { nowMs: number; commenceMs: number; liveSupported?: boolean; staleMinutes?: number },
): FeedFilterResult {
  const counts = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;
  const keep: PricedSelection[] = [], stale: PricedSelection[] = [], anomalies: PricedSelection[] = [];
  const seen = new Set<string>();
  const started = !opt.liveSupported && opt.commenceMs <= opt.nowMs;
  for (const r of rows) {
    if (started) { counts.started++; continue; }
    if (seen.has(r.key)) { counts.duplicate++; continue; }
    seen.add(r.key);
    if (!r.bestBook || !(r.bestDecimal > 1)) { counts.no_price++; continue; }
    if (!(r.fairDecimal > 1) || !Number.isFinite(r.ev)) { counts.no_fair++; continue; }
    if (Math.abs(r.ev) > GRADE_CONFIG.sanityCap) { counts.sanity++; anomalies.push(r); continue; }
    if (isStale(r.bestTs ?? r.snapshotTs, opt.nowMs, opt.staleMinutes)) { counts.stale++; stale.push({ ...r, grade: 'none' }); continue; }
    keep.push(r);
  }
  return { keep, stale, anomalies, counts };
}

export function addCounts(a: Record<DropReason, number>, b: Record<DropReason, number>): Record<DropReason, number> {
  const out = { ...a };
  for (const k of DROP_REASONS) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}
