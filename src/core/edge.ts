import { feePerContract } from './fees';
import { resultOf, type ScoreRuns } from './models/common';
import { SCORE_UNIT, VALUE_MIN_EDGE } from './sports';
import type { Consensus, KalshiContract, PricedContract, PricedSide, Sport, Tier } from './types';

/** Evaluate a Kalshi strike condition on value x. */
export function strikeHolds(c: Pick<KalshiContract, 'strikeType' | 'floorStrike' | 'capStrike'>, x: number): boolean {
  const f = c.floorStrike, cap = c.capStrike;
  switch (c.strikeType) {
    case 'greater': return f !== undefined && x > f;
    case 'greater_or_equal': return f !== undefined && x >= f;
    case 'less': return cap !== undefined && x < cap;
    case 'less_or_equal': return cap !== undefined && x <= cap;
    case 'between': return f !== undefined && cap !== undefined && x >= f && x <= cap;
    default: return false;
  }
}

export type Side = 'home' | 'away';

/** Probability that the contract's Yes resolves true, read off the simulated runs. */
export function probYes(c: KalshiContract, runs: ScoreRuns, sideOf: (code?: string) => Side | undefined): number | null {
  const n = runs.home.length;
  let hits = 0;
  if (c.kind === 'winner') {
    const s = sideOf(c.code);
    if (!s) return null;
    const want = s === 'home' ? 1 : -1;
    for (let i = 0; i < n; i++) if (resultOf(runs, i) === want) hits++;
    return hits / n;
  }
  if (c.kind === 'tie') {
    for (let i = 0; i < n; i++) if (resultOf(runs, i) === 0) hits++;
    return hits / n;
  }
  if (c.kind === 'spread') {
    const s = sideOf(c.code);
    if (!s) return null;
    for (let i = 0; i < n; i++) {
      const m = s === 'home' ? runs.home[i] - runs.away[i] : runs.away[i] - runs.home[i];
      if (strikeHolds(c, m)) hits++;
    }
    return hits / n;
  }
  for (let i = 0; i < n; i++) if (strikeHolds(c, runs.home[i] + runs.away[i])) hits++;
  return hits / n;
}

/** The strike expressed as a HOME handicap (spread) or a total line, for tier comparison. */
export function equivalentLine(c: KalshiContract, side: Side | undefined): number | undefined {
  const s = c.floorStrike ?? c.capStrike;
  if (s === undefined) return undefined;
  if (c.kind === 'total') return s;
  if (c.kind === 'spread') return side === 'home' ? -s : s;
  return undefined;
}

/**
 * Confidence tier. A: the strike equals the consensus main line (or it is the moneyline / soccer draw,
 * which the sim is fitted to). B: within one score unit of the main line. C: far alternates and
 * markets with no consensus anchor (depend on the distribution's shape).
 */
export function tierFor(sport: Sport, c: KalshiContract, side: Side | undefined, cons: Consensus, fitMiss?: ReadonlySet<string>): Tier {
  if (fitMiss?.has(c.kind)) return 'C'; // the sim could not reproduce this market's consensus anchor
  if (c.kind === 'winner') return cons.mlDerived ? 'C' : 'A';
  if (c.kind === 'tie') return cons.pDraw !== undefined ? 'A' : 'C';
  const eq = equivalentLine(c, side);
  const main = c.kind === 'total' ? cons.totalLine : cons.spreadLine;
  if (eq === undefined || main === undefined) return 'C';
  const d = Math.abs(eq - main);
  // Main line resting on a single book while three or more books quote the game: not a consensus.
  const support = c.kind === 'total' ? cons.booksTotal : cons.booksSpread;
  if (support < 2 && cons.books.length >= 3) return 'C';
  // NHL goal-margin alternates depend on the empty-net model, which is not anchored to any book line.
  if (sport === 'nhl' && c.kind === 'spread' && d > 1e-9) return 'C';
  if (d < 1e-9) return 'A';
  if (d <= SCORE_UNIT[sport] + 1e-9) return 'B';
  return 'C';
}

/** Step 4: edge = p - ask - taker fee, per side. Value when edge >= 2c and there is size at the ask. */
export function priceSide(side: 'yes' | 'no', prob: number, ask: number | null, size: number, c: KalshiContract, allowFlag: boolean): PricedSide {
  if (ask === null || ask <= 0 || ask >= 1) return { side, prob, ask, size, fee: 0, edge: null, value: false };
  const fee = feePerContract(ask, c.fee);
  const edge = prob - ask - fee;
  return { side, prob, ask, size, fee, edge, value: allowFlag && edge >= VALUE_MIN_EDGE - 1e-9 && size >= 1 };
}

const CLUB_SUFFIX = new Set(['fc', 'cf', 'sc', 'afc', 'ac', 'cd', 'sv', 'fk', 'bk', 'ssc', 'fcu']);

export function describe(c: KalshiContract, teamName: (code?: string) => string): { description: string; strikeDisplay: string } {
  if (c.kind === 'winner') return { description: `${teamName(c.code)} win`, strikeDisplay: 'ML' };
  if (c.kind === 'tie') return { description: 'Tie / draw', strikeDisplay: 'TIE' };
  const s = c.floorStrike ?? c.capStrike;
  if (c.kind === 'spread') {
    // Keep the strike visible on a phone row: "New England Patriots" -> "Patriots".
    const full = teamName(c.code);
    const all = full.split(' ');
    // Club suffixes (FC, CF, SC ...) are not names: "Manchester City FC" -> "Manchester City", never a bare "FC".
    const words = all.filter((w) => !CLUB_SUFFIX.has(w.toLowerCase().replace(/\./g, '')));
    const hadSuffix = words.length < all.length && words.length > 0;
    const short = hadSuffix ? words.join(' ') : all.length >= 3 ? all[all.length - 1] : full;
    return { description: `${short} by >${s}`, strikeDisplay: `-${s}` };
  }
  return { description: `Total >${s}`, strikeDisplay: `O${s}` };
}

export function priceContract(
  sport: Sport,
  c: KalshiContract,
  runs: ScoreRuns,
  cons: Consensus,
  sideOf: (code?: string) => Side | undefined,
  teamName: (code?: string) => string,
  allowFlag: boolean,
  fitMiss?: ReadonlySet<string>,
): PricedContract | null {
  const p = probYes(c, runs, sideOf);
  if (p === null) return null;
  const side = sideOf(c.code);
  const { description, strikeDisplay } = describe(c, teamName);
  // A market whose consensus anchor the sim could not reproduce is never flagged as value.
  if (fitMiss?.has(c.kind)) allowFlag = false;
  return {
    contract: c,
    description,
    strikeDisplay,
    tier: tierFor(sport, c, side, cons, fitMiss),
    probYes: p,
    yes: priceSide('yes', p, c.yesAsk, c.yesAskSize, c, allowFlag),
    no: priceSide('no', 1 - p, c.noAsk, c.noAskSize, c, allowFlag),
  };
}

/**
 * Ladder sanity check. On one ladder (totals, or one team's spreads) "Yes at a lower strike" plus "No at a
 * higher strike" always pays at least $1, so their asks cannot honestly sum to $1 or less. When they do, one
 * of the two quotes is stale or orphaned; neither may be flagged as value.
 */
export function markSuspectQuotes(contracts: PricedContract[]): void {
  const ladders = new Map<string, PricedContract[]>();
  for (const pc of contracts) {
    const c = pc.contract;
    if ((c.kind !== 'total' && c.kind !== 'spread') || c.strikeType !== 'greater' || c.floorStrike === undefined) continue;
    const key = c.kind === 'total' ? 'total' : `spread:${c.code}`;
    ladders.set(key, [...(ladders.get(key) ?? []), pc]);
  }
  for (const rows of ladders.values()) {
    rows.sort((a, b) => a.contract.floorStrike! - b.contract.floorStrike!);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const lo = rows[i].yes, hi = rows[j].no;
        if (lo.ask === null || hi.ask === null || rows[i].contract.floorStrike === rows[j].contract.floorStrike) continue;
        if (lo.ask + hi.ask <= 1 + 1e-9) {
          lo.suspect = true; lo.value = false;
          hi.suspect = true; hi.value = false;
        }
      }
    }
  }
}
