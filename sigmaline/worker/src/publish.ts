import {
  buildWriteup, pickFilters, selectionLabel, stakeUnits, PREGAME_WINDOW, type PricedSelection, type WriteupFacts,
} from '@sigmaline/core';
import { appendPick, getEvents, normTeam, type EventRow, type PickRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { saveSim, simulateEvent, type SimResult } from './simulate';

export interface Candidate { p: PricedSelection; ok: boolean; reasons: string[] }

/** Markets we never publish (priced and shown, but no licensed source to grade them yet). */
export function publishable(sport: string, p: PricedSelection, env: Record<string, string | undefined>): string | null {
  if (sport === 'tennis' && p.selection.market !== 'ml' && env.TENNIS_GAME_MARKETS_PUBLISH !== 'true') {
    return 'tennis game handicaps/totals are not published until a licensed game-count results source is connected';
  }
  if (p.selection.market === 'prop') {
    if (sport === 'nba' && env.PROPS_NBA_ENABLED !== 'true') return 'NBA props flag off';
    if (sport === 'nfl' && env.PROPS_NFL_ENABLED !== 'true') return 'NFL props flag off';
    if (sport !== 'nba' && sport !== 'nfl') return 'props launch for NBA and NFL only';
  }
  return null;
}

/** Choose picks: graded A/B, passing every filter, best EV per market type (and per player prop). */
export function choosePicks(sim: SimResult, ctx: Ctx, keyPlayerUnknown: boolean): Candidate[] {
  const now = ctx.now().getTime();
  const ageMin = (now - Date.parse(sim.snapshot.pulledAt)) / 60000;
  const best = new Map<string, Candidate>();
  for (const p of sim.priced) {
    if (p.grade === 'none' || !p.bestBook) continue;
    const reasons: string[] = [];
    const f = pickFilters({ snapshotAgeMin: ageMin, books: p.books, isProp: p.selection.market === 'prop', keyPlayerUnknown, ev: p.ev });
    reasons.push(...f.reasons);
    const block = publishable(sim.event.sport_id, p, ctx.env);
    if (block) reasons.push(block);
    const slot = p.selection.market === 'prop' ? `prop:${p.selection.player}:${p.selection.stat}` : p.selection.market;
    const c = { p, ok: reasons.length === 0, reasons };
    const cur = best.get(slot);
    if (c.ok && (!cur || !cur.ok || p.ev > cur.p.ev)) best.set(slot, c);
    else if (!cur) best.set(slot, c);
  }
  return [...best.values()];
}

async function injuriesFor(ctx: Ctx, e: EventRow) {
  const rows = await ctx.db.select<{ player: string; team: string | null; status: string; updated_at: string }>('injuries', { eq: { sport: e.sport_id } });
  const fresh = rows.filter((r) => ctx.now().getTime() - Date.parse(r.updated_at) < 36 * 3600000);
  const side = (t: string | null) => (t && normTeam(t) === normTeam(e.home) ? 'home' : t && normTeam(t) === normTeam(e.away) ? 'away' : null);
  return { hasData: rows.length > 0, list: fresh.map((r) => ({ player: r.player, team: side(r.team), status: r.status })).filter((r) => r.team) as { player: string; team: 'home' | 'away'; status: string }[] };
}

/**
 * A key player is anyone books post props for in this game. Their status is "unknown" when the
 * injury report lists them as questionable / day-to-day / game-time decision.
 */
function keyPlayerUnknown(sim: SimResult, inj: { player: string; status: string }[], props: Set<string>): boolean {
  return inj.some((i) => /questionable|day.to.day|game.time|gtd/i.test(i.status) && props.has(normTeam(i.player)));
}

export async function lineMovement(ctx: Ctx, e: EventRow, p: PricedSelection): Promise<{ probMove?: number; lineMove?: { from: number; to: number } }> {
  const snaps = await ctx.db.select<{ market: string; line: number | null; prices: Record<string, number>; pulled_at: string; book: string }>('odds_snapshots', { eq: { event_id: e.id, market: p.selection.market }, order: [{ col: 'pulled_at', asc: true }] });
  if (!snaps.length) return {};
  const first = snaps[0].pulled_at, last = snaps[snaps.length - 1].pulled_at;
  if (first === last) return {};
  const modal = (rows: typeof snaps) => {
    const c = new Map<number, number>();
    for (const r of rows) if (r.line !== null) c.set(Number(r.line), (c.get(Number(r.line)) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  if (p.selection.market === 'spread' || p.selection.market === 'total') {
    const a = modal(snaps.filter((s) => s.pulled_at === first)), b = modal(snaps.filter((s) => s.pulled_at === last));
    if (a !== undefined && b !== undefined && a !== b) return { lineMove: { from: a, to: b } };
  }
  return {};
}

export function writeupFacts(sim: SimResult, p: PricedSelection, extra: Partial<WriteupFacts>): WriteupFacts {
  const e = sim.event;
  const team = p.selection.side === 'home' ? e.home : p.selection.side === 'away' ? e.away : undefined;
  const opponent = p.selection.side === 'home' ? e.away : p.selection.side === 'away' ? e.home : undefined;
  return {
    sport: e.sport_id, home: e.home, away: e.away, selection: p.selection, selectionLabel: selectionLabel(p.selection, e.home, e.away),
    team, opponent, bestDecimal: p.bestDecimal, book: p.bestBook ?? '', modelP: p.model.win / Math.max(1e-9, p.model.win + p.model.loss),
    consensusP: p.consensusP, fairP: p.fair.win / Math.max(1e-9, p.fair.win + p.fair.loss), ev: p.ev, booksChecked: p.books,
    modelMargin: sim.summary.meanHome - sim.summary.meanAway, modelTotal: sim.summary.meanHome + sim.summary.meanAway,
    restDays: sim.rest, ...extra,
  };
}

export interface PublishReport { event: string; published: PickRow[]; rejected: { label: string; reasons: string[] }[] }

/**
 * Publish picks for games starting within the pre-game window that have a pre-game snapshot.
 * Each event is published once, from its pre-game snapshot; rows are appended to the hash chain.
 */
export async function publishDue(ctx: Ctx): Promise<PublishReport[]> {
  const now = ctx.now();
  const upcoming = await getEvents(ctx.db, { from: now.toISOString(), to: new Date(now.getTime() + (PREGAME_WINDOW.to + 5) * 60000).toISOString(), status: ['scheduled'] });
  const out: PublishReport[] = [];
  for (const e of upcoming) {
    if (e.meta?.published) continue;
    const sim = await simulateEvent(ctx, e, 'pregame');
    if (!sim) continue;
    await saveSim(ctx, sim);
    const inj = await injuriesFor(ctx, e);
    const propPlayers = new Set(sim.priced.filter((p) => p.selection.player).map((p) => normTeam(p.selection.player!)));
    const unknown = inj.hasData && keyPlayerUnknown(sim, inj.list, propPlayers);
    const cands = choosePicks(sim, ctx, unknown);
    const report: PublishReport = { event: `${e.away} @ ${e.home}`, published: [], rejected: [] };
    for (const c of cands) {
      const label = selectionLabel(c.p.selection, e.home, e.away);
      if (!c.ok) { report.rejected.push({ label, reasons: c.reasons }); continue; }
      const move = await lineMovement(ctx, e, c.p);
      const facts = writeupFacts(sim, c.p, { injuries: inj.list, ...move });
      const writeup = { ...buildWriteup(facts), facts };
      try {
        const row = await appendPick(ctx.db, {
          id: crypto.randomUUID(), created_at: ctx.now().toISOString(), sport: e.sport_id, league: e.league_id, event_id: e.id,
          event_name: `${e.away} @ ${e.home}`, commence_time: e.commence_time, market: c.p.selection.market, selection: c.p.key, label,
          line: c.p.selection.line ?? null, book: c.p.bestBook!, price_decimal: c.p.bestDecimal, fair_decimal: c.p.fairDecimal, ev: c.p.ev,
          grade: c.p.grade as 'A' | 'B', model_version: sim.model.id, stake_units: stakeUnits(c.p.grade), snapshot_ts: sim.snapshot.pulledAt, writeup,
        });
        report.published.push(row);
      } catch (err) {
        report.rejected.push({ label, reasons: [`append failed: ${(err as Error).message}`] });
      }
    }
    await ctx.db.update('events', { id: e.id }, { meta: { ...e.meta, published: true, published_at: ctx.now().toISOString(), rejected: report.rejected.slice(0, 20) } });
    out.push(report);
  }
  return out;
}
