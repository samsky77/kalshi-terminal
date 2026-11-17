/** Track-record aggregation (spec §8). Live record only — backtests live in backtest_runs. */
import type { PickResultRow, PickRow } from './repo';

export interface RecordRow extends PickRow { result?: PickResultRow }

export interface RecordStats {
  bets: number;
  graded: number;
  pending: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  staked: number;
  roi: number;
  avgClv: number | null;
  clvBets: number;
  from: string | null;
  to: string | null;
}

export function windowStart(window: '7' | '30' | '90' | 'all', now = new Date()): string | null {
  if (window === 'all') return null;
  return new Date(now.getTime() - Number(window) * 86400000).toISOString();
}

export function aggregate(rows: RecordRow[]): RecordStats {
  let units = 0, staked = 0, wins = 0, losses = 0, pushes = 0, graded = 0, clvSum = 0, clvN = 0;
  for (const r of rows) {
    const res = r.result;
    if (res) {
      graded++;
      const pu = Number(res.profit_units);
      if (res.result !== 'void') { units += pu; staked += Number(r.stake_units); }
      if (res.result === 'win' || res.result === 'half_win') wins++;
      else if (res.result === 'loss' || res.result === 'half_loss') losses++;
      else pushes++;
      if (res.clv !== null && res.clv !== undefined) { clvSum += Number(res.clv); clvN++; }
    }
  }
  const dates = rows.map((r) => r.commence_time).sort();
  return {
    bets: rows.length, graded, pending: rows.length - graded, wins, losses, pushes,
    units: Math.round(units * 100) / 100, staked, roi: staked ? units / staked : 0,
    avgClv: clvN ? clvSum / clvN : null, clvBets: clvN, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
  };
}

/** Cumulative units by grading order (one point per graded bet). */
export function cumulativeCurve(rows: RecordRow[]): { t: string; units: number }[] {
  const g = rows.filter((r) => r.result).sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  let u = 0;
  return g.map((r) => { u += Number(r.result!.profit_units); return { t: r.commence_time, units: Math.round(u * 100) / 100 }; });
}

export function breakdown(rows: RecordRow[], key: 'sport' | 'market'): { key: string; stats: RecordStats }[] {
  const m = new Map<string, RecordRow[]>();
  for (const r of rows) { const k = String(r[key]); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return [...m.entries()].map(([k, rs]) => ({ key: k, stats: aggregate(rs) })).sort((a, b) => b.stats.bets - a.stats.bets);
}

/** Public visitors only see picks whose game has started (spec §8). */
export function publicVisible(rows: PickRow[], now = new Date()): PickRow[] {
  return rows.filter((r) => Date.parse(r.commence_time) <= now.getTime());
}

export function toCsv(rows: RecordRow[]): string {
  const head = ['seq', 'logged_at', 'sport', 'game', 'start', 'market', 'selection', 'book', 'price_taken', 'closing_price', 'fair', 'ev', 'grade', 'stake_u', 'result', 'profit_u', 'clv', 'hash'];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => [
    r.seq, r.created_at, r.sport, r.event_name, r.commence_time, r.market, r.label, r.book, r.price_decimal,
    r.result?.closing_decimal ?? '', r.fair_decimal, r.ev, r.grade, r.stake_units, r.result?.result ?? 'pending',
    r.result?.profit_units ?? '', r.result?.clv ?? '', r.hash,
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}
