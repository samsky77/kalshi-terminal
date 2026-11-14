import { TENNIS_SERVE_AVG } from '../sports';
import { bisect, mulberry32, normInv, openUniform } from '../stats';
import type { ScoreRuns } from './common';

/**
 * Tennis: each player has a serve-point win probability (pA for "home"/first player, pB for the other).
 * Points are i.i.d. given the server. Exact dynamic programming is used for calibration
 * (fast and noise-free); the reported numbers come from a point-by-point Monte Carlo.
 */
export interface TennisParams {
  pA: number;
  pB: number;
  /** SD of a match-level shift in the serve-rate gap (0 = plain i.i.d. points). */
  dSd?: number;
  bestOf: 3 | 5;
  finalSetTiebreakTo: 7 | 10;
}

export interface TennisFormat {
  bestOf: 3 | 5;
  finalSetTiebreakTo: 7 | 10;
}

const SLAM = /(australian open|roland|french open|wimbledon|us open)/i;
export function tennisFormat(competition: string, bestOf?: number): TennisFormat {
  const slam = SLAM.test(competition);
  return { bestOf: bestOf === 5 ? 5 : 3, finalSetTiebreakTo: slam ? 10 : 7 };
}

/** P(server holds) for serve-point win probability p (closed form). */
export function holdProb(p: number): number {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + (20 * p ** 3 * q ** 3 * p * p) / (1 - 2 * p * q);
}

/** Server of tiebreak point k (0-based) when `first` serves first: A B B A A B B ... */
function tbServerIsFirst(k: number): boolean {
  return Math.floor((k + 1) / 2) % 2 === 0;
}

/** P(A wins a tiebreak to `to` points) given A serves first iff aFirst. Exact DP. */
export function tiebreakProb(pA: number, pB: number, aFirst: boolean, to: number): number {
  const memo = new Map<number, number>();
  const pairA = pA * (1 - pB), pairB = (1 - pA) * pB;
  const deuce = pairA / (pairA + pairB);
  const f = (a: number, b: number): number => {
    if (a >= to && a - b >= 2) return 1;
    if (b >= to && b - a >= 2) return 0;
    if (a >= to - 1 && b >= to - 1 && a === b) return deuce; // every 2 points each serves once
    const key = a * 64 + b;
    const m = memo.get(key);
    if (m !== undefined) return m;
    const k = a + b;
    const aServes = tbServerIsFirst(k) === aFirst;
    const pw = aServes ? pA : 1 - pB;
    const v = pw * f(a + 1, b) + (1 - pw) * f(a, b + 1);
    memo.set(key, v);
    return v;
  };
  return f(0, 0);
}

interface SetOutcome { aWins: boolean; ga: number; gb: number; p: number }

/** Distribution of set outcomes. Game g is served by the first server when g is even. */
export function setDistribution(pA: number, pB: number, aFirst: boolean, tbTo: number): SetOutcome[] {
  const hA = holdProb(pA), hB = holdProb(pB);
  const out: SetOutcome[] = [];
  const grid = new Map<number, number>([[0, 1]]);
  // BFS over (ga, gb) in order of games played.
  for (let g = 0; g <= 12; g++) {
    for (let ga = 0; ga <= g; ga++) {
      const gb = g - ga;
      const key = ga * 16 + gb;
      const pr = grid.get(key);
      if (!pr) continue;
      const done = (ga >= 6 || gb >= 6) && Math.abs(ga - gb) >= 2;
      if (done) { out.push({ aWins: ga > gb, ga, gb, p: pr }); continue; }
      if (ga === 6 && gb === 6) {
        // game index 12 -> served by first server; tiebreak first server = first server
        const t = tiebreakProb(pA, pB, aFirst, tbTo);
        out.push({ aWins: true, ga: 7, gb: 6, p: pr * t });
        out.push({ aWins: false, ga: 6, gb: 7, p: pr * (1 - t) });
        continue;
      }
      const aServes = (g % 2 === 0) === aFirst;
      const pAgame = aServes ? hA : 1 - hB;
      grid.set((ga + 1) * 16 + gb, (grid.get((ga + 1) * 16 + gb) ?? 0) + pr * pAgame);
      grid.set(ga * 16 + gb + 1, (grid.get(ga * 16 + gb + 1) ?? 0) + pr * (1 - pAgame));
    }
  }
  return out;
}

export interface MatchDistribution {
  pAWins: number;
  /** joint distribution: key = gamesA*128 + gamesB -> prob */
  games: Map<number, number>;
}

/** Exact match distribution. First server of the match is a coin flip. */
export function matchDistribution(p: TennisParams): MatchDistribution {
  const need = (p.bestOf + 1) / 2;
  const cache = new Map<string, SetOutcome[]>();
  const setDist = (aFirst: boolean, decider: boolean) => {
    const k = `${aFirst}${decider}`;
    let v = cache.get(k);
    if (!v) { v = setDistribution(p.pA, p.pB, aFirst, decider ? p.finalSetTiebreakTo : 7); cache.set(k, v); }
    return v;
  };
  // state: sa, sb, aFirst, ga, gb -> prob
  type St = { sa: number; sb: number; aFirst: boolean; ga: number; gb: number; pr: number };
  let frontier: St[] = [
    { sa: 0, sb: 0, aFirst: true, ga: 0, gb: 0, pr: 0.5 },
    { sa: 0, sb: 0, aFirst: false, ga: 0, gb: 0, pr: 0.5 },
  ];
  const games = new Map<number, number>();
  let pAWins = 0;
  while (frontier.length) {
    const next = new Map<string, St>();
    for (const s of frontier) {
      const decider = s.sa === need - 1 && s.sb === need - 1;
      for (const o of setDist(s.aFirst, decider)) {
        const sa = s.sa + (o.aWins ? 1 : 0), sb = s.sb + (o.aWins ? 0 : 1);
        const ga = s.ga + o.ga, gb = s.gb + o.gb, pr = s.pr * o.p;
        if (sa === need || sb === need) {
          const key = ga * 128 + gb;
          games.set(key, (games.get(key) ?? 0) + pr);
          if (sa === need) pAWins += pr;
          continue;
        }
        // Next set: the player who received the set's last game serves first.
        const n = o.ga + o.gb;
        const lastServerIsFirst = (n - 1) % 2 === 0;
        const aFirst = lastServerIsFirst ? !s.aFirst : s.aFirst;
        const k = `${sa},${sb},${aFirst},${ga},${gb}`;
        const ex = next.get(k);
        if (ex) ex.pr += pr;
        else next.set(k, { sa, sb, aFirst, ga, gb, pr });
      }
    }
    frontier = [...next.values()];
  }
  return { pAWins, games };
}

/** P(A's game margin + L > 0), pushes excluded. */
export function dpCover(md: MatchDistribution, L: number): number {
  let c = 0, nc = 0;
  for (const [k, pr] of md.games) {
    const x = Math.floor(k / 128) - (k % 128) + L;
    if (x > 1e-9) c += pr;
    else if (x < -1e-9) nc += pr;
  }
  return c / (c + nc);
}

export function dpOver(md: MatchDistribution, line: number): number {
  let o = 0, u = 0;
  for (const [k, pr] of md.games) {
    const t = Math.floor(k / 128) + (k % 128);
    if (t > line) o += pr;
    else if (t < line) u += pr;
  }
  return o / (o + u);
}

// 5-point Gauss-Hermite rule for a standard normal (probabilists' nodes, weights sum to 1).
const GH_X = [-2.856970013872806, -1.355626179974266, 0, 1.355626179974266, 2.856970013872806];
const GH_W = [0.011257411327721, 0.222075922005613, 0.533333333333333, 0.222075922005613, 0.011257411327721];

const clampServe = (x: number) => Math.min(0.95, Math.max(0.3, x));

/**
 * Match distribution averaged over a match-level dominance effect: the serve-rate gap is
 * D + dSd * z with z ~ N(0,1) drawn once per match. dSd = 0 is the plain i.i.d. point model.
 */
export function mixedMatchDistribution(S: number, D: number, dSd: number, fmt: TennisFormat): MatchDistribution {
  if (dSd <= 0) return matchDistribution({ pA: clampServe((S + D) / 2), pB: clampServe((S - D) / 2), ...fmt });
  const games = new Map<number, number>();
  let pAWins = 0;
  for (let j = 0; j < GH_X.length; j++) {
    const d = D + dSd * GH_X[j];
    const md = matchDistribution({ pA: clampServe((S + d) / 2), pB: clampServe((S - d) / 2), ...fmt });
    pAWins += GH_W[j] * md.pAWins;
    for (const [k, v] of md.games) games.set(k, (games.get(k) ?? 0) + GH_W[j] * v);
  }
  return { pAWins, games };
}

/**
 * Solve serve-point rates. The gap pA - pB is solved from the match moneyline. The level pA + pB
 * comes from the consensus total-games line when present, otherwise the tour average.
 * Total games is U-shaped in the level with its minimum at pA + pB = 1, so the level is searched
 * on the realistic branch [1.0, 1.6]. If the consensus total is still below what the i.i.d. model
 * can produce (common for WTA), the level is fixed at the tour average and a match-level dominance
 * spread dSd is solved instead (more lopsided matches -> fewer three-setters). See MODEL.md.
 */
export function calibrateTennis(
  t: { pHome: number; totalLine?: number; pOver?: number; spreadLine?: number; pHomeCover?: number },
  fmt: TennisFormat,
  tour: 'ATP' | 'WTA',
): TennisParams {
  const avgS = 2 * TENNIS_SERVE_AVG[tour];
  let S = avgS;
  let D = 0;
  let dSd = 0;
  const md = () => mixedMatchDistribution(S, D, dSd, fmt);
  const solveD = () => { D = bisect((d) => { D = d; return md().pAWins; }, t.pHome, -0.45, 0.45, 20); };
  const hasTotal = t.totalLine !== undefined && t.pOver !== undefined;
  solveD();
  // The game spread is an output, not a target: it is not monotone in any free parameter.
  if (hasTotal) {
    for (let pass = 0; pass < 3; pass++) {
      S = bisect((x) => { S = x; return dpOver(md(), t.totalLine!); }, t.pOver!, 1.0, 1.6, 22);
      solveD();
    }
    if (dpOver(md(), t.totalLine!) > t.pOver! + 0.02 || S < avgS - 0.12) {
      S = avgS;
      for (let pass = 0; pass < 3; pass++) {
        solveD();
        dSd = bisect((x) => { dSd = x; return dpOver(md(), t.totalLine!); }, t.pOver!, 0, 0.3, 18);
      }
      solveD();
    }
  }
  return { pA: clampServe((S + D) / 2), pB: clampServe((S - D) / 2), dSd, bestOf: fmt.bestOf, finalSetTiebreakTo: fmt.finalSetTiebreakTo };
}

/** Point-by-point Monte Carlo. home = games won by A, away = games won by B, winner = match result. */
export function simulateTennis(p: TennisParams, runs: number, seed: number): ScoreRuns & { sets: Int8Array } {
  const rng = mulberry32(seed);
  const home = new Int16Array(runs), away = new Int16Array(runs), winner = new Int8Array(runs), sets = new Int8Array(runs);
  const need = (p.bestOf + 1) / 2;
  const S = p.pA + p.pB, D0 = p.pA - p.pB, dSd = p.dSd ?? 0;
  for (let i = 0; i < runs; i++) {
    let pA = p.pA, pB = p.pB;
    if (dSd > 0) {
      const d = D0 + dSd * normInv(openUniform(rng));
      pA = clampServe((S + d) / 2); pB = clampServe((S - d) / 2);
    }
    const hA = holdProb(pA), hB = holdProb(pB);
    let aFirst = rng() < 0.5;
    let sa = 0, sb = 0, GA = 0, GB = 0;
    while (sa < need && sb < need) {
      const decider = sa === need - 1 && sb === need - 1;
      let ga = 0, gb = 0, g = 0;
      for (;;) {
        if ((ga >= 6 || gb >= 6) && Math.abs(ga - gb) >= 2) break;
        if (ga === 6 && gb === 6) {
          const to = decider ? p.finalSetTiebreakTo : 7;
          let ta = 0, tb = 0, k = 0;
          while (!((ta >= to || tb >= to) && Math.abs(ta - tb) >= 2)) {
            const aServes = tbServerIsFirst(k) === aFirst;
            const won = rng() < (aServes ? pA : 1 - pB);
            if (won) ta++; else tb++;
            k++;
          }
          if (ta > tb) ga++; else gb++;
          g++;
          break;
        }
        const aServes = (g % 2 === 0) === aFirst;
        if (rng() < (aServes ? hA : 1 - hB)) ga++; else gb++;
        g++;
      }
      if (ga > gb) sa++; else sb++;
      GA += ga; GB += gb;
      const lastServerIsFirst = (g - 1) % 2 === 0;
      if (lastServerIsFirst) aFirst = !aFirst;
    }
    home[i] = GA; away[i] = GB; winner[i] = sa > sb ? 1 : -1; sets[i] = sa - sb;
  }
  return { home, away, winner, sets };
}
