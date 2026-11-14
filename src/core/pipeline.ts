import { priceContract, type Side } from './edge';
import { matchGames, type MatchReport } from './matcher';
import { buildConsensus } from './odds';
import { simulateGame, type SimOutput } from './sim';
import { LEAGUE_SEEDS, SIM_RUNS, STALE_HOURS } from './sports';
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
      const cons = buildConsensus(m.event, input.sport === 'soccer');
      if (!cons) {
        out.push({ game: g, status: 'unpriced', unpricedReason: 'sportsbooks list no usable moneyline', oddsEventId: m.event.id, stale: false, contracts: [] });
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

export interface ValueRow {
  gameId: string;
  sport: Sport;
  game: string;
  startTime: string;
  ticker: string;
  description: string;
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
export function valueRows(games: PricedGame[]): ValueRow[] {
  const rows: ValueRow[] = [];
  for (const g of games) {
    if (g.status !== 'priced') continue;
    for (const pc of g.contracts) {
      for (const s of [pc.yes, pc.no]) {
        if (!s.value || s.edge === null || s.ask === null) continue;
        rows.push({
          gameId: g.game.id,
          sport: g.game.sport,
          game: `${g.awayName} @ ${g.homeName}`,
          startTime: g.game.startTime,
          ticker: pc.contract.ticker,
          description: s.side === 'yes' ? pc.description : `NOT ${pc.description}`,
          kind: pc.contract.kind,
          tier: pc.tier,
          side: s.side,
          prob: s.prob,
          ask: s.ask,
          fee: s.fee,
          edge: s.edge,
          size: s.size,
          stale: g.stale,
        });
      }
    }
  }
  return rows.sort((a, b) => b.edge - a.edge);
}
