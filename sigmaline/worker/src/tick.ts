import { planTick, SPORT_DEFS, SPORTS, type SportId } from '@sigmaline/core';
import { getEvents, type EventRow, type PickRow } from '@sigmaline/db';
import { sendAlerts } from './alerts';
import { mayPull, recordUsage, type Ctx } from './context';
import { captureClosing, gradePicks, ingestPropResults, ingestScores } from './grade';
import { leagueRefs, pullOdds, pullProps } from './ingest';
import { publishDue } from './publish';
import { closeEdges, settleEdges } from './edges';
import { buildFeedCache } from './feedcache';
import { clearRatingsCache, saveSim, simulateEvent, statValue } from './simulate';

const PROP_MARKETS: Partial<Record<SportId, string[]>> = {
  nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'],
  nfl: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions'],
};

async function lastRefreshByLeague(ctx: Ctx): Promise<Record<string, string | undefined>> {
  const rows = await ctx.db.select<{ value: Record<string, string> }>('settings', { eq: { key: 'last_refresh' }, limit: 1 });
  return rows[0]?.value ?? {};
}

async function saveLastRefresh(ctx: Ctx, m: Record<string, string | undefined>) {
  await ctx.db.upsert('settings', { key: 'last_refresh', value: m, updated_at: ctx.now().toISOString() }, 'key');
}

/** Has the event got a snapshot of this kind? */
async function hasKind(ctx: Ctx, eventId: string, kind: string): Promise<boolean> {
  return (await ctx.db.select('odds_snapshots', { eq: { event_id: eventId, kind }, limit: 1 })).length > 0;
}

/** Daily: refresh injuries (PropLine) for sports with games in the next 36 hours. */
async function refreshInjuries(ctx: Ctx, sports: SportId[]): Promise<void> {
  const prov = ctx.providers.propline;
  if (!prov.enabled || !prov.getInjuries) return;
  const last = (await ctx.db.select<{ value: Record<string, string> }>('settings', { eq: { key: 'last_injuries' }, limit: 1 }))[0]?.value ?? {};
  for (const sport of sports.filter((s) => s === 'nba' || s === 'nfl' || s === 'nhl' || s === 'cbb' || s === 'cfb')) {
    if (last[sport] && ctx.now().getTime() - Date.parse(last[sport]) < 8 * 3600000) continue;
    const ref = (await leagueRefs(ctx, sport, prov))[0];
    if (!ref || !mayPull(ctx, 'propline', 'refresh', 1)) continue;
    try {
      const r = await prov.getInjuries(ref);
      await recordUsage(ctx, 'propline', r.cost, r.remaining);
      if (r.data.length) await ctx.db.upsert('injuries', r.data.map((i) => ({ sport, player: i.player, team: i.team, status: i.status, updated_at: ctx.now().toISOString() })), 'sport,player');
      last[sport] = ctx.now().toISOString();
    } catch (e) { ctx.log(`injuries failed ${sport}: ${(e as Error).message}`); }
  }
  await ctx.db.upsert('settings', { key: 'last_injuries', value: last, updated_at: ctx.now().toISOString() }, 'key');
}

/** Pre-game: refresh game logs for every prop player in the window (once a day per player). */
async function refreshPlayerLogs(ctx: Ctx, sport: SportId, leagueId: string, events: EventRow[]): Promise<void> {
  const fetched = (await ctx.db.select<{ value: Record<string, string> }>('settings', { eq: { key: 'player_logs_fetched' }, limit: 1 }))[0]?.value ?? {};
  let logCalls = 0;
  const prov = ctx.providers.propline;
  if (!prov.enabled || !prov.getPlayerGames) return;
  const ref = (await leagueRefs(ctx, sport, prov)).find((r) => r.leagueId === leagueId);
  if (!ref) return;
  for (const e of events) {
    const snaps = await ctx.db.select<{ player: string | null; stat: string | null }>('odds_snapshots', { eq: { event_id: e.id, market: 'prop' } });
    const players = [...new Set(snaps.map((s) => s.player).filter(Boolean) as string[])];
    for (const pl of players.slice(0, 30)) {
      // Once a day per player by FETCH time (game dates are weekly in the NFL, so the old check re-pulled
      // the same players every tick: PNFL-002), and at most 60 requests per tick.
      const fk = `${sport}|${pl}`;
      if (fetched[fk] && ctx.now().getTime() - Date.parse(fetched[fk]) < 20 * 3600000) continue;
      if (++logCalls > 60) break;
      fetched[fk] = ctx.now().toISOString();
      if (!mayPull(ctx, 'propline', 'props', 1)) return;
      try {
        const r = await prov.getPlayerGames(ref, pl, 20);
        await recordUsage(ctx, 'propline', r.cost, r.remaining);
        const stats = [...new Set(snaps.filter((s) => s.player === pl).map((s) => s.stat!))];
        const rows = r.data.flatMap((g) => stats.map((st) => ({ st, v: statValue(st, g.stats), g })).filter((x) => x.v !== undefined).map((x) => ({
          sport, player: pl, stat: x.st, game_date: x.g.date.slice(0, 10), value: x.v, minutes: x.g.minutes ?? null, team: (x.g as any).team ?? null,
        })));
        if (rows.length) await ctx.db.upsert('player_logs', rows, 'sport,player,stat,game_date');
      } catch (err) { ctx.log(`player logs failed ${pl}: ${(err as Error).message}`); }
    }
  }
  for (const [k, v] of Object.entries(fetched)) if (ctx.now().getTime() - Date.parse(v) > 3 * 86400000) delete fetched[k];
  await ctx.db.upsert('settings', { key: 'player_logs_fetched', value: fetched, updated_at: ctx.now().toISOString() }, 'key');
}

export interface TickReport { pulls: unknown[]; simulated: number; published: number; closing: number; finals: number; graded: number; alerts: unknown; edgesClosed?: number; edgesSettled?: number; feed?: unknown; cache?: unknown }

/**
 * One scheduler tick (every ~15 minutes from GitHub Actions):
 *  1. plan and run odds pulls (pre-game 60–90 min out, closing, budgeted slate refreshes)
 *  2. re-simulate events that got a new snapshot
 *  3. publish due picks (append-only + hash chain), then alert
 *  4. capture closing lines, ingest finals, grade
 */
export async function tick(ctx: Ctx, opts: { sports?: SportId[] } = {}): Promise<TickReport> {
  clearRatingsCache();
  await pruneSnapshots(ctx);
  const sports = opts.sports ?? SPORTS;
  const now = ctx.now();
  const rep: TickReport = { pulls: [], simulated: 0, published: 0, closing: 0, finals: 0, graded: 0, alerts: null };
  const last = await lastRefreshByLeague(ctx);

  // Discovery: leagues never refreshed (or due) get a refresh pull even with no known events yet.
  const known = await getEvents(ctx.db, { from: new Date(now.getTime() - 30 * 60000).toISOString(), to: new Date(now.getTime() + 36 * 3600000).toISOString(), status: ['scheduled'] });
  const slate = [];
  for (const e of known.filter((e) => sports.includes(e.sport_id))) {
    slate.push({ id: e.id, league: e.league_id, sport: e.sport_id, commence: e.commence_time, hasPregame: await hasKind(ctx, e.id, 'pregame'), hasClosing: await hasKind(ctx, e.id, 'closing') });
  }
  const weights = Object.fromEntries(SPORTS.map((s) => [s, SPORT_DEFS[s].budgetWeight]));
  const plan = planTick(slate, now.toISOString(), { lastRefresh: last, sportWeight: weights, refreshHours: ctx.settings.refreshHours });
  // Leagues with no known events: discovery refresh at most every refreshHours.
  for (const sport of sports) {
    for (const l of SPORT_DEFS[sport].leagues) {
      if (slate.some((s) => s.league === l.id) || plan.some((p) => p.league === l.id)) continue;
      const t = last[l.id];
      if (!t || now.getTime() - Date.parse(t) > ctx.settings.refreshHours * 2 * 3600000) plan.push({ kind: 'refresh', league: l.id, sport, eventIds: [], priority: 0 });
    }
  }
  const touched = new Set<string>();
  const closingEvents: string[] = [];
  for (const p of plan) {
    const sport = p.sport as SportId;
    const r = await pullOdds(ctx, sport, p.league, p.kind, p.kind === 'refresh' && !p.eventIds.length ? undefined : undefined);
    rep.pulls.push({ ...p, eventIds: p.eventIds.length, result: r });
    if (r.provider) {
      if (p.kind === 'refresh') last[p.league] = now.toISOString();
      for (const id of p.eventIds) touched.add(id);
      if (p.kind === 'closing') closingEvents.push(...p.eventIds);
      if (p.kind === 'pregame') {
        const evs = (await getEvents(ctx.db, { ids: p.eventIds }));
        const markets = PROP_MARKETS[sport];
        const flag = SPORT_DEFS[sport].propsFlag;
        // Prop prices arrive with the bulk PropLine pull. Player game logs (for the player simulation)
        // cost one request per player, so they are only fetched for sports whose prop flag is on.
        if (markets && flag && ctx.env[flag] === 'true') {
          if (r.provider !== 'propline') await pullProps(ctx, sport, p.league, evs, markets);
          await refreshPlayerLogs(ctx, sport, p.league, evs);
        }
      }
    }
    // Refresh pulls touch every upcoming event in the league
    if (p.kind === 'refresh' && r.provider) {
      const evs = await getEvents(ctx.db, { sport, from: now.toISOString(), to: new Date(now.getTime() + 48 * 3600000).toISOString(), status: ['scheduled'] });
      for (const e of evs.filter((e) => e.league_id === p.league)) touched.add(e.id);
    }
  }
  await saveLastRefresh(ctx, last);
  await refreshInjuries(ctx, sports);

  // Re-simulate everything that got new prices (the slate screen reads market_prices).
  for (const id of touched) {
    const e = (await getEvents(ctx.db, { ids: [id] }))[0];
    if (!e || e.status !== 'scheduled') continue;
    const s = await simulateEvent(ctx, e);
    if (s) { await saveSim(ctx, s); rep.simulated++; }
  }

  const pub = await publishDue(ctx);
  const newPicks: PickRow[] = pub.flatMap((r) => r.published);
  rep.published = newPicks.length;
  rep.alerts = await sendAlerts(ctx, newPicks);

  rep.closing = await captureClosing(ctx, closingEvents);
  rep.finals = await ingestScores(ctx);
  await ingestPropResults(ctx);
  rep.graded = await gradePicks(ctx);
  rep.edgesClosed = await closeEdges(ctx);
  rep.edgesSettled = await settleEdges(ctx);
  rep.cache = await buildFeedCache(ctx);
  rep.feed = await writeFeedStats(ctx, 'tick');
  return rep;
}

/** One feed_filter_log row per run: how many priced rows were dropped, and why (item 8). */
export async function writeFeedStats(ctx: Ctx, job: string): Promise<unknown> {
  const f = ctx.feedStats;
  if (!f.rowsIn) return null;
  const row = { run_at: ctx.now().toISOString(), job, rows_in: f.rowsIn, rows_kept: f.rowsKept, counts: f.counts };
  ctx.log(`feed filter: ${f.rowsKept}/${f.rowsIn} rows kept`, f.counts);
  try { await ctx.db.insert('feed_filter_log', row); } catch (err) { ctx.log(`feed_filter_log: ${(err as Error).message}`); }
  // Counts are per run: start the next one from zero (the demo reuses one context for many ticks).
  ctx.feedStats = { rowsIn: 0, rowsKept: 0, counts: Object.fromEntries(Object.keys(f.counts).map((k) => [k, 0])) as typeof f.counts };
  return row;
}

/**
 * Snapshot retention (BASELINE B1): keep pre-game and closing snapshots and each event's first and
 * latest refresh pull; drop the rest. Runs every tick so the database stays inside the free tier.
 */
export async function pruneSnapshots(ctx: Ctx): Promise<number> {
  try {
    const n = Number(await ctx.db.rpc<number>('prune_snapshots', { max_rows: 400000 })) || 0;
    if (n) ctx.log(`retention: pruned ${n} old refresh snapshots`);
    return n;
  } catch (err) {
    ctx.log(`retention skipped: ${(err as Error).message} (apply supabase/migrations/0002_edges_trial_feed.sql)`);
    return 0;
  }
}
