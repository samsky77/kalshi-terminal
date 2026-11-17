import { createRng, type Rng } from '../rng';
import type { SimSamples } from '../types';

/**
 * Tennis: point-level Markov model. Each player wins a point on serve with a fixed probability
 * (pA for the first-listed player, "home"; pB for the other). Service games use the exact
 * closed-form hold probability of that Markov chain; tiebreaks are played point by point.
 * Simulated to match level: best of 3 or 5, standard tiebreak at 6-6, and a 10-point final-set
 * tiebreak at the Slams. Outputs games won by each player and the match winner.
 *
 * Serve rates: surface- and recency-weighted from results when available; otherwise solved from
 * the market (see `solveServeGap`) — see docs/model.md.
 */
export interface TennisParams {
  pA: number;
  pB: number;
  bestOf: 3 | 5;
  finalSetTiebreakTo: 7 | 10;
}

export const TOUR_SERVE = { atp: 0.645, wta: 0.565 } as const;

export function holdProb(p: number): number {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + (20 * p ** 3 * q ** 3 * p * p) / (1 - 2 * p * q);
}

/** Tiebreak to `to` points, serve order A B B A A B B … if A serves first. Returns true if A wins. */
function playTiebreak(rng: Rng, pA: number, pB: number, aFirst: boolean, to: number): boolean {
  let a = 0, b = 0, k = 0;
  for (;;) {
    const firstServes = Math.floor((k + 1) / 2) % 2 === 0;
    const aServes = firstServes === aFirst;
    const pw = aServes ? pA : 1 - pB;
    if (rng.next() < pw) a++; else b++;
    k++;
    if (a >= to && a - b >= 2) return true;
    if (b >= to && b - a >= 2) return false;
    if (k > 200) return rng.next() < 0.5;
  }
}

export function simulateTennis(p: TennisParams, n: number, seed: number): SimSamples {
  const rng = createRng(seed);
  const hA = holdProb(p.pA), hB = holdProb(p.pB);
  const need = p.bestOf === 5 ? 3 : 2;
  const home = new Int16Array(n), away = new Int16Array(n), winner = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    let setsA = 0, setsB = 0, gA = 0, gB = 0;
    let aServes = rng.next() < 0.5; // coin toss
    while (setsA < need && setsB < need) {
      let a = 0, b = 0;
      const finalSet = setsA === need - 1 && setsB === need - 1;
      for (;;) {
        if (a === 6 && b === 6) {
          const to = finalSet ? p.finalSetTiebreakTo : 7;
          if (playTiebreak(rng, p.pA, p.pB, aServes, to)) a++; else b++;
          aServes = !aServes;
          break;
        }
        const aWins = aServes ? rng.next() < hA : rng.next() >= hB;
        if (aWins) a++; else b++;
        aServes = !aServes;
        if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) break;
      }
      gA += a; gB += b;
      if (a > b) setsA++; else setsB++;
    }
    home[i] = gA; away[i] = gB; winner[i] = setsA > setsB ? 1 : -1;
  }
  return { n, home, away, winner };
}

/**
 * Solve the serve-rate gap d (pA = s + d/2, pB = s − d/2) so the simulated match-win probability
 * for A equals `target`. Uses common random numbers so the bisection is smooth.
 */
export function solveServeGap(target: number, s: number, fmt: Omit<TennisParams, 'pA' | 'pB'>, seed = 7, n = 3000): number {
  let lo = -0.3, hi = 0.3;
  for (let it = 0; it < 22; it++) {
    const d = (lo + hi) / 2;
    const sim = simulateTennis({ ...fmt, pA: s + d / 2, pB: s - d / 2 }, n, seed);
    let w = 0;
    for (let i = 0; i < sim.n; i++) if (sim.winner[i] === 1) w++;
    if (w / sim.n < target) lo = d; else hi = d;
  }
  return (lo + hi) / 2;
}

/** Solve the average serve level s so mean total games matches `targetTotal` (gap held fixed). */
export function solveServeLevel(targetTotal: number, d: number, fmt: Omit<TennisParams, 'pA' | 'pB'>, seed = 11, n = 2000): number {
  let lo = 0.5, hi = 0.8;
  for (let it = 0; it < 18; it++) {
    const s = (lo + hi) / 2;
    const sim = simulateTennis({ ...fmt, pA: Math.min(0.95, s + d / 2), pB: Math.max(0.3, s - d / 2) }, n, seed);
    let t = 0;
    for (let i = 0; i < sim.n; i++) t += sim.home[i] + sim.away[i];
    // Higher serve level -> more holds -> more games.
    if (t / sim.n < targetTotal) lo = s; else hi = s;
  }
  return (lo + hi) / 2;
}
