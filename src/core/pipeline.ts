import { markSuspectQuotes, priceContract, type Side } from './edge';
import { matchGames, type MatchReport } from './matcher';
import { buildConsensus } from './odds';
import { simulateGame, type SimOutput } from './sim';
import { LEAGUE_SEEDS, NORMAL_CONSTANTS, SIM_RUNS, STALE_HOURS } from './sports';
import type { Consensus, KalshiGame, MarketKind, OddsEvent, PricedContract, PricedGame, SimSummary, Sport } from './types';

export interface OddsBatch {
  sportKey: string;
  fetchedAt: string;
  events: OddsEvent[];
}

export interface PipelineInput {
  sport: Sport;
  games: KalshiGame[];
  odds: OddsBatch[]; // every cached odds batch for this sport
  now?: Date;
  runs?: number;
  /** Games starting later than this many hours from now are listed but not simulated (saves most of the phone's CPU). */
  horizonHours?: number;
  /** Optional cache of simulations keyed by game + consensus, so price-only updates skip re-simulating. */
  simCache?: Map<string, SimOutput>;
}

export interface PipelineOutput {
  sport: Sport;
  computedAt: string;
  games: PricedGame[];
  report: MatchReport;
}

/** Which odds batches a Kalshi league is allowed to match against ("same league" rule). */
export function batchesForLeague(league: string, odds: OddsBatch[]): OddsBatch[] {
  const seed = LEAGUE_SEEDS.find((s) => s.prefix === league);
  if (!seed) return [];
  if (seed.sport === 'tennis') {
    const tour = league === 'KXWTA' ? 'tennis_wta' : 'tennis_atp';
    return odds.filter((b) => b.sportKey.startsWith(tour));
  }
  // Kalshi lists FCS games under the FBS series too, so college football matches against both feeds.
  if (seed.sport === 'ncaaf') return odds.filter((b) => b.sportKey.startsWith('americanfootball_ncaaf'));
  return odds.filter((b) => b.sportKey === seed.oddsKey);
}

export const FIT_TOLERANCE = { ml: 0.01, spread: 0.02, total: 0.02 };

/** How closely the calibrated sim reproduces the consensus anchors. */
export function fitDiagnostics(c: Consensus, s: SimSummary): NonNullable<PricedGame['fit']> {
  const simMl = c.pDraw !== undefined ? s.pHomeWin : s.pHomeWin / Math.max(s.pHomeWin + s.pAwayWin, 1e-9);
  const tgt = c.pDraw !== undefined ? c.pHome : c.pHome / (c.pHome + c.pAway);
  const ml = Math.abs(simMl - tgt);
  const spread = c.pHomeCover !== undefined && s.pHomeCoverMain !== undefined ? Math.abs(s.pHomeCoverMain - c.pHomeCover) : undefined;
  const total = c.pOver !== undefined && s.pOverMain !== undefined ? Math.abs(s.pOverMain - c.pOver) : undefined;
  const fitMiss: MarketKind[] = [];
  if (ml > FIT_TOLERANCE.ml) fitMiss.push('winner');
  if (spread !== undefined && spread > FIT_TOLERANCE.spread) fitMiss.push('spread');
  if (total !== undefined && total > FIT_TOLERANCE.total) fitMiss.push('total');
  return { ml, spread, total, fitMiss };
}

/** Run the full v1 pipeline for one sport. Pure: same input -> same output. */
export function runPipeline(input: PipelineInput): PipelineOutput {
  const now = input.now ?? new Date();
  const out: PricedGame[] = [];
  const report: MatchReport = { matches: [], unmatchedKalshi: [], unmatchedOdds: [] };

  const byLeague = new Map<string, KalshiGame[]>();
  for (const g of input.games) byLeague.set(g.league, [...(byLeague.get(g.league) ?? []), g]);

  for (const [league, games] of byLeague) {
    const batches = batchesForLeague(league, input.odds);
    const events = batches.flatMap((b) => b.events);
    const fetchedAt = new Map<string, string>();
    for (const b of batches) for (const e of b.events) fetchedAt.set(e.id, b.fetchedAt);
    const rep = matchGames(input.sport, games, events);
    report.matches.push(...rep.matches);
    report.unmatchedKalshi.push(...rep.unmatchedKalshi);
    report.unmatchedOdds.push(...rep.unmatchedOdds);
    const matchById = new Map(rep.matches.map((m) => [m.game.id, m]));

    for (const g of games) {
      const started = Date.parse(g.startTime) <= now.getTime();
      const m = matchById.get(g.id);
      if (!m) {
        const why = rep.unmatchedKalshi.find((u) => u.gameId === g.id)?.reason ?? 'no sportsbook match';
        out.push({ game: g, status: 'unpriced', unpricedReason: why, stale: false, contracts: [] });
        continue;
      }
      if (input.horizonHours !== undefined && Date.parse(g.startTime) - now.getTime() > input.horizonHours * 3600e3) {
        const days = Math.round(input.horizonHours / 24);
        out.push({ game: g, status: 'unpriced', unpricedReason: `starts more than ${days} days from now; priced closer to game time`, oddsEventId: m.event.id, homeCode: m.homeCode, awayCode: m.awayCode, homeName: m.event.home_team, awayName: m.event.away_team, stale: false, contracts: [] });
        continue;
      }
      const cons = buildConsensus(m.event, input.sport === 'soccer', (NORMAL_CONSTANTS as Record<string, { sigmaFallback: number }>)[input.sport]?.sigmaFallback);
      if (!cons) {
        out.push({ game: g, status: 'unpriced', unpricedReason: 'sportsbooks list no moneyline or spread for this game yet', oddsEventId: m.event.id, stale: false, contracts: [] });
        continue;
      }
      const fAt = fetchedAt.get(m.event.id) ?? cons.lastUpdate;
      const stale = now.getTime() - Date.parse(fAt) > STALE_HOURS * 3600e3;
      const cacheKey = `${g.id}|${input.runs ?? SIM_RUNS}|${g.bestOf ?? ''}|${JSON.stringify([cons.pHome, cons.pAway, cons.pDraw, cons.spreadLine, cons.pHomeCover, cons.totalLine, cons.pOver])}`;
      let sim = input.simCache?.get(cacheKey);
      if (!sim) {
        sim = simulateGame(input.sport, cons, {
          gameKey: g.id,
          runs: input.runs ?? SIM_RUNS,
          competition: g.competition,
          bestOf: g.bestOf,
          tour: league === 'KXWTA' ? 'WTA' : 'ATP',
        });
        input.simCache?.set(cacheKey, sim);
      }
      const sideOf = (code?: string): Side | undefined => (code === m.homeCode ? 'home' : code === m.awayCode ? 'away' : undefined);
      const nameOf = (code?: string) => (code === m.homeCode ? m.event.home_team : code === m.awayCode ? m.event.away_team : code ?? '?');
      const fit = fitDiagnostics(cons, sim.summary);
      const fitMiss = new Set<string>(fit.fitMiss);
      const contracts: PricedContract[] = [];
      for (const c of g.contracts) {
        // Totals with no sportsbook total have no anchor in the normal/Poisson models: skip, never guess.
        if (c.kind === 'total' && cons.totalLine === undefined && input.sport !== 'tennis') continue;
        const pc = priceContract(input.sport, c, sim.runs, cons, sideOf, nameOf, !started, fitMiss);
        if (pc) contracts.push(pc);
      }
      markSuspectQuotes(contracts);
      out.push({
        game: g,
        status: started ? 'started' : 'priced',
        oddsEventId: m.event.id,
        homeCode: m.homeCode,
        awayCode: m.awayCode,
        homeName: m.event.home_team,
        awayName: m.event.away_team,
        consensus: cons,
        sim: sim.summary,
        fit,
        oddsFetchedAt: fAt,
        stale,
        contracts,
      });
    }
  }
  out.sort((a, b) => a.game.startTime.localeCompare(b.game.startTime));
  return { sport: input.sport, computedAt: now.toISOString(), games: out, report };
}

/** Plain-words label for one side of a contract. */
export function plainSide(pc: PricedContract, side: 'yes' | 'no'): string {
  const c = pc.contract;
  const k = c.floorStrike ?? c.capStrike;
  if (c.kind === 'total') return c.strikeType === 'greater' ? `${side === 'yes' ? 'Over' : 'Under'} ${k}` : side === 'yes' ? pc.description : `Not ${pc.description}`;
  if (c.kind === 'tie') return side === 'yes' ? 'Tie / draw' : 'No tie / draw';
  const d = pc.description;
  if (c.kind === 'winner') return d.replace(/ win$/, side === 'yes' ? ' to win' : ' not to win');
  return d.replace(' by >', side === 'yes' ? ' to win by more than ' : ' not to win by more than ');
}

export interface ValueRow {
  gameId: string;
  sport: Sport;
  game: string;
  startTime: string;
  ticker: string;
  eventTicker: string;
  description: string;
  /** The same bet in plain words for the side shown, e.g. "Under 45.5", "Bears do not win". */
  plain: string;
  kind: PricedContract['contract']['kind'];
  tier: PricedContract['tier'];
  side: 'yes' | 'no';
  prob: number;
  ask: number;
  fee: number;
  edge: number;
  size: number;
  stale: boolean;
}

/** Flatten priced games into the ranked +EV list (value flags only), best edge first. */
export function valueRows(games: PricedGame[], now?: number): ValueRow[] {
  const rows: ValueRow[] = [];
  for (const g of games) {
    if (g.status !== 'priced') continue;
    // Results can be shown long after they were computed (offline, restored from storage): never list a game that has started since.
    if (now !== undefined && Date.parse(g.game.startTime) <= now) continue;
    const stale = g.stale || (now !== undefined && !!g.oddsFetchedAt && now - Date.parse(g.oddsFetchedAt) > STALE_HOURS * 3600e3);
    for (const pc of g.contracts) {
      for (const s of [pc.yes, pc.no]) {
        if (!s.value || s.edge === null || s.ask === null) continue;
        rows.push({
          gameId: g.game.id,
          sport: g.game.sport,
          game: `${g.awayName} @ ${g.homeName}`,
          startTime: g.game.startTime,
          ticker: pc.contract.ticker,
          eventTicker: pc.contract.eventTicker,
          description: s.side === 'yes' ? pc.description : `NOT ${pc.description}`,
          plain: plainSide(pc, s.side),
          kind: pc.contract.kind,
          tier: pc.tier,
          side: s.side,
          prob: s.prob,
          ask: s.ask,
          fee: s.fee,
          edge: s.edge,
          size: s.size,
          stale,
        });
      }
    }
  }
  return rows.sort((a, b) => b.edge - a.edge);
}
