import { CLOSING_WINDOW, GRADE_CONFIG, mainLine, PREGAME_WINDOW, PROP_MARKETS, quotesFromEvent, SPORT_DEFS, type MarketQuote, type OddsApiEvent, type ProviderId, type PullKind, type SportId } from '@sigmaline/core';
import { eventId, getEvents, normTeam, type EventRow, type SnapshotRow } from '@sigmaline/db';
import { mayPull, noteProviderError, recordUsage, type Ctx } from './context';
import type { DataProvider, LeagueRef } from './providers/types';

export const GAME_MARKETS = ['h2h', 'spreads', 'totals'];

/** Provider order per pull kind: the snapshot picks are logged against should be the richest. */
export function providerOrder(kind: PullKind): ProviderId[] {
  // PropLine (1,000/day) first; The Odds API (500/month) tops up thin markets on pre-game/closing pulls.
  void kind;
  return ['sharpapi', 'propline', 'oddsapi'];
}

/** League refs for a sport; tennis expands to the active ATP/WTA tournament keys. */
export async function leagueRefs(ctx: Ctx, sport: SportId, provider: DataProvider): Promise<LeagueRef[]> {
  if (sport === 'tennis') {
    if (provider.id === 'oddsapi' && 'activeTennisKeys' in provider && !ctx.demo) {
      try {
        const keys = await (provider as any).activeTennisKeys() as string[];
        return keys.filter((k) => /tennis_(atp|wta)_/.test(k)).map((k) => ({ sport, leagueId: 'tennis', key: k }));
      } catch { return []; }
    }
    const k = provider.leagueKey('tennis', 'tennis');
    return k ? [{ sport, leagueId: 'tennis', key: k }] : [];
  }
  return SPORT_DEFS[sport].leagues
    .map((l) => ({ sport: sport as SportId, leagueId: l.id, key: provider.leagueKey(sport, l.id) ?? '' }))
    .filter((r) => !!r.key);
}

function tennisMeta(ev: OddsApiEvent): Record<string, unknown> {
  const k = ev.sport_key;
  const tour = /wta/.test(k) ? 'wta' : 'atp';
  const slam = /(aus_open|french_open|wimbledon|us_open)/.test(k);
  return { tour, slam, bestOf: slam && tour === 'atp' ? 5 : 3, tournament: ev.sport_title ?? k };
}

/** Find our event for a provider event (same teams, start within 36 h), or create it. */
export async function upsertEvent(ctx: Ctx, sport: SportId, leagueId: string, provider: ProviderId, ev: OddsApiEvent, known: EventRow[]): Promise<EventRow> {
  const t = Date.parse(ev.commence_time);
  const match = known.find((k) =>
    normTeam(k.home, sport) === normTeam(ev.home_team, sport) && normTeam(k.away, sport) === normTeam(ev.away_team, sport) && Math.abs(Date.parse(k.commence_time) - t) < 36 * 3600000);
  if (match) {
    const pid = { ...match.provider_ids, [provider]: String(ev.id) };
    const patch: Partial<EventRow> = { provider_ids: pid, updated_at: ctx.now().toISOString() };
    // Providers sometimes correct start times; follow them while the game is still upcoming.
    if (match.status === 'scheduled' && Math.abs(Date.parse(match.commence_time) - t) > 60000) patch.commence_time = new Date(t).toISOString();
    await ctx.db.update('events', { id: match.id }, patch);
    Object.assign(match, patch);
    return match;
  }
  const row: EventRow = {
    id: eventId(sport, leagueId, ev.commence_time, ev.home_team, ev.away_team), sport_id: sport, league_id: leagueId,
    home: ev.home_team, away: ev.away_team, commence_time: new Date(t).toISOString(), status: 'scheduled', home_score: null, away_score: null,
    winner: null, final_at: null, provider_ids: { [provider]: String(ev.id) }, meta: sport === 'tennis' ? tennisMeta(ev) : {}, source: 'live',
    updated_at: ctx.now().toISOString(),
  };
  await ctx.db.upsert('events', row as unknown as Record<string, unknown>, 'id');
  known.push(row);
  return row;
}

/** Snapshot label from minutes to start: pre-game (25–95 min), closing (−10…25 min), else refresh. */
export function snapshotKind(commenceMs: number, nowMs: number): 'pregame' | 'closing' | 'refresh' {
  const m = (commenceMs - nowMs) / 60000;
  if (m <= CLOSING_WINDOW.to && m >= CLOSING_WINDOW.from) return 'closing';
  if (m > CLOSING_WINDOW.to && m <= PREGAME_WINDOW.to + 5) return 'pregame';
  return 'refresh';
}

export interface PullOutcome { provider: ProviderId | null; events: number; snapshots: number; skipped?: string }

/**
 * Pull game-line odds for one league and store a snapshot. Respects the budgeter; tries the next
 * provider in order when one is disabled, over budget or failing. If the first provider returns
 * fewer than 3 books for most games on a pre-game/closing pull, a second provider is merged in.
 */
export async function pullOdds(ctx: Ctx, sport: SportId, leagueId: string, kind: PullKind, eventIds?: string[]): Promise<PullOutcome> {
  const pulledAt = ctx.now().toISOString();
  const known = await getEvents(ctx.db, { sport, from: new Date(ctx.now().getTime() - 2 * 86400000).toISOString(), to: new Date(ctx.now().getTime() + 10 * 86400000).toISOString() });
  let total = 0, evCount = 0, used: ProviderId | null = null, providersUsed = 0;
  const bookCount = new Map<string, Set<string>>();
  for (const pid of providerOrder(kind)) {
    const prov = ctx.providers[pid];
    if (!prov.enabled) continue;
    const refs = await leagueRefs(ctx, sport, prov);
    if (!refs.length) continue;
    const costPer = pid === 'oddsapi' ? GAME_MARKETS.length : 1;
    if (!mayPull(ctx, pid, kind, costPer * refs.length)) { ctx.log(`budget: skip ${pid} ${kind} ${sport}/${leagueId}`); continue; }
    let ok = false;
    for (const ref of refs) {
      if (ref.leagueId !== leagueId && sport !== 'tennis') continue;
      try {
        const providerIds = eventIds
          ? known.filter((k) => eventIds.includes(k.id)).map((k) => k.provider_ids[pid]).filter(Boolean)
          : undefined;
        // PropLine's bulk endpoint returns every game in the sport, props included, for ONE request,
        // so props ride along at no extra cost. The Odds API charges per market and per event for
        // props (500 credits/month), so it only ever gets game lines.
        const markets = pid === 'propline' ? [...GAME_MARKETS, ...PROP_MARKETS[sport]] : GAME_MARKETS;
        const res = await prov.getOdds(ref, { markets, eventIds: providerIds && providerIds.length ? providerIds : undefined });
        await recordUsage(ctx, pid, res.cost, res.remaining);
        const rows: SnapshotRow[] = [];
        for (const ev of res.data) {
          if (Date.parse(ev.commence_time) < ctx.now().getTime() - 15 * 60000 && kind !== 'closing') continue; // started
          const e = await upsertEvent(ctx, sport, leagueId, pid, ev, known);
          evCount++;
          // One call returns the whole league, so each event's snapshot is labelled by its own
          // time to start — a pull made for one game's pre-game window must not count as another
          // game's pre-game snapshot.
          const rowKind = snapshotKind(Date.parse(e.commence_time), ctx.now().getTime());
          const stats = { suspended: 0 };
          // Only markets we asked for: a provider volunteering extra prop keys (e.g. tennis aces) must not
          // create markets we never chose to show (PTEN-001).
          const asked = new Set(markets);
          for (const q of keepDeepLines(quotesFromEvent(ev, res.priceFormat, pulledAt, stats).filter((q) => q.market !== 'prop' || asked.has(q.stat ?? '')))) {
            rows.push({ event_id: e.id, provider: pid, book: q.book, market: q.market, line: q.line ?? null, player: q.player ?? null, stat: q.stat ?? null, ...(q.team ? { team: q.team } : {}), prices: q.prices as Record<string, number>, ts: q.ts, kind: rowKind, pulled_at: pulledAt });
            if (q.market !== 'prop') { const s = bookCount.get(e.id) ?? new Set(); s.add(q.book); bookCount.set(e.id, s); }
          }
          ctx.feedStats.counts.suspended += stats.suspended;
        }
        if (rows.length) await ctx.db.insert('odds_snapshots', rows as unknown as Record<string, unknown>[]);
        total += rows.length;
        ok = true;
      } catch (e) {
        ctx.log(`pull failed ${pid} ${ref.key}: ${(e as Error).message}`);
        if (noteProviderError(ctx, pid, e)) break;
      }
    }
    if (ok) {
      used ??= pid;
      providersUsed++;
      const thin = [...bookCount.values()].filter((s) => s.size < 3).length;
      const needMore = (kind === 'pregame' || kind === 'closing') && bookCount.size > 0 && thin / bookCount.size > 0.5;
      if (!needMore || providersUsed >= 2) break;
    }
  }
  return used ? { provider: used, events: evCount, snapshots: total } : { provider: null, events: 0, snapshots: 0, skipped: 'no provider available or budget exhausted' };
}

/** Pull player props for events (PropLine) behind the per-sport flag. */
export async function pullProps(ctx: Ctx, sport: SportId, leagueId: string, events: EventRow[], markets: string[]): Promise<number> {
  const prov = ctx.providers.propline;
  if (!prov.enabled || !prov.getProps) return 0;
  const ref = (await leagueRefs(ctx, sport, prov)).find((r) => r.leagueId === leagueId);
  if (!ref) return 0;
  const pulledAt = ctx.now().toISOString();
  let n = 0;
  for (const e of events) {
    let pidv = e.provider_ids.propline;
    if (!pidv) {
      // map via PropLine's own event list (1 request, cached per call)
      if (!mayPull(ctx, 'propline', 'pregame', 1)) break;
      const list = await prov.getEvents(ref).catch(() => null);
      if (list) {
        await recordUsage(ctx, 'propline', list.cost, list.remaining);
        const m = list.data.find((x) => normTeam(x.home_team, sport) === normTeam(e.home, sport) && normTeam(x.away_team, sport) === normTeam(e.away, sport));
        if (m) { pidv = String(m.id); await ctx.db.update('events', { id: e.id }, { provider_ids: { ...e.provider_ids, propline: pidv } }); e.provider_ids.propline = pidv; }
      }
    }
    if (!pidv || !mayPull(ctx, 'propline', 'pregame', 1)) continue;
    try {
      const res = await prov.getProps(ref, pidv, markets);
      await recordUsage(ctx, 'propline', res.cost, res.remaining);
      if (!res.data) continue;
      const rows: SnapshotRow[] = quotesFromEvent(res.data, res.priceFormat, pulledAt)
        .filter((q) => q.market === 'prop')
        .map((q) => ({ event_id: e.id, provider: 'propline', book: q.book, market: 'prop', line: q.line ?? null, player: q.player ?? null, stat: q.stat ?? null, prices: q.prices as Record<string, number>, ts: q.ts, kind: 'pregame', pulled_at: pulledAt }));
      if (rows.length) await ctx.db.insert('odds_snapshots', rows as unknown as Record<string, unknown>[]);
      n += rows.length;
    } catch (err) {
      ctx.log(`props failed ${e.id}: ${(err as Error).message}`);
    }
  }
  return n;
}

/**
 * Storage guard (BASELINE B1/B20): keep a game-line quote only if its line is the market's main line
 * or at least 3 books quote it, and a prop quote only if at least 2 books quote that player/stat/line.
 * Thinner alternate lines can never be graded (see the pricer's depth guard), so storing every book's
 * every rung only filled the database (76k rows for one NCAAF pull).
 */
export function keepDeepLines(quotes: MarketQuote[]): MarketQuote[] {
  const key = (q: MarketQuote) => [q.market, q.line ?? '', q.player ?? '', q.stat ?? ''].join('|');
  const books = new Map<string, Set<string>>();
  for (const q of quotes) { const k = key(q); const s = books.get(k) ?? new Set<string>(); s.add(q.book); books.set(k, s); }
  const main = { spread: mainLine(quotes, 'spread'), total: mainLine(quotes, 'total') };
  // Props: each player/stat's main line is the rung most books quote.
  const propMain = new Map<string, { line: number | undefined; n: number }>();
  for (const q of quotes) if (q.market === 'prop') {
    const pk = `${q.player}|${q.stat}`, n = books.get(key(q))!.size, cur = propMain.get(pk);
    if (!cur || n > cur.n || (n === cur.n && (q.line ?? 0) < (cur.line ?? 0))) propMain.set(pk, { line: q.line, n });
  }
  // Keep what can ever be graded: main lines (min books apply later) and alternate lines with at least
  // GRADE_CONFIG.altLine.minBooks books (PCFB-001: thinner rungs were stored but never gradable).
  const alt = GRADE_CONFIG.altLine.minBooks;
  return quotes.filter((q) => {
    const n = books.get(key(q))!.size;
    if (q.market === 'ml') return true;
    if (q.market === 'prop') return (q.line === propMain.get(`${q.player}|${q.stat}`)?.line && n >= GRADE_CONFIG.minBooks.prop) || n >= alt;
    return q.line === main[q.market] || n >= alt;
  });
}
