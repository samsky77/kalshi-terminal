import {
  buildWriteup, GRADE_CONFIG, pickFilters, selectionLabel, stakeUnits, PREGAME_WINDOW, type PricedSelection, type WriteupFacts,
} from '@sigmaline/core';
import { appendPick, getEvents, normTeam, type EventRow, type PickRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { saveSim, simulateEvent, type SimResult } from './simulate';
import { writeup as makeWriteup } from './writeup';

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

/** Game-line edges above this are almost always a stale or mis-mapped quote, not value. */
export const MAX_GAME_LINE_PICK_EV = GRADE_CONFIG.maxCredibleEdge.game;
/** A spread/total pick needs at least this share of the deepest line's book count (and 5 books). */
export const MIN_LINE_DEPTH_SHARE = GRADE_CONFIG.altLine.minShareOfMain;

/**
 * Deep-market guard for spreads and totals. Alternate lines far from the main number are quoted by a
 * handful of books, several of which load all their margin onto the longshot; de-vigging those
 * inflates the longshot and shows large false edges (seen live: "Under 206.5 +410" when the main
 * total was ~222, 7 books vs 69 at the main line). Picks are therefore limited to lines whose book
 * count is at least half that of the deepest line in the same market.
 */
export function lineDepthReason(p: PricedSelection, deepest: Map<string, number>): string | null {
  const m = p.selection.market;
  if (m !== 'spread' && m !== 'total') return null;
  const top = deepest.get(m) ?? 0;
  if (p.books >= top) return null; // the main line itself
  const need = Math.max(GRADE_CONFIG.altLine.minBooks, Math.ceil(top * MIN_LINE_DEPTH_SHARE));
  return p.books < need ? `thin alternate line (${p.books} books, main line has ${top})` : null;
}

/** Choose picks: graded A/B, passing every filter, best EV per market type (and per player prop). */
export function choosePicks(sim: SimResult, ctx: Ctx, keyPlayerUnknown: boolean): Candidate[] {
  const now = ctx.now().getTime();
  const ageMin = (now - Date.parse(sim.snapshot.pulledAt)) / 60000;
  const best = new Map<string, Candidate>();
  const deepest = new Map<string, number>();
  for (const p of sim.priced) deepest.set(p.selection.market, Math.max(deepest.get(p.selection.market) ?? 0, p.books));
  for (const p of sim.priced) {
    if (p.grade === 'none' || !p.bestBook) continue;
    const reasons: string[] = [];
    const f = pickFilters({ snapshotAgeMin: ageMin, books: p.books, isProp: p.selection.market === 'prop', keyPlayerUnknown, ev: p.ev });
    reasons.push(...f.reasons);
    const thin = lineDepthReason(p, deepest);
    if (thin) reasons.push(thin);
    if (p.selection.market !== 'prop' && p.ev > MAX_GAME_LINE_PICK_EV) reasons.push(`EV ${(p.ev * 100).toFixed(1)}% is above the ${MAX_GAME_LINE_PICK_EV * 100}% credibility cap for game lines`);
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
    restDays: sim.rest, modelIndependent: (sim.expectationSource === 'ratings' || sim.expectationSource === 'tennis-elo') && p.fairSource !== 'consensus',
    drawP: e.sport_id === 'soccer' ? sim.summary.draw : undefined, bestOf: e.sport_id === 'tennis' ? (e.meta as { bestOf?: number }).bestOf : undefined,
    fairSource: p.fairSource, ...extra,
  };
}

export interface PublishReport { event: string; published: PickRow[]; rejected: { label: string; reasons: string[] }[] }

/**
 * Publish picks as soon as a game is within settings.publishHoursBefore (default 12 h) and its latest
 * prices are fresh (pickFilters rejects snapshots older than 90 min). A game with no qualifying pick
 * stays open and is re-checked after each new pull, until its pre-game snapshot (60-90 min out),
 * which is the final check. Each game publishes at most once; rows are appended to the hash chain.
 */
export async function publishDue(ctx: Ctx): Promise<PublishReport[]> {
  const now = ctx.now();
  const pregameMin = PREGAME_WINDOW.to + 5;
  const windowMin = Math.max(pregameMin, Number(ctx.settings.publishHoursBefore ?? 0) * 60);
  const upcoming = await getEvents(ctx.db, { from: now.toISOString(), to: new Date(now.getTime() + windowMin * 60000).toISOString(), status: ['scheduled'] });
  const out: PublishReport[] = [];
  for (const e of upcoming) {
    if (e.meta?.published) continue;
    // Early window (beyond the pre-game window): evaluate the latest prices, once per new pull, and
    // keep the game open if nothing qualifies. The pre-game window is the final check and closes it.
    const inPregame = Date.parse(e.commence_time) - now.getTime() <= pregameMin * 60000;
    let sim = inPregame ? await simulateEvent(ctx, e, 'pregame') : null;
    if (!sim) sim = await simulateEvent(ctx, e);
    if (!sim) continue;
    if (!inPregame && e.meta?.early_checked_at === sim.snapshot.pulledAt) continue;
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
      const writeup = { ...(await makeWriteup(facts, ctx.env.WRITEUP_PROVIDER)), facts };
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
    const done = inPregame || report.published.length > 0;
    await ctx.db.update('events', { id: e.id }, {
      meta: done
        ? { ...e.meta, published: true, published_at: ctx.now().toISOString(), rejected: report.rejected.slice(0, 20) }
        : { ...e.meta, early_checked_at: sim.snapshot.pulledAt, rejected: report.rejected.slice(0, 20) },
    });
    out.push(report);
  }
  return out;
}
