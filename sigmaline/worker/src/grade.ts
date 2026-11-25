import { clv, gradeBet, profitUnits, SPORT_DEFS, type Selection, type SportId } from '@sigmaline/core';
import { getEvents, latestPull, normTeam, quoteFromSnapshot, type EventRow, type PickRow } from '@sigmaline/db';
import { mayPull, noteProviderError, recordUsage, type Ctx } from './context';
import { gameDates } from './edges';
import { leagueRefs } from './ingest';
import { selectionConsensus, statValue } from './simulate';
import type { ScoreRow } from './providers/types';

function parseSelection(key: string): Selection {
  const [market, side, line, player, stat] = key.split(':');
  return { market: market as Selection['market'], side: side as Selection['side'], line: line === '' ? undefined : Number(line), player: player || undefined, stat: stat || undefined };
}

/** Store closing lines for every published pick on events that have a closing snapshot. */
export async function captureClosing(ctx: Ctx, eventIds: string[]): Promise<number> {
  let n = 0;
  for (const id of eventIds) {
    const picks = await ctx.db.select<PickRow>('picks', { eq: { event_id: id } });
    if (!picks.length) continue;
    const pull = await latestPull(ctx.db, id, 'closing');
    if (!pull.snapshots.length) continue;
    const quotes = pull.snapshots.map(quoteFromSnapshot);
    const ev = (await getEvents(ctx.db, { ids: [id] }))[0];
    for (const p of picks) {
      const sel = parseSelection(p.selection);
      // selectionConsensus takes the selection's own line (away +2.5) and maps it to the home line.
      const c = selectionConsensus(quotes, sel.market, sel.line, sel.side, SPORT_DEFS[ev.sport_id].threeWay, sel.player, sel.stat);
      if (!c) continue;
      const bettable = new Set(ctx.settings.bettableBooks);
      let best = NaN;
      for (const q of quotes) {
        if (!bettable.has(q.book) || q.market !== sel.market) continue;
        const d = (q.prices as any)[sel.side];
        const lineOk = sel.market === 'ml' || (sel.market === 'spread' ? q.line === (sel.side === 'home' ? sel.line : -(sel.line ?? 0)) : q.line === sel.line);
        if (lineOk && d > 1 && !(d <= best)) best = d;
      }
      // push probability at an integer line: taken from the latest simulation of this event
      const mp = (await ctx.db.select<{ model_probs: { push: number } }>('market_prices', { eq: { event_id: id, selection_key: p.selection }, limit: 1 }))[0];
      await ctx.db.upsert('closing_lines', {
        event_id: id, selection_key: p.selection, closing_decimal: Number.isFinite(best) ? best : null, closing_p: c.p,
        push_p: mp?.model_probs?.push ?? 0, books: c.books, ts: pull.pulledAt,
      }, 'event_id,selection_key');
      n++;
    }
  }
  return n;
}

/** Fetch scores for sports with games that should be over, and mark them final. */
export async function ingestScores(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  let updated = 0;
  for (const sport of Object.keys(SPORT_DEFS) as SportId[]) {
    const def = SPORT_DEFS[sport];
    const open = (await getEvents(ctx.db, { sport, from: new Date(now.getTime() - 3 * 86400000).toISOString(), to: new Date(now.getTime() - def.durationHours * 3600000).toISOString(), status: ['scheduled', 'live'] }))
      .filter((e) => e.source === 'live');
    if (!open.length) continue;
    const leagues = [...new Set(open.map((e) => e.league_id))];
    for (const pid of ['propline', 'oddsapi'] as const) {
      const prov = ctx.providers[pid];
      if (!prov.enabled) continue;
      const refs = (await leagueRefs(ctx, sport, prov)).filter((r) => sport === 'tennis' || leagues.includes(r.leagueId));
      const cost = pid === 'oddsapi' ? 2 : 1;
      if (!refs.length || !mayPull(ctx, pid, 'scores', cost * refs.length)) continue;
      const scores: ScoreRow[] = [];
      for (const ref of refs) {
        try {
          const r = await prov.getScores(ref, 3);
          await recordUsage(ctx, pid, r.cost, r.remaining);
          scores.push(...r.data);
        } catch (e) { ctx.log(`scores failed ${pid} ${ref.key}: ${(e as Error).message}`); if (noteProviderError(ctx, pid, e)) break; }
      }
      let got = 0;
      for (const e of open) {
        if (e.status === 'final') continue;
        const s = scores.find((x) => x.providerEventId === e.provider_ids[pid]) ??
          scores.find((x) => normTeam(x.home, sport) === normTeam(e.home, sport) && normTeam(x.away, sport) === normTeam(e.away, sport) && Math.abs(Date.parse(x.commence) - Date.parse(e.commence_time)) < 12 * 3600000);
        if (!s || !s.completed || s.homeScore === null || s.awayScore === null) continue;
        const winner = s.homeScore > s.awayScore ? 1 : s.homeScore < s.awayScore ? -1 : 0;
        await ctx.db.update('events', { id: e.id }, { status: 'final', home_score: s.homeScore, away_score: s.awayScore, winner, final_at: now.toISOString(), updated_at: now.toISOString() });
        e.status = 'final';
        updated++; got++;
      }
      if (got === open.length) break;
    }
  }
  return updated;
}

/** Grade every ungraded pick whose event is final. Results are append-only and never re-graded. */
export async function gradePicks(ctx: Ctx): Promise<number> {
  const picks = await ctx.db.select<PickRow>('picks', { lt: { commence_time: ctx.now().toISOString() } });
  const graded = new Set((await ctx.db.select<{ pick_id: string }>('pick_results')).map((r) => r.pick_id));
  const todo = picks.filter((p) => !graded.has(p.id));
  if (!todo.length) return 0;
  const events = new Map((await getEvents(ctx.db, { ids: [...new Set(todo.map((p) => p.event_id))] })).map((e) => [e.id, e]));
  let n = 0;
  for (const p of todo) {
    const e = events.get(p.event_id) as EventRow | undefined;
    if (!e) continue;
    const sel = parseSelection(p.selection);
    let result: ReturnType<typeof gradeBet>;
    if (e.status === 'void' || e.status === 'postponed') result = 'void';
    else if (e.status !== 'final') continue;
    else {
      let props: Record<string, number> | undefined;
      if (sel.market === 'prop' && sel.player && sel.stat) {
        const log = (await ctx.db.select<{ value: number }>('player_logs', { eq: { sport: e.sport_id, player: sel.player, stat: sel.stat }, in: { game_date: gameDates(e) }, limit: 1 }))[0];
        if (!log) {
          // wait up to 24h for the player's box score, then void (player did not play / no data)
          if (ctx.now().getTime() - Date.parse(e.final_at ?? e.commence_time) < 24 * 3600000) continue;
          props = {};
        } else props = { [`${sel.player}|${sel.stat}`]: Number(log.value) };
      }
      result = gradeBet(sel, e.sport_id, { home: Number(e.home_score), away: Number(e.away_score), winner: (e.winner ?? undefined) as 1 | -1 | 0 | undefined, props });
    }
    const close = (await ctx.db.select<{ closing_decimal: number | null; closing_p: number | null; push_p: number }>('closing_lines', { eq: { event_id: e.id, selection_key: p.selection }, limit: 1 }))[0];
    const c = close?.closing_p !== null && close?.closing_p !== undefined ? clv(Number(p.price_decimal), Number(close.closing_p), Number(close.push_p ?? 0)) : null;
    await ctx.db.insert('pick_results', {
      pick_id: p.id, result, profit_units: Math.round(profitUnits(result, Number(p.stake_units), Number(p.price_decimal)) * 10000) / 10000,
      final_home: e.home_score, final_away: e.away_score, closing_decimal: close?.closing_decimal ?? null, closing_p: close?.closing_p ?? null,
      clv: c === null ? null : Math.round(c * 1e6) / 1e6, graded_at: ctx.now().toISOString(),
    });
    n++;
  }
  return n;
}

/** Fetch box-score stats for players with prop picks on finished games (PropLine). */
export async function ingestPropResults(ctx: Ctx): Promise<number> {
  const prov = ctx.providers.propline;
  if (!prov.enabled || !prov.getPlayerGames) return 0;
  const picks = (await ctx.db.select<PickRow>('picks', { eq: { market: 'prop' }, lt: { commence_time: ctx.now().toISOString() } }));
  const graded = new Set((await ctx.db.select<{ pick_id: string }>('pick_results')).map((r) => r.pick_id));
  // Open prop edges in the edge log need box scores too (PNBA-004), one request per player and game.
  const openEdges = await ctx.db.select<{ sport: string; league: string | null; selection: string; start_time: string }>('edges_log', { eq: { market: 'prop' }, isNull: ['result'], lt: { start_time: new Date(ctx.now().getTime() - 2 * 3600000).toISOString() } }).catch(() => []);
  const todo = [
    ...picks.filter((x) => !graded.has(x.id)).map((p) => ({ sport: p.sport, league: p.league, selection: p.selection })),
    ...openEdges.map((e) => ({ sport: e.sport as PickRow['sport'], league: e.league ?? e.sport, selection: e.selection })),
  ];
  // One box-score request per player covers every stat we need for that player.
  const byPlayer = new Map<string, { sport: PickRow['sport']; league: string; player: string; stats: Set<string> }>();
  for (const p of todo) {
    const sel = parseSelection(p.selection);
    if (!sel.player || !sel.stat) continue;
    const key = `${p.sport}|${p.league}|${sel.player}`;
    const cur = byPlayer.get(key) ?? { sport: p.sport, league: p.league, player: sel.player, stats: new Set<string>() };
    cur.stats.add(sel.stat);
    byPlayer.set(key, cur);
  }
  let n = 0, calls = 0;
  for (const p of byPlayer.values()) {
    if (++calls > 40 || !mayPull(ctx, 'propline', 'scores', 1)) break; // budget guard: at most 40 requests per tick
    const ref = (await leagueRefs(ctx, p.sport, prov)).find((r) => r.leagueId === p.league);
    if (!ref) continue;
    try {
      const r = await prov.getPlayerGames(ref, p.player, 3);
      await recordUsage(ctx, 'propline', r.cost, r.remaining);
      for (const g of r.data) for (const stat of p.stats) {
        const v = statValue(stat, g.stats);
        if (v === undefined) continue;
        await ctx.db.upsert('player_logs', { sport: p.sport, player: p.player, stat, game_date: g.date.slice(0, 10), value: v, minutes: g.minutes ?? null }, 'sport,player,stat,game_date');
        n++;
      }
    } catch (e) { ctx.log(`player games failed ${p.player}: ${(e as Error).message}`); }
  }
  return n;
}
