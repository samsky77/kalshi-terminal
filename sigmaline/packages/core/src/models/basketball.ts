import { createRng } from '../rng';
import type { SimSamples } from '../types';

/**
 * NBA / CBB: correlated bivariate normal for the two teams' points, rounded to integers, with
 * overtime periods simulated until the tie breaks. Correlation comes from shared pace.
 *
 * Constants: margin SD vs. the closing spread ≈ 13.5 (NBA) / 11 (CBB) and total SD ≈ 18.5 / 16.5.
 * With team SD s and correlation ρ: Var(margin) = 2s²(1−ρ), Var(total) = 2s²(1+ρ).
 */
export interface BasketballParams {
  muHome: number;
  muAway: number;
  sd: number;
  rho: number;
  /** Mean points per team in one overtime period. */
  otMean: number;
  otSd: number;
}

export const BASKETBALL_SHAPE = {
  nba: { sd: 11.4, rho: 0.3, otMean: 10.5, otSd: 3.6, periodMinutes: 48 },
  cbb: { sd: 9.9, rho: 0.39, otMean: 8.5, otSd: 3.4, periodMinutes: 40 },
} as const;

export function simulateBasketball(p: BasketballParams, n: number, seed: number): SimSamples {
  const rng = createRng(seed);
  const home = new Int16Array(n), away = new Int16Array(n), winner = new Int8Array(n);
  const k = Math.sqrt(1 - p.rho * p.rho);
  for (let i = 0; i < n; i++) {
    const z1 = rng.normal(), z2 = rng.normal();
    let h = Math.max(30, Math.round(p.muHome + p.sd * z1));
    let a = Math.max(30, Math.round(p.muAway + p.sd * (p.rho * z1 + k * z2)));
    let guard = 0;
    while (h === a && guard++ < 6) {
      const o1 = rng.normal(), o2 = rng.normal();
      const share = p.muHome / (p.muHome + p.muAway);
      h += Math.max(0, Math.round(p.otMean * 2 * share + p.otSd * o1));
      a += Math.max(0, Math.round(p.otMean * 2 * (1 - share) + p.otSd * o2));
    }
    if (h === a) { if (rng.next() < 0.5) h++; else a++; }
    home[i] = h; away[i] = a; winner[i] = h > a ? 1 : -1;
  }
  return { n, home, away, winner };
}
