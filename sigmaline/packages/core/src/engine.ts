import { BASKETBALL_SHAPE, simulateBasketball } from './models/basketball';
import { FOOTBALL_SHAPE, simulateFootball } from './models/football';
import { simulateHockey } from './models/hockey';
import { SOCCER_RHO, simulateSoccer, soccerGrid } from './models/soccer';
import { simulateTennis, solveServeGap, solveServeLevel, TOUR_SERVE } from './models/tennis';
import { normCdf, normInv, poissonCdf } from './stats';
import type { SimSamples, SportId } from './types';

/** Expected score for each side: points (basketball/football), goals (NHL/soccer). */
export interface Expectation { home: number; away: number }

export interface TennisInput {
  tour: 'atp' | 'wta';
  bestOf: 3 | 5;
  slam: boolean;
  /** Model's own match-win probability for the first player (Elo), if known. */
  modelWinProb?: number;
}

/** Market anchor read off the consensus main lines (all probabilities no-vig). */
export interface MarketAnchor {
  pHomeMl?: number;
  pDraw?: number;
  /** Home spread line (e.g. −3.5) and the no-vig probability the home side covers it. */
  spreadLine?: number;
  pHomeCover?: number;
  totalLine?: number;
  pOver?: number;
}

export const N_SIMS = 10_000;

/** Rest / back-to-back adjustment in points (or goals) added to a side's expectation. */
export function restAdjust(sport: SportId, restDays: number | undefined): number {
  if (restDays === undefined) return 0;
  if (sport === 'nba') return restDays <= 0 ? -1.4 : restDays >= 3 ? 0.4 : 0;
  if (sport === 'cbb') return restDays <= 1 ? -0.6 : 0;
  if (sport === 'nhl') return restDays <= 0 ? -0.12 : 0;
  if (sport === 'nfl') return restDays >= 10 ? 0.6 : restDays <= 4 ? -0.4 : 0;
  return 0;
}

function marginSd(sport: SportId): number {
  if (sport === 'nba' || sport === 'cbb') { const s = BASKETBALL_SHAPE[sport]; return Math.sqrt(2 * s.sd * s.sd * (1 - s.rho)); }
  if (sport === 'nfl' || sport === 'cfb') return FOOTBALL_SHAPE[sport].sigma;
  return 2;
}
function totalSd(sport: SportId): number {
  if (sport === 'nba' || sport === 'cbb') { const s = BASKETBALL_SHAPE[sport]; return Math.sqrt(2 * s.sd * s.sd * (1 + s.rho)); }
  if (sport === 'nfl' || sport === 'cfb') return FOOTBALL_SHAPE[sport].totalSd;
  return 2;
}

const DEFAULT_TOTAL: Record<SportId, number> = { nba: 228, cbb: 145, nfl: 44, cfb: 54, nhl: 6.1, soccer: 2.7, tennis: 22 };

/**
 * Market-implied expectation, used as a fallback when a team has too few results for ratings
 * (cold start). It reproduces the consensus, so these games only show line-shopping edges.
 */
export function marketImpliedExpectation(sport: SportId, a: MarketAnchor): Expectation | null {
  if (sport === 'tennis') return null;
  const T = a.totalLine !== undefined && a.pOver !== undefined
    ? a.totalLine + totalSd(sport) * (sport === 'nhl' || sport === 'soccer' ? 0 : normInv(a.pOver))
    : DEFAULT_TOTAL[sport];
  if (sport === 'nhl' || sport === 'soccer') {
    // Goals: solve the total rate from P(over) and the split from the moneyline.
    let lam = T;
    if (a.totalLine !== undefined && a.pOver !== undefined) {
      let lo = 0.5, hi = 12;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const pOver = 1 - poissonCdf(Math.floor(a.totalLine), mid);
        if (pOver < a.pOver) lo = mid; else hi = mid;
      }
      lam = (lo + hi) / 2;
    }
    const pTarget = a.pHomeMl ?? 0.5;
    let lo = 0.05, hi = 0.95;
    for (let i = 0; i < 40; i++) {
      const share = (lo + hi) / 2;
      const lh = lam * share, la = lam * (1 - share);
      let pHome: number;
      if (sport === 'soccer') {
        const g = soccerGrid({ lambdaHome: lh, lambdaAway: la, rho: SOCCER_RHO });
        pHome = 0;
        for (let x = 0; x <= 10; x++) for (let y = 0; y < x; y++) pHome += g[x * 11 + y];
        if (a.pDraw !== undefined && a.pHomeMl !== undefined) {
          // condition on not-draw so the target is comparable across draw rates
          let pAway = 0;
          for (let x = 0; x <= 10; x++) for (let y = x + 1; y <= 10; y++) pAway += g[x * 11 + y];
          const tgt = a.pHomeMl / (a.pHomeMl + (1 - a.pHomeMl - a.pDraw));
          if (pHome / (pHome + pAway) < tgt) lo = share; else hi = share;
          continue;
        }
      } else {
        // Regulation Skellam + OT split (approx.)
        let win = 0, tie = 0;
        for (let x = 0; x <= 12; x++) {
          const px = Math.exp(-lh) * Math.pow(lh, x) / fact(x);
          for (let y = 0; y <= 12; y++) {
            const py = Math.exp(-la) * Math.pow(la, y) / fact(y);
            if (x > y) win += px * py; else if (x === y) tie += px * py;
          }
        }
        pHome = win + tie * (0.72 * share + 0.28 * 0.52);
      }
      if (pHome < pTarget) lo = share; else hi = share;
    }
    const share = (lo + hi) / 2;
    return { home: lam * share, away: lam * (1 - share) };
  }
  let mu: number;
  if (a.spreadLine !== undefined && a.pHomeCover !== undefined) mu = -a.spreadLine + marginSd(sport) * normInv(a.pHomeCover);
  else if (a.pHomeMl !== undefined) mu = marginSd(sport) * normInv(a.pHomeMl);
  else return null;
  return { home: (T + mu) / 2, away: (T - mu) / 2 };
}

const FACT: number[] = [1];
function fact(n: number): number {
  for (let i = FACT.length; i <= n; i++) FACT[i] = FACT[i - 1] * i;
  return FACT[n];
}

export interface SimSpec {
  sport: SportId;
  expect?: Expectation;
  tennis?: TennisInput & { anchor: MarketAnchor };
  n?: number;
  seed: number;
}

export interface SimOutput {
  samples: SimSamples;
  params: Record<string, number | string | boolean>;
}

/** Run one game's Monte Carlo (≥ 10,000 runs) for any sport. */
export function simulateGame(spec: SimSpec): SimOutput {
  const n = Math.max(N_SIMS, spec.n ?? N_SIMS);
  const { sport } = spec;
  if (sport === 'tennis') {
    const t = spec.tennis!;
    const fmt = { bestOf: t.bestOf, finalSetTiebreakTo: (t.slam ? 10 : 7) as 7 | 10 };
    const s0 = TOUR_SERVE[t.tour];
    const pWin = t.modelWinProb ?? t.anchor.pHomeMl ?? 0.5;
    const d = solveServeGap(pWin, s0, fmt);
    const s = t.anchor.totalLine !== undefined ? solveServeLevel(t.anchor.totalLine + 0.5, d, fmt) : s0;
    const pA = Math.min(0.95, s + d / 2), pB = Math.max(0.3, s - d / 2);
    return { samples: simulateTennis({ pA, pB, ...fmt }, n, spec.seed), params: { pA, pB, bestOf: t.bestOf, slam: t.slam } };
  }
  const e = spec.expect!;
  if (sport === 'nba' || sport === 'cbb') {
    const sh = BASKETBALL_SHAPE[sport];
    const p = { muHome: e.home, muAway: e.away, sd: sh.sd, rho: sh.rho, otMean: sh.otMean, otSd: sh.otSd };
    return { samples: simulateBasketball(p, n, spec.seed), params: p };
  }
  if (sport === 'nfl' || sport === 'cfb') {
    const sh = FOOTBALL_SHAPE[sport];
    const p = { sport, mu: e.home - e.away, sigma: sh.sigma, total: e.home + e.away, totalSd: sh.totalSd, rho: sh.rho } as const;
    return { samples: simulateFootball(p, n, spec.seed), params: { ...p } };
  }
  if (sport === 'nhl') {
    const p = { lambdaHome: e.home, lambdaAway: e.away };
    return { samples: simulateHockey(p, n, spec.seed), params: p };
  }
  const p = { lambdaHome: e.home, lambdaAway: e.away, rho: SOCCER_RHO };
  return { samples: simulateSoccer(p, n, spec.seed), params: p };
}

/** P(home win) from a normal margin, for quick sanity checks. */
export function normalWinProb(sport: SportId, mu: number): number {
  return normCdf(mu / marginSd(sport));
}
