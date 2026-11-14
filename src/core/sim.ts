import { pCover, pOver, resultOf, type ScoreRuns, type Targets } from './models/common';
import { calibrateNormal, drawNormal, simulateNormal, type NormalSport } from './models/normal';
import { calibrateNhl, calibrateSoccer, drawUniforms, simulateNhl, simulateSoccer } from './models/poisson';
import { calibrateTennis, simulateTennis, tennisFormat } from './models/tennis';
import { SIM_RUNS } from './sports';
import { hashString, histogram } from './stats';
import type { Consensus, SimSummary, Sport } from './types';

export interface SimContext {
  gameKey: string; // stable id -> seed
  runs?: number;
  seedSalt?: string;
  competition?: string;
  bestOf?: number;
  tour?: 'ATP' | 'WTA';
}

export interface SimOutput {
  runs: ScoreRuns;
  summary: SimSummary;
}

export function targetsFromConsensus(c: Consensus): Targets {
  return {
    pHome: c.pDraw !== undefined ? c.pHome : c.pHome / (c.pHome + c.pAway),
    pAway: c.pDraw !== undefined ? c.pAway : c.pAway / (c.pHome + c.pAway),
    pDraw: c.pDraw,
    spreadLine: c.spreadLine,
    pHomeCover: c.pHomeCover,
    totalLine: c.totalLine,
    pOver: c.pOver,
  };
}

export function seedFor(ctx: SimContext): number {
  return hashString(`${ctx.gameKey}|${ctx.seedSalt ?? 'v1'}`);
}

/**
 * Steps 2+3: calibrate the sport's score model to the consensus, then run >= 20,000 seeded,
 * reproducible simulations. Pure function of (sport, consensus, ctx).
 */
export function simulateGame(sport: Sport, c: Consensus, ctx: SimContext): SimOutput {
  const n = Math.max(ctx.runs ?? SIM_RUNS, 1000);
  const seed = seedFor(ctx);
  const t = targetsFromConsensus(c);
  let runs: ScoreRuns;
  let model: SimSummary['model'];
  let params: Record<string, number>;

  if (sport === 'nba' || sport === 'ncaab' || sport === 'nfl' || sport === 'ncaaf') {
    const d = drawNormal(n, seed);
    const p = calibrateNormal(sport as NormalSport, t, d);
    runs = simulateNormal(sport as NormalSport, p, d);
    model = 'normal';
    params = { ...p };
  } else if (sport === 'nhl') {
    const d = drawUniforms(n, 5, seed);
    const p = calibrateNhl(t, d);
    runs = simulateNhl(p, d);
    model = 'poisson';
    params = { ...p };
  } else if (sport === 'soccer') {
    const d = drawUniforms(n, 3, seed);
    const p = calibrateSoccer(t, d);
    runs = simulateSoccer(p, d);
    model = 'bivariate-poisson';
    params = { ...p };
  } else {
    const fmt = tennisFormat(ctx.competition ?? '', ctx.bestOf);
    const p = calibrateTennis(t, fmt, ctx.tour ?? 'ATP');
    runs = simulateTennis(p, n, seed);
    model = 'tennis';
    params = { pA: p.pA, pB: p.pB, dSd: p.dSd ?? 0, bestOf: p.bestOf, finalSetTiebreakTo: p.finalSetTiebreakTo };
  }

  let hw = 0, aw = 0;
  const margin = new Int16Array(n), total = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const r = resultOf(runs, i);
    if (r > 0) hw++;
    else if (r < 0) aw++;
    margin[i] = runs.home[i] - runs.away[i];
    total[i] = runs.home[i] + runs.away[i];
  }
  const summary: SimSummary = {
    runs: n,
    seed,
    model,
    params,
    pHomeWin: hw / n,
    pAwayWin: aw / n,
    pTie: (n - hw - aw) / n,
    pHomeCoverMain: t.spreadLine !== undefined ? pCover(runs, t.spreadLine) : undefined,
    pOverMain: t.totalLine !== undefined ? pOver(runs, t.totalLine) : undefined,
    marginHist: histogram(margin),
    totalHist: histogram(total),
  };
  return { runs, summary };
}
