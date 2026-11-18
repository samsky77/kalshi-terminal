/**
 * Backtests (spec §7). Everything here is labelled "Backtest (simulated)" and stored in
 * backtest_runs — never mixed with the live record.
 *  - Accuracy: replay past results walking forward (ratings rebuilt weekly from games strictly
 *    before each week: no look-ahead). Brier, log loss, calibration of the home-win probability.
 *  - Price: only where free historical odds exist (NFL closing lines from nflverse). Bets are
 *    placed at the closing price, so CLV is 0 by construction and is not reported.
 */
import {
  blendFair, brier, calibrationBuckets, expectedValue, gradePick, logLoss, noVigMultiplicative, priceSelection, profitUnits,
  seedFrom, simulateGame, stakeUnits, SPORT_DEFS, W_DEFAULT, gradeBet, type Forecast, type Selection, type SportId,
} from '@sigmaline/core';
import { currentModel, getEvents, normTeam, type EventRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { fitRatings, toResults } from './simulate';
import { predictGoals, predictPoints } from '@sigmaline/core';

export interface BacktestOutput {
  sport: SportId;
  accuracy: { games: number; brier: number; logLoss: number; buckets: ReturnType<typeof calibrationBuckets>; marketBrier?: number } | null;
  price: { games: number; gamesWithOdds: number; bets: number; units: number; roi: number; curve: { t: string; units: number }[] } | null;
}

export async function runBacktest(ctx: Ctx, sport: SportId, opts: { fromDate?: string; nSims?: number; w?: number } = {}): Promise<BacktestOutput> {
  const def = SPORT_DEFS[sport];
  const all = (await getEvents(ctx.db, { sport, status: ['final'] })).filter((e) => e.home_score !== null);
  if (all.length < 50 || sport === 'tennis') return { sport, accuracy: null, price: null };
  const results = toResults(all);
  const start = opts.fromDate ?? all[Math.floor(all.length * 0.25)].commence_time; // first quarter warms the ratings up
  const test = all.filter((e) => e.commence_time >= start);
  const nSims = opts.nSims ?? 10000;
  const w = opts.w ?? (await currentModel(ctx.db, sport)).params.w.ml;
  const fc: Forecast[] = [], mkt: Forecast[] = [];
  let bets = 0, units = 0, staked = 0, withOdds = 0;
  const curve: { t: string; units: number }[] = [];
  // Weekly walk-forward refits
  let weekKey = '', ratings: ReturnType<typeof fitRatings> | null = null;
  for (const e of test) {
    const wk = e.commence_time.slice(0, 10).replace(/-\d\d$/, '') + `-${Math.floor(Number(e.commence_time.slice(8, 10)) / 7)}`;
    if (wk !== weekKey) {
      const asOf = new Date(Date.parse(e.commence_time) - 3600000).toISOString();
      ratings = fitRatings(sport, results.filter((r) => r.date < asOf), asOf, def.halfLifeDays);
      weekKey = wk;
    }
    const h = normTeam(e.home, sport), a = normTeam(e.away, sport);
    if (!ratings || ratings.kind === 'elo') continue;
    const g = ratings.r.games;
    if ((g[h] ?? 0) < def.minGames || (g[a] ?? 0) < def.minGames) continue;
    const expect = ratings.kind === 'points' ? predictPoints(ratings.r, h, a, !!e.meta?.neutral) : predictGoals(ratings.r, h, a, !!e.meta?.neutral);
    const sim = simulateGame({ sport, expect, seed: seedFrom(e.id), n: nSims }).samples;
    const mlH = priceSelection(sim, { market: 'ml', side: 'home' }, sport);
    const y = (e.winner === 1 ? 1 : 0) as 0 | 1;
    fc.push({ p: mlH.win, y });
    // Price backtest where closing odds exist
    const close = (e.meta as any)?.close;
    if (close?.homeMlDec && close?.awayMlDec) {
      withOdds++;
      const [ph] = noVigMultiplicative([close.homeMlDec, close.awayMlDec]);
      mkt.push({ p: ph, y });
      const cands: { sel: Selection; dec: number; cons: number }[] = [];
      cands.push({ sel: { market: 'ml', side: 'home' }, dec: close.homeMlDec, cons: ph });
      cands.push({ sel: { market: 'ml', side: 'away' }, dec: close.awayMlDec, cons: 1 - ph });
      if (close.spreadLine !== null && close.homeSpreadDec && close.awaySpreadDec) {
        const [ps] = noVigMultiplicative([close.homeSpreadDec, close.awaySpreadDec]);
        cands.push({ sel: { market: 'spread', side: 'home', line: close.spreadLine }, dec: close.homeSpreadDec, cons: ps });
        cands.push({ sel: { market: 'spread', side: 'away', line: -close.spreadLine }, dec: close.awaySpreadDec, cons: 1 - ps });
      }
      if (close.totalLine !== null && close.overDec && close.underDec) {
        const [po] = noVigMultiplicative([close.overDec, close.underDec]);
        cands.push({ sel: { market: 'total', side: 'over', line: close.totalLine }, dec: close.overDec, cons: po });
        cands.push({ sel: { market: 'total', side: 'under', line: close.totalLine }, dec: close.underDec, cons: 1 - po });
      }
      for (const c of cands) {
        const model = priceSelection(sim, c.sel, sport);
        const fair = blendFair(model, c.cons, w);
        const ev = expectedValue(fair, c.dec);
        const grade = gradePick(ev, expectedValue(model, c.dec), expectedValue({ win: c.cons * (1 - model.push), push: model.push, loss: (1 - c.cons) * (1 - model.push) }, c.dec), ctx.settings.thresholds);
        if (grade === 'none') continue;
        const stake = stakeUnits(grade);
        const res = gradeBet(c.sel, sport, { home: Number(e.home_score), away: Number(e.away_score), winner: (e.winner ?? 0) as 1 | -1 | 0 });
        const pu = profitUnits(res, stake, c.dec);
        bets++; units += pu; if (res !== 'void') staked += stake;
        curve.push({ t: e.commence_time, units: Math.round(units * 100) / 100 });
      }
    }
  }
  const out: BacktestOutput = {
    sport,
    accuracy: fc.length ? { games: fc.length, brier: brier(fc), logLoss: logLoss(fc), buckets: calibrationBuckets(fc), marketBrier: mkt.length ? brier(mkt) : undefined } : null,
    price: withOdds ? { games: fc.length, gamesWithOdds: withOdds, bets, units: Math.round(units * 100) / 100, roi: staked ? units / staked : 0, curve: thin(curve, 200) } : null,
  };
  return out;
}

function thin<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.min(xs.length - 1, Math.floor(i * step))]).concat(xs.length ? [xs[xs.length - 1]] : []);
}

export async function saveBacktest(ctx: Ctx, b: BacktestOutput, source: string, events: EventRow[] = []): Promise<void> {
  const dates = events.map((e) => e.commence_time).sort();
  if (b.accuracy) {
    await ctx.db.insert('backtest_runs', {
      label: 'Backtest (simulated)', sport: b.sport, kind: 'accuracy', from_date: dates[0]?.slice(0, 10) ?? null, to_date: dates[dates.length - 1]?.slice(0, 10) ?? null,
      games: b.accuracy.games, games_with_odds: b.price?.gamesWithOdds ?? 0, metrics: b.accuracy, curve: null, source, created_at: ctx.now().toISOString(),
    });
    await ctx.db.insert('calibration_reports', {
      kind: 'backtest', sport: b.sport, market: 'ml', window_days: 0, n: b.accuracy.games, brier: b.accuracy.brier, log_loss: b.accuracy.logLoss,
      buckets: b.accuracy.buckets, avg_clv: null, roi: b.price?.roi ?? null, model_version: null, created_at: ctx.now().toISOString(),
    });
  }
  if (b.price) {
    await ctx.db.insert('backtest_runs', {
      label: 'Backtest (simulated)', sport: b.sport, kind: 'price', from_date: dates[0]?.slice(0, 10) ?? null, to_date: dates[dates.length - 1]?.slice(0, 10) ?? null,
      games: b.price.games, games_with_odds: b.price.gamesWithOdds, metrics: { bets: b.price.bets, units: b.price.units, roi: b.price.roi, note: 'Bets priced at closing lines; CLV not meaningful.' },
      curve: b.price.curve, source, created_at: ctx.now().toISOString(),
    });
  }
}
