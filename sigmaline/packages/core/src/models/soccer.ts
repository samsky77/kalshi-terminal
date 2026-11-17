import { createRng } from '../rng';
import type { SimSamples } from '../types';

/**
 * Soccer: Dixon–Coles adjusted Poisson. Goals are Poisson(λ) and Poisson(μ) with the low-score
 * correction τ (0-0, 1-0, 0-1, 1-1) controlled by ρ (negative ρ adds draws). Simulates the
 * 90-minute result, which is what 3-way moneylines, Asian handicaps and totals settle on.
 */
export interface SoccerParams {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
}

export const SOCCER_RHO = -0.08;
const MAXG = 10;

export function dixonColesTau(x: number, y: number, l: number, m: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - l * m * rho;
  if (x === 0 && y === 1) return 1 + l * rho;
  if (x === 1 && y === 0) return 1 + m * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function poissonPmf(k: number, l: number): number {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

/** Score grid probabilities P(home=x, away=y), x,y in 0..10, normalised. */
export function soccerGrid(p: SoccerParams): Float64Array {
  const g = new Float64Array((MAXG + 1) * (MAXG + 1));
  let s = 0;
  for (let x = 0; x <= MAXG; x++) {
    for (let y = 0; y <= MAXG; y++) {
      const v = poissonPmf(x, p.lambdaHome) * poissonPmf(y, p.lambdaAway) * Math.max(0, dixonColesTau(x, y, p.lambdaHome, p.lambdaAway, p.rho));
      g[x * (MAXG + 1) + y] = v;
      s += v;
    }
  }
  for (let i = 0; i < g.length; i++) g[i] /= s;
  return g;
}

export function simulateSoccer(p: SoccerParams, n: number, seed: number): SimSamples {
  const rng = createRng(seed);
  const g = soccerGrid(p);
  const cdf = new Float64Array(g.length);
  let acc = 0;
  for (let i = 0; i < g.length; i++) { acc += g[i]; cdf[i] = acc; }
  const home = new Int16Array(n), away = new Int16Array(n), winner = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng.next() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
    const x = Math.floor(lo / (MAXG + 1)), y = lo % (MAXG + 1);
    home[i] = x; away[i] = y; winner[i] = x > y ? 1 : x < y ? -1 : 0;
  }
  return { n, home, away, winner };
}
