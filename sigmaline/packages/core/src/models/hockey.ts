import { createRng } from '../rng';
import type { SimSamples } from '../types';

/**
 * NHL: each team's regulation goals are Poisson(λ). A late-game step adds empty-net goals
 * (a trailing team pulls its goalie): on a 1-goal lead the leader scores an empty-netter with
 * p=0.22 and the trailer equalises with p=0.08; on a 2-goal lead p=0.12. Ties go to 3-on-3 OT
 * (a goal in ~72% of OTs, split by scoring rate) and then a shootout (home 52%). The OT/SO
 * winner gets +1 goal, as books grade totals and puck lines.
 */
export interface HockeyParams {
  lambdaHome: number;
  lambdaAway: number;
}

export const HOCKEY_CONST = { en1: 0.22, eq1: 0.08, en2: 0.12, otGoal: 0.72, soHome: 0.52 };
/** Fraction by which λ is scaled down so the late empty-net step doesn't inflate the mean. */
export const HOCKEY_EN_DEFLATE = 0.988;

export function simulateHockey(p: HockeyParams, n: number, seed: number): SimSamples {
  const rng = createRng(seed);
  const c = HOCKEY_CONST;
  const lh = p.lambdaHome * HOCKEY_EN_DEFLATE, la = p.lambdaAway * HOCKEY_EN_DEFLATE;
  const home = new Int16Array(n), away = new Int16Array(n), winner = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    let h = rng.poisson(lh), a = rng.poisson(la);
    const d = h - a;
    if (Math.abs(d) === 1) {
      const u = rng.next();
      if (u < c.en1) { if (d > 0) h++; else a++; }
      else if (u < c.en1 + c.eq1) { if (d > 0) a++; else h++; }
    } else if (Math.abs(d) === 2) {
      if (rng.next() < c.en2) { if (d > 0) h++; else a++; }
    }
    if (h === a) {
      if (rng.next() < c.otGoal) {
        if (rng.next() < lh / (lh + la)) h++; else a++;
      } else {
        if (rng.next() < c.soHome) h++; else a++;
      }
    }
    home[i] = h; away[i] = a; winner[i] = h > a ? 1 : -1;
  }
  return { n, home, away, winner };
}
