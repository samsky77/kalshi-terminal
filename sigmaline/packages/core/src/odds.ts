/** Odds conversions, vig removal and the market consensus (spec §4.2). */

export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0 || Math.abs(american) < 100) return NaN;
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/** Decimal -> American, rounded to the nearest integer (e.g. 1.909 -> -110). */
export function decimalToAmerican(decimal: number): number {
  if (!(decimal > 1)) return NaN;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function formatAmerican(decimal: number): string {
  const a = decimalToAmerican(decimal);
  if (!Number.isFinite(a)) return '—';
  return a > 0 ? `+${a}` : `−${Math.abs(a)}`;
}

/** Fair probability -> fair decimal price. */
export function probToDecimal(p: number): number {
  return p > 0 && p < 1 ? 1 / p : NaN;
}

export function impliedProb(decimal: number): number {
  return decimal > 1 ? 1 / decimal : NaN;
}

/** Bookmaker margin: sum of implied probabilities minus 1. */
export function overround(decimals: number[]): number {
  return decimals.reduce((s, d) => s + impliedProb(d), 0) - 1;
}

/**
 * Multiplicative (proportional) vig removal: p_i = q_i / Σq.
 * Used for two-way markets. Returns NaNs if any price is invalid.
 */
export function noVigMultiplicative(decimals: number[]): number[] {
  const q = decimals.map(impliedProb);
  if (q.some((x) => !Number.isFinite(x))) return decimals.map(() => NaN);
  const s = q.reduce((a, b) => a + b, 0);
  return q.map((x) => x / s);
}

/**
 * Power method: find k so that Σ q_i^k = 1, then p_i = q_i^k. Used for 3-way markets because it
 * removes more margin from longshots (the draw / underdog), which is where books load it.
 */
export function noVigPower(decimals: number[]): number[] {
  const q = decimals.map(impliedProb);
  if (q.some((x) => !Number.isFinite(x) || x >= 1)) return decimals.map(() => NaN);
  const f = (k: number) => q.reduce((s, x) => s + Math.pow(x, k), 0) - 1;
  // Σq > 1 with vig, so k > 1. f is decreasing in k for 0<q<1.
  let lo = 0.5, hi = 5;
  if (f(lo) < 0) lo = 0.01;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const p = q.map((x) => Math.pow(x, k));
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / s);
}

/**
 * Vig removal for consensus: the power method for every market. Proportional removal leaves the
 * favourite-longshot bias in (books load margin onto the longshot), so de-vigged longshots read too
 * likely and the best longshot price at any book looks like value; live, that produced a slate of
 * +400…+1400 "edges" on tennis underdogs and alternate lines. For even prices the two agree.
 */
export function noVig(decimals: number[]): number[] {
  return noVigPower(decimals);
}

/** Weighted median: smallest value whose cumulative weight reaches half the total. */
export function weightedMedian(values: { v: number; w: number }[]): number {
  const xs = values.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((a, b) => a.v - b.v);
  if (!xs.length) return NaN;
  const total = xs.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i].w;
    if (acc > total / 2 + 1e-12) return xs[i].v;
    if (Math.abs(acc - total / 2) <= 1e-12) return (xs[i].v + xs[i + 1].v) / 2;
  }
  return xs[xs.length - 1].v;
}

export const SHARP_BOOKS = new Set(['pinnacle']);

export interface BookQuote {
  book: string;
  /** Decimal prices for each outcome, in the same outcome order for every book. */
  prices: number[];
}

export interface Consensus {
  /** Median no-vig probability per outcome, renormalised to sum to 1. */
  probs: number[];
  books: number;
  hasPinnacle: boolean;
}

/**
 * Market consensus: de-vig every book, take the weighted median per outcome (Pinnacle weight 2),
 * then renormalise so the outcome probabilities sum to 1.
 */
export function consensus(quotes: BookQuote[]): Consensus | null {
  const rows = quotes
    .map((q) => ({ book: q.book, p: noVig(q.prices) }))
    .filter((r) => r.p.every((x) => Number.isFinite(x)));
  if (!rows.length) return null;
  const n = rows[0].p.length;
  const med: number[] = [];
  for (let i = 0; i < n; i++) {
    med.push(weightedMedian(rows.map((r) => ({ v: r.p[i], w: SHARP_BOOKS.has(r.book) ? 2 : 1 }))));
  }
  const s = med.reduce((a, b) => a + b, 0);
  return {
    probs: med.map((x) => x / s),
    books: rows.length,
    hasPinnacle: rows.some((r) => SHARP_BOOKS.has(r.book)),
  };
}
