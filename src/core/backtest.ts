// Automatic backtest: turn the on-device snapshot dataset into "picks" (what the Value tab would have shown),
// grade them against Kalshi settlements, and summarize. Pure functions, no I/O.
import { VALUE_MIN_EDGE } from './sports';
import type { Sport } from './types';

export interface SnapRecord {
  sport: Sport;
  savedAt: string;
  games: {
    gameId: string;
    title: string;
    startTime: string;
    contracts: { t: string; k: string; tier: string; p: number; ya: number | null; na: number | null; ys: number; ns: number; ye: number | null; ne: number | null }[];
  }[];
}

export interface Pick {
  key: string; // ticker|side
  ticker: string;
  side: 'yes' | 'no';
  sport: Sport;
  kind: string;
  tier: string;
  title: string;
  startTime: string;
  seenAt: string;
  prob: number; // simulated probability that THIS side wins
  ask: number;
  fee: number;
  edge: number;
}

export type Settlements = Record<string, 'yes' | 'no'>;

/** One pick per (ticker, side): the last snapshot taken before the game started in which that side was a value bet. */
export function buildPicks(records: SnapRecord[]): Pick[] {
  const best = new Map<string, Pick>();
  for (const r of records) {
    for (const g of r.games) {
      if (Date.parse(r.savedAt) >= Date.parse(g.startTime)) continue; // no hindsight: only prices seen before the start
      for (const c of g.contracts) {
        for (const side of ['yes', 'no'] as const) {
          const ask = side === 'yes' ? c.ya : c.na;
          const edge = side === 'yes' ? c.ye : c.ne;
          const size = side === 'yes' ? c.ys : c.ns;
          if (ask === null || edge === null || ask <= 0 || ask >= 1 || size <= 0 || edge < VALUE_MIN_EDGE - 1e-9) continue;
          const prob = side === 'yes' ? c.p : 1 - c.p;
          const key = `${c.t}|${side}`;
          const prev = best.get(key);
          if (prev && Date.parse(prev.seenAt) > Date.parse(r.savedAt)) continue;
          best.set(key, {
            key, ticker: c.t, side, sport: r.sport, kind: c.k, tier: c.tier, title: g.title, startTime: g.startTime,
            seenAt: r.savedAt, prob, ask, fee: Math.max(0, prob - ask - edge), edge,
          });
        }
      }
    }
  }
  return [...best.values()];
}

/** Picks whose games should be over by now and have no settlement yet. */
export function unsettledTickers(picks: Pick[], settled: Settlements, now = Date.now()): string[] {
  const out = new Set<string>();
  for (const p of picks) if (!(p.ticker in settled) && Date.parse(p.startTime) + 3 * 3600e3 < now) out.add(p.ticker);
  return [...out];
}

export interface Bucket { n: number; wins: number; staked: number; pnl: number; avgProb: number; avgEdge: number }
export interface BacktestSummary {
  total: Bucket;
  pending: number;
  bySport: Record<string, Bucket>;
  byKind: Record<string, Bucket>;
  byTier: Record<string, Bucket>;
  recent: { pick: Pick; won: boolean; pnl: number }[];
}

const empty = (): Bucket => ({ n: 0, wins: 0, staked: 0, pnl: 0, avgProb: 0, avgEdge: 0 });
function add(b: Bucket, p: Pick, won: boolean) {
  const cost = p.ask + p.fee;
  b.n++; if (won) b.wins++;
  b.staked += cost;
  b.pnl += (won ? 1 : 0) - cost;
  b.avgProb += p.prob; b.avgEdge += p.edge;
}
const finish = (b: Bucket) => { if (b.n) { b.avgProb /= b.n; b.avgEdge /= b.n; } return b; };

/** Grade picks at 1 contract each, at the ask plus fee that was shown. */
export function summarize(picks: Pick[], settled: Settlements): BacktestSummary {
  const s: BacktestSummary = { total: empty(), pending: 0, bySport: {}, byKind: {}, byTier: {}, recent: [] };
  const graded: { pick: Pick; won: boolean; pnl: number }[] = [];
  for (const p of picks) {
    const res = settled[p.ticker];
    if (!res) { s.pending++; continue; }
    const won = res === p.side;
    add(s.total, p, won);
    add((s.bySport[p.sport] ??= empty()), p, won);
    add((s.byKind[p.kind] ??= empty()), p, won);
    add((s.byTier[p.tier] ??= empty()), p, won);
    graded.push({ pick: p, won, pnl: (won ? 1 : 0) - p.ask - p.fee });
  }
  for (const b of [s.total, ...Object.values(s.bySport), ...Object.values(s.byKind), ...Object.values(s.byTier)]) finish(b);
  s.recent = graded.sort((a, b) => Date.parse(b.pick.startTime) - Date.parse(a.pick.startTime)).slice(0, 25);
  return s;
}
