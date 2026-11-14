import { median } from './stats';
import type { Consensus, OddsEvent, OddsOutcome } from './types';

/** Decimal odds -> raw implied probability (includes vig). */
export function impliedFromDecimal(decimal: number): number {
  return decimal > 1 ? 1 / decimal : NaN;
}

/** American odds -> decimal odds. */
export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/**
 * Remove the vig from a set of mutually exclusive prices by proportional normalization
 * (the "multiplicative" method): p_i = q_i / sum(q). Works for two-way and three-way markets.
 */
export function removeVig(decimals: number[]): number[] {
  const q = decimals.map(impliedFromDecimal); // NaN for prices <= 1.0 (suspended / settled quotes)
  if (q.some((x) => !Number.isFinite(x))) return decimals.map(() => NaN);
  const s = q.reduce((a, b) => a + b, 0);
  return q.map((x) => x / s);
}

/** Bookmaker overround (sum of implied probabilities minus 1). */
export function overround(decimals: number[]): number {
  return decimals.map(impliedFromDecimal).reduce((a, b) => a + b, 0) - 1;
}

function isQuarterLine(x: number): boolean {
  const f = Math.abs(x * 4) % 2; // .25 / .75 lines are Asian splits
  return Math.abs(f - 1) < 1e-9;
}

/** Most common line; ties broken toward the median line, then toward a .5 line. */
export function modeLine(lines: number[]): number | undefined {
  if (!lines.length) return undefined;
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, c]) => c === max).map(([l]) => l);
  const med = median(lines);
  top.sort((a, b) => Math.abs(a - med) - Math.abs(b - med) || (Math.abs(a % 1) === 0.5 ? -1 : 1));
  return top[0];
}

/**
 * Step 1 of the pipeline: per-book no-vig probabilities, then the median across books for the
 * moneyline, the main (modal) spread and the main (modal) total.
 */
export function buildConsensus(ev: OddsEvent, threeWay: boolean): Consensus | null {
  const pH: number[] = [], pA: number[] = [], pD: number[] = [];
  const spreadByBook: { line: number; p: number }[] = [];
  const totalByBook: { line: number; p: number }[] = [];
  const books = new Set<string>();
  let last = '';

  for (const bk of ev.bookmakers ?? []) {
    let used = false;
    for (const m of bk.markets ?? []) {
      const find = (n: string): OddsOutcome | undefined => m.outcomes.find((o) => o.name === n);
      if (m.key === 'h2h') {
        const h = find(ev.home_team), a = find(ev.away_team), d = find('Draw');
        if (!h || !a) continue;
        if (threeWay) {
          if (!d) continue;
          const [ph, pa, pd] = removeVig([h.price, a.price, d.price]);
          if (!Number.isFinite(ph)) continue;
          pH.push(ph); pA.push(pa); pD.push(pd);
        } else {
          if (d) continue; // a 3-way price in a 2-way sport would distort the median
          const [ph, pa] = removeVig([h.price, a.price]);
          if (!Number.isFinite(ph)) continue;
          pH.push(ph); pA.push(pa);
        }
        used = true;
      } else if (m.key === 'spreads') {
        const h = find(ev.home_team), a = find(ev.away_team);
        if (!h || !a || h.point === undefined || a.point === undefined) continue;
        if (Math.abs(h.point + a.point) > 1e-9 || isQuarterLine(h.point)) continue;
        const [ph] = removeVig([h.price, a.price]);
        if (!Number.isFinite(ph)) continue;
        spreadByBook.push({ line: h.point, p: ph });
        used = true;
      } else if (m.key === 'totals') {
        const o = find('Over'), u = find('Under');
        if (!o || !u || o.point === undefined || o.point !== u.point || isQuarterLine(o.point)) continue;
        const [po] = removeVig([o.price, u.price]);
        if (!Number.isFinite(po)) continue;
        totalByBook.push({ line: o.point, p: po });
        used = true;
      }
    }
    if (used) {
      books.add(bk.key);
      if (bk.last_update > last) last = bk.last_update;
    }
  }
  if (!pH.length) return null;

  let ph = median(pH), pa = median(pA), pd = threeWay ? median(pD) : undefined;
  const s = ph + pa + (pd ?? 0);
  ph /= s; pa /= s; if (pd !== undefined) pd /= s;

  const c: Consensus = {
    pHome: ph,
    pAway: pa,
    pDraw: pd,
    books: [...books].sort(),
    booksMl: pH.length,
    booksSpread: 0,
    booksTotal: 0,
    lastUpdate: last,
  };
  const sl = modeLine(spreadByBook.map((x) => x.line));
  if (sl !== undefined) {
    const at = spreadByBook.filter((x) => x.line === sl);
    c.spreadLine = sl;
    c.pHomeCover = median(at.map((x) => x.p));
    c.booksSpread = at.length;
  }
  const tl = modeLine(totalByBook.map((x) => x.line));
  if (tl !== undefined) {
    const at = totalByBook.filter((x) => x.line === tl);
    c.totalLine = tl;
    c.pOver = median(at.map((x) => x.p));
    c.booksTotal = at.length;
  }
  return c;
}
