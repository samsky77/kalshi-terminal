/**
 * Nightly self-improvement loop (spec §6). Runs after grading.
 *  1. Live calibration per sport and market over 30/90/365 days: Brier, log loss, 10 buckets,
 *     average CLV and ROI (from the live pick log).
 *  2. Retune blend weight w (±0.05 max, kept in [0.15, 0.6]) per sport and market, and the
 *     recency half-life (±5%), keeping a change only when held-out log loss improves.
 *  3. Every change is a new model_versions row; past picks keep the version that made them.
 */
import {
  brier, calibrationBuckets, conditionalWin, logLoss, normCdf, predictGoals, predictPoints, retuneHalfLife, retuneW, SPORT_DEFS, SPORTS,
  type BlendObs, type DistSummary, type Forecast, type MarketAnchor, type SportId,
} from '@sigmaline/core';
import { allPicks, currentModel, getEvents, normTeam, saveModelVersion, type PickResultRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { pruneSnapshots } from './tick';
import { fitRatings, toResults } from './simulate';

interface SimRunRow { event_id: string; model_version: string; summary: DistSummary; inputs: { source: string; anchor: MarketAnchor; snapshot?: { kind: string } }; created_at: string }

/** Probability the home side covers `line` (home perspective) from the stored margin pmf, no-push scale. */
function coverFromPmf(d: DistSummary, homeLine: number): number {
  let w = 0, l = 0;
  d.margin.counts.forEach((c, i) => { const m = d.margin.min + i + homeLine; if (m > 0) w += c; else if (m < 0) l += c; });
  return w + l ? w / (w + l) : NaN;
}
function overFromPmf(d: DistSummary, line: number): number {
  let o = 0, u = 0;
  d.total.counts.forEach((c, i) => { const t = d.total.min + i; if (t > line) o += c; else if (t < line) u += c; });
  return o + u ? o / (o + u) : NaN;
}

/** Last pre-game simulation per final event, where the model came from ratings (not the market fallback). */
async function observations(ctx: Ctx, sport: SportId, days: number) {
  const evs = (await getEvents(ctx.db, { sport, from: new Date(ctx.now().getTime() - days * 86400000).toISOString(), to: ctx.now().toISOString(), status: ['final'] })).filter((e) => e.source === 'live');
  const out: { ml: BlendObs[]; spread: BlendObs[]; total: BlendObs[] } = { ml: [], spread: [], total: [] };
  for (const e of evs) {
    const runs = await ctx.db.select<SimRunRow>('sim_runs', { eq: { event_id: e.id }, lt: { created_at: e.commence_time }, order: [{ col: 'created_at', asc: false }], limit: 1 });
    const r = runs[0];
    if (!r || r.inputs.source !== 'ratings') continue;
    const a = r.inputs.anchor, d = r.summary, hs = Number(e.home_score), as = Number(e.away_score);
    if (a.pHomeMl !== undefined && e.winner !== 0) out.ml.push({ pModel: d.homeWin / Math.max(1e-9, 1 - d.draw), pConsensus: sport === 'soccer' && a.pDraw !== undefined ? a.pHomeMl / (1 - a.pDraw) : a.pHomeMl, y: e.winner === 1 ? 1 : 0, date: e.commence_time });
    if (a.spreadLine !== undefined && a.pHomeCover !== undefined && hs - as + a.spreadLine !== 0) out.spread.push({ pModel: coverFromPmf(d, a.spreadLine), pConsensus: a.pHomeCover, y: hs - as + a.spreadLine > 0 ? 1 : 0, date: e.commence_time });
    if (a.totalLine !== undefined && a.pOver !== undefined && hs + as !== a.totalLine) out.total.push({ pModel: overFromPmf(d, a.totalLine), pConsensus: a.pOver, y: hs + as > a.totalLine ? 1 : 0, date: e.commence_time });
  }
  return out;
}

export async function nightly(ctx: Ctx): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  // Retention + space reclaim. VACUUM needs a direct Postgres connection (DATABASE_URL) and table
  // ownership; without it, autovacuum still makes the freed space reusable, so the DB stops growing.
  report.pruned = await pruneSnapshots(ctx);
  const raw = ctx.db as unknown as { exec?: (sql: string) => Promise<void> };
  if (raw.exec) {
    for (const t of ['odds_snapshots', 'market_prices', 'sim_runs']) {
      try { await raw.exec(`vacuum (analyze) ${t}`); } catch (err) { ctx.log(`vacuum ${t}: ${(err as Error).message}`); }
    }
  }
  const picks = await allPicks(ctx.db);
  const results = new Map((await ctx.db.select<PickResultRow>('pick_results')).map((r) => [r.pick_id, r]));
  for (const sport of SPORTS) {
    const sr: Record<string, unknown> = {};
    // 1. live calibration reports
    for (const win of [30, 90, 365]) {
      const obs = await observations(ctx, sport, win);
      for (const market of ['ml', 'spread', 'total'] as const) {
        const blendW = (await currentModel(ctx.db, sport)).params.w[market];
        const fc: Forecast[] = obs[market].map((o) => ({ p: blendW * o.pModel + (1 - blendW) * o.pConsensus, y: o.y }));
        const since = ctx.now().getTime() - win * 86400000;
        const mp = picks.filter((p) => p.sport === sport && p.market === market && Date.parse(p.commence_time) >= since);
        const graded = mp.map((p) => ({ p, r: results.get(p.id) })).filter((x) => x.r && x.r.result !== 'void');
        const clvs = graded.map((x) => x.r!.clv).filter((c): c is number => c !== null && c !== undefined).map(Number);
        const staked = graded.reduce((s, x) => s + Number(x.p.stake_units), 0);
        const units = graded.reduce((s, x) => s + Number(x.r!.profit_units), 0);
        if (!fc.length && !graded.length) continue;
        await ctx.db.insert('calibration_reports', {
          kind: 'live', sport, market, window_days: win, n: fc.length, brier: fc.length ? brier(fc) : null, log_loss: fc.length ? logLoss(fc) : null,
          buckets: fc.length ? calibrationBuckets(fc) : null, avg_clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
          roi: staked ? units / staked : null, model_version: (await currentModel(ctx.db, sport)).id, created_at: ctx.now().toISOString(),
        });
      }
    }
    // 2. retune w per market on the 365-day window
    const model = await currentModel(ctx.db, sport);
    const params = structuredClone(model.params);
    const changes: { param: string; old: number; new: number; before: number; after: number; n: number }[] = [];
    const obs = await observations(ctx, sport, 365);
    for (const market of ['ml', 'spread', 'total'] as const) {
      const r = retuneW(obs[market], params.w[market]);
      if (r.changed) { changes.push({ param: `w.${market}`, old: params.w[market], new: r.w, before: r.holdoutBefore, after: r.holdoutAfter, n: r.n }); params.w[market] = r.w; }
    }
    // retune the recency half-life on held-out results (last 30% of the past year of finals)
    if (sport !== 'tennis') {
      const fin = (await getEvents(ctx.db, { sport, from: new Date(ctx.now().getTime() - 3 * 365 * 86400000).toISOString(), to: ctx.now().toISOString(), status: ['final'] })).filter((e) => e.home_score !== null);
      const all = toResults(fin);
      const yearAgo = new Date(ctx.now().getTime() - 365 * 86400000).toISOString();
      const recent = fin.filter((e) => e.commence_time >= yearAgo && e.winner !== 0);
      const hold = recent.slice(Math.floor(recent.length * 0.7));
      if (hold.length >= 60) {
        const def = SPORT_DEFS[sport];
        const evalLoss = (hl: number) => {
          // one refit at the start of the hold-out window (fast, and strictly no look-ahead)
          const asOf = hold[0].commence_time;
          const rt = fitRatings(sport, all.filter((g) => g.date < asOf), asOf, hl);
          const fc: Forecast[] = [];
          for (const e of hold) {
            const h = normTeam(e.home, sport), a = normTeam(e.away, sport);
            if (rt.kind === 'elo') continue;
            if ((rt.r.games[h] ?? 0) < def.minGames || (rt.r.games[a] ?? 0) < def.minGames) continue;
            const ex = rt.kind === 'points' ? predictPoints(rt.r, h, a) : predictGoals(rt.r, h, a);
            const sd = sport === 'nba' ? 13.5 : sport === 'cbb' ? 11 : sport === 'nfl' ? 13.5 : sport === 'cfb' ? 16 : Math.sqrt(ex.home + ex.away);
            fc.push({ p: normCdf((ex.home - ex.away) / sd), y: e.winner === 1 ? 1 : 0 });
          }
          return fc.length >= 30 ? logLoss(fc) : Infinity;
        };
        const r = retuneHalfLife(params.halfLifeDays, evalLoss);
        if (r.changed && Number.isFinite(r.after)) { changes.push({ param: 'halfLifeDays', old: params.halfLifeDays, new: r.halfLife, before: r.before, after: r.after, n: hold.length }); params.halfLifeDays = r.halfLife; }
      }
    }
    if (changes.length) {
      const v = await saveModelVersion(ctx.db, sport, params, model.id, changes.map((c) => `${c.param} ${c.old}→${c.new}`).join('; '));
      for (const c of changes) {
        await ctx.db.insert('model_changes', { sport, param: c.param, old_value: c.old, new_value: c.new, holdout_before: Number.isFinite(c.before) ? c.before : null, holdout_after: Number.isFinite(c.after) ? c.after : null, n: c.n, model_version: v.id, created_at: ctx.now().toISOString() });
      }
      sr.newVersion = v.id;
    }
    sr.changes = changes;
    sr.obs = { ml: obs.ml.length, spread: obs.spread.length, total: obs.total.length };
    report[sport] = sr;
  }
  void conditionalWin;
  return report;
}
