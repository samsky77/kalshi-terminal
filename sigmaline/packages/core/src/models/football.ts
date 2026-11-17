import { createRng } from '../rng';
import type { SimSamples } from '../types';

/**
 * NFL / CFB: final margin from a discrete distribution that keeps the key numbers. The base is a
 * normal pmf over integer margins, multiplied by per-number weights estimated from long-run NFL
 * final-margin frequencies (3 ≈ 15%, 7 ≈ 9%, 10, 14, 6, 17, 21 …), then shifted and rescaled
 * so its mean and SD hit the requested μ and σ. CFB uses the square root of the NFL weights
 * (key numbers matter, but less) and no ties.
 *
 * The total is a normal correlated with the size of the margin (blowouts run a little higher),
 * and the two teams' points are rebuilt from (total, margin) with matching parity.
 */
export interface FootballParams {
  sport: 'nfl' | 'cfb';
  /** Expected home margin (home − away). */
  mu: number;
  sigma: number;
  total: number;
  totalSd: number;
  /** Correlation between |margin| (standardised) and total. */
  rho: number;
}

export const FOOTBALL_SHAPE = {
  nfl: { sigma: 13.5, totalSd: 13.5, rho: 0.1 },
  cfb: { sigma: 16, totalSd: 16.5, rho: 0.12 },
} as const;

/** Relative weights by |margin| (NFL); numbers not listed get 1. */
const NFL_KEY: Record<number, number> = {
  0: 0.05, 1: 0.68, 2: 0.6, 3: 2.6, 4: 0.9, 5: 0.65, 6: 1.08, 7: 1.7, 8: 0.76, 9: 0.52, 10: 1.2,
  11: 0.52, 12: 0.55, 13: 0.46, 14: 1.36, 15: 0.42, 16: 0.5, 17: 1.09, 18: 0.56, 19: 0.52, 20: 0.6,
  21: 1.29, 22: 0.6, 23: 0.6, 24: 1.17, 25: 0.6, 26: 0.6, 27: 0.9, 28: 1.1,
};

function keyWeight(sport: 'nfl' | 'cfb', m: number): number {
  const a = Math.abs(m);
  const w = NFL_KEY[a] ?? (a > 28 ? 0.8 : 1);
  if (sport === 'cfb') return a === 0 ? 0 : Math.sqrt(w);
  return w;
}

export interface Pmf { min: number; p: Float64Array }

const pmfCache = new Map<string, Pmf>();

/** Discrete margin pmf with target mean μ and SD σ. */
export function marginPmf(sport: 'nfl' | 'cfb', mu: number, sigma: number): Pmf {
  const key = `${sport}:${mu.toFixed(2)}:${sigma.toFixed(2)}`;
  const hit = pmfCache.get(key);
  if (hit) return hit;
  const min = Math.floor(mu - 6 * sigma), max = Math.ceil(mu + 6 * sigma);
  const len = max - min + 1;
  let m0 = mu, s0 = sigma;
  let p = new Float64Array(len);
  for (let it = 0; it < 40; it++) {
    p = new Float64Array(len);
    let tot = 0;
    for (let i = 0; i < len; i++) {
      const m = min + i;
      const z = (m - m0) / s0;
      p[i] = Math.exp(-0.5 * z * z) * keyWeight(sport, m);
      tot += p[i];
    }
    let mean = 0, sq = 0;
    for (let i = 0; i < len; i++) { p[i] /= tot; mean += p[i] * (min + i); }
    for (let i = 0; i < len; i++) sq += p[i] * (min + i - mean) ** 2;
    const sd = Math.sqrt(sq);
    if (Math.abs(mean - mu) < 1e-4 && Math.abs(sd - sigma) < 1e-4) break;
    m0 += mu - mean;
    s0 *= sigma / sd;
  }
  const out = { min, p };
  if (pmfCache.size > 5000) pmfCache.clear();
  pmfCache.set(key, out);
  return out;
}

function sampleFromCdf(cdf: Float64Array, u: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function simulateFootball(p: FootballParams, n: number, seed: number): SimSamples {
  const rng = createRng(seed);
  const pmf = marginPmf(p.sport, p.mu, p.sigma);
  const cdf = new Float64Array(pmf.p.length);
  let acc = 0;
  let eAbs = 0, eAbs2 = 0;
  for (let i = 0; i < pmf.p.length; i++) {
    acc += pmf.p[i]; cdf[i] = acc;
    const a = Math.abs(pmf.min + i);
    eAbs += pmf.p[i] * a; eAbs2 += pmf.p[i] * a * a;
  }
  const sdAbs = Math.sqrt(Math.max(1e-9, eAbs2 - eAbs * eAbs));
  const k = Math.sqrt(1 - p.rho * p.rho);
  const home = new Int16Array(n), away = new Int16Array(n), winner = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const m = pmf.min + sampleFromCdf(cdf, rng.next() * acc);
    const zAbs = (Math.abs(m) - eAbs) / sdAbs;
    let t = Math.round(p.total + p.totalSd * (p.rho * zAbs + k * rng.normal()));
    t = Math.max(Math.abs(m), t);
    if ((t - m) % 2 !== 0) t += rng.next() < 0.5 ? -1 : 1;
    if (t < Math.abs(m)) t += 2;
    const h = (t + m) / 2, a = (t - m) / 2;
    home[i] = h; away[i] = a; winner[i] = m > 0 ? 1 : m < 0 ? -1 : 0;
  }
  return { n, home, away, winner };
}
