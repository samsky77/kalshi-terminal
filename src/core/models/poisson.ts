import { NHL_EMPTY_NET, NHL_OT_DECIDED_SHARE } from '../sports';
import { bisect, mulberry32, openUniform, poissonInv } from '../stats';
import { pOver, pWin2, type ScoreRuns, type Targets } from './common';

export interface UniformDraws {
  u: Float64Array[]; // k independent uniform streams of length n
}

export function drawUniforms(n: number, k: number, seed: number): UniformDraws {
  const rng = mulberry32(seed);
  const u = Array.from({ length: k }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) u[j][i] = openUniform(rng);
  return { u };
}

// ---------------- NHL: two independent Poisson goal rates + OT/shootout ----------------

export interface NhlParams {
  lambdaHome: number;
  lambdaAway: number;
}

/**
 * Regulation goals ~ Poisson(lambdaHome), Poisson(lambdaAway). A regulation tie goes to
 * overtime: with probability NHL_OT_DECIDED_SHARE it is decided in 3-on-3 OT, where home wins
 * with probability lambdaHome/(lambdaHome+lambdaAway); otherwise a shootout (coin flip).
 * The winner is credited one goal, matching how sportsbooks and Kalshi grade NHL totals and spreads.
 * A late goalie-pull step (NHL_EMPTY_NET, needs a 5th uniform stream) runs before the tie check.
 */
export function simulateNhl(p: NhlParams, d: UniformDraws, n = d.u[0].length, out?: ScoreRuns): ScoreRuns {
  const r = out ?? { home: new Int16Array(n), away: new Int16Array(n) };
  const share = p.lambdaHome / (p.lambdaHome + p.lambdaAway);
  const [u1, u2, u3, u4, u5] = d.u;
  const { EN_LEAD1, EQ_LEAD1, EN_LEAD2 } = NHL_EMPTY_NET;
  for (let i = 0; i < n; i++) {
    let h = poissonInv(u1[i], p.lambdaHome);
    let a = poissonInv(u2[i], p.lambdaAway);
    if (u5) {
      const lead = h - a, v = u5[i];
      if (lead === 1 || lead === -1) {
        if (v < EN_LEAD1) { if (lead > 0) h++; else a++; }
        else if (v < EN_LEAD1 + EQ_LEAD1) { if (lead > 0) a++; else h++; }
      } else if ((lead === 2 || lead === -2) && v < EN_LEAD2) {
        if (lead > 0) h++; else a++;
      }
    }
    if (h === a) {
      const homeWins = u3[i] < NHL_OT_DECIDED_SHARE ? u4[i] < share : u4[i] < 0.5;
      if (homeWins) h++;
      else a++;
    }
    r.home[i] = h;
    r.away[i] = a;
  }
  return r;
}

/** Solve (total rate, home share) so sim moneyline and main total match consensus. Two-stage like the normal model. */
export function calibrateNhl(t: Targets, d: UniformDraws): NhlParams {
  const N = d.u[0].length;
  const buf: ScoreRuns = { home: new Int16Array(N), away: new Int16Array(N) };
  const hasTotal = t.totalLine !== undefined && t.pOver !== undefined;
  let total = hasTotal ? t.totalLine! : 6.0;
  let share = 0.5;
  const p: NhlParams = { lambdaHome: 3, lambdaAway: 3 };
  const set = (tot: number, sh: number) => { p.lambdaHome = tot * sh; p.lambdaAway = tot * (1 - sh); };
  const stage = (n: number, shLo: number, shHi: number, tLo: number, tHi: number, iters: number, passes: number) => {
    for (let pass = 0; pass < passes; pass++) {
      share = bisect((sh) => { set(total, sh); return pWin2(simulateNhl(p, d, n, buf), n); }, t.pHome, shLo, shHi, iters);
      if (hasTotal) total = bisect((tt) => { set(tt, share); return pOver(simulateNhl(p, d, n, buf), t.totalLine!, n); }, t.pOver!, tLo, tHi, iters);
    }
  };
  stage(Math.min(5000, N), 0.15, 0.85, 2.5, 11, 16, 3);
  if (N > 5000) stage(N, share - 0.02, share + 0.02, total - 0.25, total + 0.25, 8, 2);
  set(total, share);
  return p;
}

// ---------------- Soccer: bivariate Poisson (keeps the draw) ----------------

export interface SoccerParams {
  l1: number; // home-only component
  l2: number; // away-only component
  l3: number; // shared component (adds correlation and draws without moving the margin)
}

/** Home = X1 + X3, Away = X2 + X3 with Xi ~ Poisson(li). Regulation time only (no extra time). */
export function simulateSoccer(p: SoccerParams, d: UniformDraws, n = d.u[0].length, out?: ScoreRuns): ScoreRuns {
  const r = out ?? { home: new Int16Array(n), away: new Int16Array(n) };
  const [u1, u2, u3] = d.u;
  for (let i = 0; i < n; i++) {
    const x3 = poissonInv(u3[i], p.l3);
    r.home[i] = poissonInv(u1[i], p.l1) + x3;
    r.away[i] = poissonInv(u2[i], p.l2) + x3;
  }
  return r;
}

function outcomeProbs(r: ScoreRuns, n: number): [number, number, number] {
  let h = 0, a = 0;
  for (let i = 0; i < n; i++) {
    if (r.home[i] > r.away[i]) h++;
    else if (r.home[i] < r.away[i]) a++;
  }
  return [h / n, (n - h - a) / n, a / n];
}

/**
 * Three-way fit. (l1+l2) sets the draw rate, l1/(l1+l2) sets home vs away, both independent of l3.
 * Then l3 >= 0 is solved from the main total. If the total implies fewer goals than the draw-fitted
 * l1+l2 (rare), l3 = 0 and the total is matched as closely as the moneyline allows.
 */
export function calibrateSoccer(t: Targets, d: UniformDraws): SoccerParams {
  const N = d.u[0].length;
  const buf: ScoreRuns = { home: new Int16Array(N), away: new Int16Array(N) };
  const p: SoccerParams = { l1: 1.3, l2: 1.1, l3: 0 };
  const pDraw = t.pDraw ?? 0.26;
  const homeShareTarget = t.pHome / (t.pHome + t.pAway);
  let ratio = 0.5, S = 2.4;
  const setL = () => { p.l1 = S * ratio; p.l2 = S * (1 - ratio); };
  // Coordinate descent: S mostly sets the draw rate, ratio sets home vs away. l3 = 0 while fitting.
  const stage = (n: number, sLo: number, sHi: number, rLo: number, rHi: number, iters: number, rounds: number) => {
    p.l3 = 0;
    for (let k = 0; k < rounds; k++) {
      ratio = bisect((rt) => {
        ratio = rt; setL();
        const [h, , a] = outcomeProbs(simulateSoccer(p, d, n, buf), n);
        return h + a > 0 ? h / (h + a) : 0.5;
      }, homeShareTarget, rLo, rHi, iters);
      S = bisect((s) => { S = s; setL(); return outcomeProbs(simulateSoccer(p, d, n, buf), n)[1]; }, pDraw, sLo, sHi, iters);
      setL();
    }
  };
  stage(Math.min(3000, N), 0.3, 7, 0.03, 0.97, 14, 4);
  if (N > 3000) stage(N, S * 0.93, S * 1.07, ratio - 0.03, ratio + 0.03, 7, 2);
  if (t.totalLine !== undefined && t.pOver !== undefined) {
    p.l3 = bisect((c) => { p.l3 = c; return pOver(simulateSoccer(p, d, N, buf), t.totalLine!); }, t.pOver, 0, 2.5, 14);
  }
  return p;
}
