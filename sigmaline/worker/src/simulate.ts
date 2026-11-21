import {
  consensus, eloUpdate, eloWinProb, fitGoalsRatings, fitPointsRatings, mainLine, marketImpliedExpectation, noVig, predictGoals,
  predictPoints, priceMarkets, PROP_BETA, projectFromLogs, restAdjust, seedFrom, simulateGame, simulateProps, SPORT_DEFS, summarize,
  type Expectation, type GameResult, type GoalsRatings, type MarketAnchor, type MarketQuote, type PlayerProjection, type PointsRatings,
  type PricedSelection, type SimSamples, type SportId, type DistSummary, addCounts, filterFeed, GRADE_CONFIG,
} from '@sigmaline/core';
import { currentModel, getEvents, latestPull, normTeam, quoteFromSnapshot, type EventRow, type ModelVersion, type SnapshotRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { logEdges } from './edges';

// ── Ratings (cached per run) ────────────────────────────────────────────────
type Ratings = { kind: 'points'; r: PointsRatings } | { kind: 'goals'; r: GoalsRatings } | { kind: 'elo'; r: Record<string, { rating: number; n: number }> };
const ratingsCache = new Map<string, Ratings>();
export function clearRatingsCache() { ratingsCache.clear(); }

export async function finals(ctx: Ctx, sport: SportId, days: number, before?: Date): Promise<EventRow[]> {
  const end = before ?? ctx.now();
  return getEvents(ctx.db, { sport, from: new Date(end.getTime() - days * 86400000).toISOString(), to: end.toISOString(), status: ['final'] });
}

export function toResults(rows: EventRow[]): GameResult[] {
  return rows.filter((r) => r.home_score !== null && r.away_score !== null).map((r) => ({
    date: r.commence_time, home: normTeam(r.home, r.sport_id), away: normTeam(r.away, r.sport_id), homeScore: Number(r.home_score), awayScore: Number(r.away_score), neutral: !!r.meta?.neutral,
  }));
}

export function fitRatings(sport: SportId, results: GameResult[], asOf: string, halfLifeDays: number): Ratings {
  const def = SPORT_DEFS[sport];
  if (sport === 'tennis') {
    const elo: Record<string, { rating: number; n: number }> = {};
    for (const g of [...results].sort((a, b) => a.date.localeCompare(b.date))) {
      if (Date.parse(g.date) >= Date.parse(asOf)) continue;
      const a = (elo[g.home] ??= { rating: 1500, n: 0 }), b = (elo[g.away] ??= { rating: 1500, n: 0 });
      const [ra, rb] = eloUpdate(a.rating, b.rating, g.homeScore > g.awayScore, 32);
      a.rating = ra; b.rating = rb; a.n++; b.n++;
    }
    return { kind: 'elo', r: elo };
  }
  if (sport === 'nhl' || sport === 'soccer') return { kind: 'goals', r: fitGoalsRatings(results, { asOf, halfLifeDays, ridge: def.ridge, hfaPrior: def.hfaPrior }) };
  return { kind: 'points', r: fitPointsRatings(results, { asOf, halfLifeDays, ridge: def.ridge, hfaPrior: def.hfaPrior }) };
}

async function ratingsFor(ctx: Ctx, sport: SportId, model: ModelVersion): Promise<Ratings> {
  const key = `${sport}:${model.id}`;
  const hit = ratingsCache.get(key);
  if (hit) return hit;
  const days = Math.min(1500, Math.ceil(model.params.halfLifeDays * 6));
  const r = fitRatings(sport, toResults(await finals(ctx, sport, days)), ctx.now().toISOString(), model.params.halfLifeDays);
  ratingsCache.set(key, r);
  return r;
}

// ── Market anchor from a snapshot ───────────────────────────────────────────
export function anchorFrom(quotes: MarketQuote[], threeWay: boolean): MarketAnchor {
  const a: MarketAnchor = {};
  const ml = quotes.filter((q) => q.market === 'ml' && q.prices.home && q.prices.away && (!threeWay || q.prices.draw));
  const c = consensus(ml.map((q) => ({ book: q.book, prices: threeWay ? [q.prices.home!, q.prices.away!, q.prices.draw!] : [q.prices.home!, q.prices.away!] })));
  if (c) { a.pHomeMl = c.probs[0]; if (threeWay) a.pDraw = c.probs[2]; }
  const sl = mainLine(quotes, 'spread');
  if (sl !== undefined) {
    const s = consensus(quotes.filter((q) => q.market === 'spread' && q.line === sl && q.prices.home && q.prices.away).map((q) => ({ book: q.book, prices: [q.prices.home!, q.prices.away!] })));
    if (s) { a.spreadLine = sl; a.pHomeCover = s.probs[0]; }
  }
  const tl = mainLine(quotes, 'total');
  if (tl !== undefined) {
    const t = consensus(quotes.filter((q) => q.market === 'total' && q.line === tl && q.prices.over && q.prices.under).map((q) => ({ book: q.book, prices: [q.prices.over!, q.prices.under!] })));
    if (t) { a.totalLine = tl; a.pOver = t.probs[0]; }
  }
  return a;
}

/** Calendar days since each team's previous game (from stored events). */
export async function restDays(ctx: Ctx, e: EventRow): Promise<{ home?: number; away?: number }> {
  const prev = await getEvents(ctx.db, { sport: e.sport_id, from: new Date(Date.parse(e.commence_time) - 10 * 86400000).toISOString(), to: e.commence_time });
  const last = (team: string) => {
    const t = normTeam(team, e.sport_id);
    const g = prev.filter((p) => p.id !== e.id && (normTeam(p.home, e.sport_id) === t || normTeam(p.away, e.sport_id) === t)).map((p) => Date.parse(p.commence_time));
    if (!g.length) return undefined;
    return Math.max(0, Math.floor((Date.parse(e.commence_time) - Math.max(...g)) / 86400000) - 0);
  };
  // "0" = played yesterday (back-to-back)
  const h = last(e.home), a = last(e.away);
  return { home: h === undefined ? undefined : Math.max(0, h - 1), away: a === undefined ? undefined : Math.max(0, a - 1) };
}

export interface SimResult {
  event: EventRow;
  model: ModelVersion;
  seed: number;
  samples: SimSamples;
  summary: DistSummary;
  priced: PricedSelection[];
  expectation: Expectation | null;
  expectationSource: 'ratings' | 'market' | 'tennis-elo' | 'tennis-market';
  anchor: MarketAnchor;
  snapshot: { pulledAt: string; kind: string; books: number; providers: string[] };
  rest: { home?: number; away?: number };
  params: Record<string, unknown>;
  propsUsed: number;
}

const STAT_KEYS: Record<string, string[]> = {
  player_points: ['points', 'pts'], player_rebounds: ['rebounds', 'reb', 'total_rebounds'], player_assists: ['assists', 'ast'],
  player_threes: ['three_pointers_made', 'threes', 'fg3m', '3pm'], player_pass_yds: ['passing_yards', 'pass_yds'],
  player_rush_yds: ['rushing_yards', 'rush_yds'], player_reception_yds: ['receiving_yards', 'rec_yds'], player_receptions: ['receptions', 'rec'],
  player_pass_tds: ['passing_touchdowns', 'pass_tds', 'passing_tds'],
};
export function statValue(stat: string, stats: Record<string, number>): number | undefined {
  if (stat === 'player_points_rebounds_assists') {
    const p = statValue('player_points', stats), r = statValue('player_rebounds', stats), a = statValue('player_assists', stats);
    return p !== undefined && r !== undefined && a !== undefined ? p + r + a : undefined;
  }
  for (const k of STAT_KEYS[stat] ?? []) if (typeof stats[k] === 'number') return stats[k];
  return undefined;
}

/** Simulate one event from its latest (or a given kind of) snapshot and price every market. */
export async function simulateEvent(ctx: Ctx, e: EventRow, kind?: SnapshotRow['kind']): Promise<SimResult | null> {
  const pull = await latestPull(ctx.db, e.id, kind);
  if (!pull.snapshots.length) return null;
  const sport = e.sport_id;
  const def = SPORT_DEFS[sport];
  const model = await currentModel(ctx.db, sport);
  const quotes = pull.snapshots.map(quoteFromSnapshot);
  const gameQuotes = quotes.filter((q) => q.market !== 'prop');
  const anchor = anchorFrom(gameQuotes, def.threeWay);
  const seed = seedFrom(`${e.id}|${model.id}|${pull.pulledAt}`);
  const rest = await restDays(ctx, e);
  let expectation: Expectation | null = null;
  let source: SimResult['expectationSource'] = 'market';
  let sim;
  if (sport === 'tennis') {
    const r = await ratingsFor(ctx, sport, model);
    let modelWinProb: number | undefined;
    if (r.kind === 'elo') {
      const a = r.r[normTeam(e.home, sport)], b = r.r[normTeam(e.away, sport)];
      if (a && b && a.n >= def.minGames && b.n >= def.minGames) { modelWinProb = eloWinProb(a.rating, b.rating); source = 'tennis-elo'; }
      else source = 'tennis-market';
    }
    if (anchor.pHomeMl === undefined && modelWinProb === undefined) return null;
    const meta = e.meta as { tour?: 'atp' | 'wta'; bestOf?: 3 | 5; slam?: boolean };
    sim = simulateGame({ sport, seed, n: model.params.nSims, tennis: { tour: meta.tour ?? 'atp', bestOf: meta.bestOf ?? 3, slam: !!meta.slam, modelWinProb, anchor } });
  } else {
    const r = await ratingsFor(ctx, sport, model);
    const h = normTeam(e.home, sport), a = normTeam(e.away, sport);
    const gamesOf = (t: string) => (r.kind === 'points' || r.kind === 'goals' ? r.r.games[t] ?? 0 : 0);
    if (gamesOf(h) >= def.minGames && gamesOf(a) >= def.minGames) {
      expectation = r.kind === 'points' ? predictPoints(r.r, h, a, !!e.meta?.neutral) : r.kind === 'goals' ? predictGoals(r.r, h, a, !!e.meta?.neutral) : null;
      if (expectation) source = 'ratings';
    }
    if (!expectation) expectation = marketImpliedExpectation(sport, anchor);
    if (!expectation) return null;
    const goals = sport === 'nhl' || sport === 'soccer';
    const adj = (d: number | undefined) => restAdjust(sport, d);
    expectation = goals
      ? { home: Math.max(0.2, expectation.home + adj(rest.home)), away: Math.max(0.2, expectation.away + adj(rest.away)) }
      : { home: expectation.home + adj(rest.home), away: expectation.away + adj(rest.away) };
    sim = simulateGame({ sport, seed, n: model.params.nSims, expect: expectation });
  }
  // Props: NBA/NFL behind flags, simulated together with the game.
  let propsUsed = 0;
  const propQuotes = quotes.filter((q) => q.market === 'prop');
  if (propQuotes.length && def.propsFlag && ctx.env[def.propsFlag] === 'true' && expectation) {
    const players = new Map<string, PlayerProjection>();
    for (const q of propQuotes) {
      const k = `${q.player}|${q.stat}`;
      if (players.has(k) || !q.player || !q.stat) continue;
      const logs = await ctx.db.select<{ value: number; minutes: number | null; game_date: string; team: string | null }>('player_logs', { eq: { sport, player: q.player, stat: q.stat }, order: [{ col: 'game_date', asc: false }], limit: 25 });
      const proj = projectFromLogs(logs.map((l) => ({ value: Number(l.value), minutes: l.minutes ?? undefined, daysAgo: (ctx.now().getTime() - Date.parse(l.game_date)) / 86400000 })), { halfLifeDays: 30 });
      if (!proj) continue;
      const lt = logs[0]?.team ? normTeam(logs[0].team) : '';
      const team = lt && lt === normTeam(e.home) ? 'home' : lt && lt === normTeam(e.away) ? 'away' : null;
      if (!team) continue; // can't place the player on a side: skip rather than guess
      players.set(k, { player: q.player, stat: q.stat, team, mean: proj.mean, dispersion: proj.dispersion, beta: PROP_BETA[q.stat] ?? 0.7 });
    }
    if (players.size) { simulateProps(sim.samples, [...players.values()], expectation.home, expectation.away, seed); propsUsed = players.size; }
  }
  const marketOnly = source === 'market' || source === 'tennis-market';
  const priced = priceMarkets(sim.samples, quotes, { sport, threeWay: def.threeWay, bettable: new Set(ctx.settings.bettableBooks), w: model.params.w, thresholds: ctx.settings.thresholds, marketOnly });
  const books = new Set(gameQuotes.map((q) => q.book)).size;
  return {
    event: e, model, seed, samples: sim.samples, summary: summarize(sim.samples), priced, expectation, expectationSource: source, anchor,
    snapshot: { pulledAt: pull.pulledAt!, kind: pull.kind!, books, providers: [...new Set(pull.snapshots.map((s) => s.provider))] },
    rest, params: sim.params, propsUsed,
  };
}

/**
 * Persist a simulation: one sim_runs row, the price board (market_prices) and the edge log.
 * Every priced row goes through the feed filter first (item 8): rows with no price / no fair price,
 * started events and duplicates are hidden; |edge| over the sanity cap goes to data_anomalies; stale
 * prices stay on the board ungraded. Fresh graded rows are logged to edges_log (item 5).
 */
export async function saveSim(ctx: Ctx, s: SimResult): Promise<number> {
  const run = await ctx.db.insertReturning<{ id: number }>('sim_runs', {
    event_id: s.event.id, model_version: s.model.id, seed: s.seed, n_sims: s.samples.n,
    inputs: { expectation: s.expectation, source: s.expectationSource, anchor: s.anchor, rest: s.rest, params: s.params, snapshot: s.snapshot, propsUsed: s.propsUsed },
    summary: s.summary, histogram: null, snapshot_ts: s.snapshot.pulledAt, created_at: ctx.now().toISOString(),
  });
  const f = filterFeed(s.priced, { nowMs: ctx.now().getTime(), commenceMs: Date.parse(s.event.commence_time) });
  ctx.feedStats.rowsIn += s.priced.length;
  ctx.feedStats.rowsKept += f.keep.length;
  ctx.feedStats.counts = addCounts(ctx.feedStats.counts, f.counts);
  const board = [...f.keep, ...f.stale];
  const rows = board.map((p) => ({
    event_id: s.event.id, selection_key: p.key, sim_run_id: Number(run.id), market: p.selection.market, selection: p.selection,
    line: p.selection.line ?? null, fair_decimal: fin(p.fairDecimal), fair_probs: p.fair, model_probs: p.model, consensus_p: fin(p.consensusP),
    best_decimal: fin(p.bestDecimal), best_book: p.bestBook, books: p.books, ev: fin(p.ev), model_ev: fin(p.modelEv), consensus_ev: fin(p.consensusEv),
    grade: p.grade, snapshot_ts: s.snapshot.pulledAt, price_ts: p.bestTs, fair_source: p.fairSource, updated_at: ctx.now().toISOString(),
  }));
  if (rows.length) await ctx.db.upsert('market_prices', rows, 'event_id,selection_key');
  if (f.anomalies.length) {
    await ctx.db.insert('data_anomalies', f.anomalies.map((p) => ({
      detected_at: ctx.now().toISOString(), sport: s.event.sport_id, event_id: s.event.id, market: p.selection.market, selection: p.key,
      line: p.selection.line ?? null, book: p.bestBook, price: fin(p.bestDecimal), fair_price: fin(p.fairDecimal), edge_pct: fin(p.ev), books: p.books,
      price_ts: p.bestTs, reason: `|edge| ${(Math.abs(p.ev) * 100).toFixed(1)}% above the ${GRADE_CONFIG.sanityCap * 100}% sanity cap`,
    })));
  }
  try { await logEdges(ctx, s.event, s.model.id, f.keep); } catch (err) { ctx.log(`edge log failed ${s.event.id}: ${(err as Error).message}`); }
  return Number(run.id);
}

const fin = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

/** No-vig consensus for one selection in a snapshot (for closing lines). */
export function selectionConsensus(quotes: MarketQuote[], market: string, line: number | undefined, side: string, threeWay: boolean, player?: string, stat?: string): { p: number; books: number; best: number; bestBook: string | null } | null {
  const lineOf = (q: MarketQuote) => q.line;
  const target = market === 'spread' && line !== undefined ? (side === 'home' ? line : -line) : line;
  // One quote per book: the latest (two providers, or two pulls in one snapshot, must not double-count).
  const latest = new Map<string, MarketQuote>();
  for (const q of quotes) {
    if (q.market !== market || (market !== 'ml' && lineOf(q) !== target) || (market === 'prop' && (q.player !== player || q.stat !== stat))) continue;
    const prev = latest.get(q.book);
    if (!prev || prev.ts < q.ts) latest.set(q.book, q);
  }
  const qs = [...latest.values()];
  const sides = market === 'ml' ? (threeWay ? ['home', 'away', 'draw'] : ['home', 'away']) : market === 'spread' ? ['home', 'away'] : ['over', 'under'];
  const full = qs.filter((q) => sides.every((s) => (q.prices as any)[s] > 1));
  if (!full.length) return null;
  const c = consensus(full.map((q) => ({ book: q.book, prices: sides.map((s) => (q.prices as any)[s]) })));
  if (!c) return null;
  let best = NaN, bestBook: string | null = null;
  for (const q of qs) { const d = (q.prices as any)[side]; if (d > 1 && !(d <= best)) { best = d; bestBook = q.book; } }
  return { p: c.probs[sides.indexOf(side)], books: full.length, best, bestBook };
}

export { noVig };
