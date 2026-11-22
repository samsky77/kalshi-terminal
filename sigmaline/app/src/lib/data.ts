import 'server-only';
import {
  buildWriteup, budgetMode, consensus, GRADE_CONFIG, pickHistogram, selectionLabel, SPORT_DEFS,
  type DistSummary, type Grade, type MarketAnchor, type OutcomeProbs, type Selection, type SportId, type WriteupFacts, type Writeup,
} from '@sigmaline/core';
import {
  aggregate, allPicks, breakdown, buildEdges, buildProps, buildSlate, cumulativeCurve, FEED_KEYS, getEvent, getEvents, getSettings, isLiveEdge,
  periodUsage, publicVisible, readFeed, windowStart,
  type EdgesPayload, type EventRow, type PickResultRow, type PickRow, type PropsPayload, type RecordRow, type SlatePayload,
} from '@sigmaline/db';
import { demoMode, getDb } from './db';

export interface PriceRow {
  event_id: string;
  selection_key: string;
  market: Selection['market'];
  selection: Selection;
  line: number | null;
  fair_decimal: number | null;
  fair_probs: OutcomeProbs;
  model_probs: OutcomeProbs;
  consensus_p: number | null;
  best_decimal: number | null;
  best_book: string | null;
  books: number;
  ev: number | null;
  model_ev: number | null;
  consensus_ev: number | null;
  grade: Grade;
  snapshot_ts: string | null;
  price_ts: string | null;
  fair_source: 'blend' | 'consensus';
}

/**
 * Stale threshold for this deployment. Always GRADE_CONFIG.staleMinutes in production; the local demo
 * replays recorded odds, so DEMO_STALE_MINUTES may stretch it there (demo file database only).
 */
export function staleMinutes(): number {
  const d = Number(process.env.DEMO_STALE_MINUTES);
  return demoMode() && d > 0 ? d : GRADE_CONFIG.staleMinutes;
}

/** Feed cache is rebuilt every tick (~15 min); older than this, the app builds the feed itself. */
const FEED_MAX_AGE_MS = 20 * 60000;

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
function normPrice(r: any): PriceRow {
  return {
    ...r, price_ts: r.price_ts ?? r.snapshot_ts ?? null, fair_source: r.fair_source === 'consensus' ? 'consensus' : 'blend', line: num(r.line),
    fair_decimal: num(r.fair_decimal), consensus_p: num(r.consensus_p), best_decimal: num(r.best_decimal), ev: num(r.ev), model_ev: num(r.model_ev),
    consensus_ev: num(r.consensus_ev), books: Number(r.books),
  };
}

/** Every price on the slate is past the stale threshold (refreshes paused / budget exhausted). */
export function isPriceStale(ts: string | null, now = Date.now()): boolean {
  return !ts || now - Date.parse(ts) > staleMinutes() * 60000;
}

export async function quotaState() {
  const db = await getDb();
  const s = await getSettings(db);
  const out: Record<string, { used: number; limit: number; period: string; mode: string }> = {};
  for (const [p, q] of Object.entries(s.quotas)) {
    const used = await periodUsage(db, p, q.period);
    out[p] = { used, limit: q.limit, period: q.period, mode: budgetMode({ used, limit: q.limit }) };
  }
  return out;
}

/** Slate for one sport (game lines): cached payload, edges re-checked for staleness at read time. */
export async function slate(sport: SportId, now = new Date()): Promise<SlatePayload> {
  const db = await getDb();
  const p = (!demoMode() && (await readFeed<SlatePayload>(db, FEED_KEYS.slate(sport), FEED_MAX_AGE_MS, now.getTime()))) || (await buildSlate(db, sport, now, staleMinutes()));
  const nowMs = now.getTime(), sm = staleMinutes();
  const rows = p.rows
    .filter((r) => Date.parse(r.event.commence_time) > nowMs) // started games have no valid pre-game price
    .map((r) => (r.top && !isLiveEdge(r.top, r.event.commence_time, nowMs, sm) ? { ...r, top: null } : r));
  rows.sort((a, b) => (b.top?.ev ?? -1) - (a.top?.ev ?? -1) || a.event.commence_time.localeCompare(b.event.commence_time));
  return { ...p, rows };
}

/** Every live edge (all sports, lines and props), re-checked for staleness at read time. */
export async function edgeFeed(now = new Date()): Promise<EdgesPayload> {
  const db = await getDb();
  const p = (!demoMode() && (await readFeed<EdgesPayload>(db, FEED_KEYS.edges, FEED_MAX_AGE_MS, now.getTime()))) || (await buildEdges(db, now, staleMinutes()));
  const nowMs = now.getTime(), sm = staleMinutes();
  return { ...p, rows: p.rows.filter((r) => isLiveEdge(r, r.event.commence_time, nowMs, sm)) };
}

/** Props board for one sport (every market the provider returned, main line per player/stat). */
export async function propsFeed(sport: SportId, now = new Date()): Promise<PropsPayload> {
  const db = await getDb();
  const p = (!demoMode() && (await readFeed<PropsPayload>(db, FEED_KEYS.props(sport), FEED_MAX_AGE_MS, now.getTime()))) || (await buildProps(db, sport, now));
  return { ...p, rows: p.rows.filter((r) => Date.parse(r.event.commence_time) > now.getTime()) };
}

export interface GameDetail {
  event: EventRow;
  prices: PriceRow[];
  top: PriceRow | null;
  pick: PickRow | null;
  sim: { summary: DistSummary; inputs: { source: string; anchor: MarketAnchor; rest?: { home?: number; away?: number }; snapshot?: { books: number; providers: string[]; pulledAt: string } }; n_sims: number; model_version: string; seed: number; created_at: string } | null;
  histogram: ReturnType<typeof pickHistogram> | null;
  movement: { t: string; value: number; label: string }[];
  movementKind: 'line' | 'prob';
  /** Every book's price on the top pick's exact line in the latest pull (game markets only). */
  bookPrices: { book: string; decimal: number }[];
  writeup: Writeup | null;
  propWriteup: { label: string; writeup: Writeup } | null;
  factors: { label: string; value: string }[];
  providers: string[];
}

export async function gameDetail(id: string): Promise<GameDetail | null> {
  const db = await getDb();
  const event = await getEvent(db, id);
  if (!event || event.source !== 'live') return null;
  const prices = (await db.select<any>('market_prices', { eq: { event_id: id } })).map(normPrice)
    .sort((a, b) => order(a) - order(b) || (a.line ?? 0) - (b.line ?? 0));
  const pick = (await db.select<PickRow>('picks', { eq: { event_id: id }, order: [{ col: 'ev', asc: false }] }))[0] ?? null;
  const top = pick ? prices.find((p) => p.selection_key === pick.selection) ?? null : prices.filter((p) => p.grade !== 'none').sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))[0] ?? null;
  const runs = await db.select<any>('sim_runs', { eq: { event_id: id }, order: [{ col: 'created_at', asc: false }], limit: 1 });
  const sim = runs[0] ?? null;
  const sport = event.sport_id;
  const selForHist = top?.selection ?? prices.find((p) => p.market === 'spread' && p.selection.side === 'home')?.selection ?? null;
  const histogram = sim ? pickHistogram(sim.summary as DistSummary, selForHist, sport) : null;

  // Line movement for the top pick's market, from every stored snapshot.
  const focus = top ?? prices.find((p) => p.market === 'spread' && p.selection.side === 'home') ?? prices.find((p) => p.market === 'ml') ?? null;
  const snaps = focus ? await db.select<{ market: string; line: number | null; prices: Record<string, number>; pulled_at: string; book: string }>('odds_snapshots', { eq: { event_id: id, market: focus.market }, order: [{ col: 'pulled_at', asc: true }] }) : [];
  const pulls = [...new Set(snaps.map((s) => s.pulled_at))];
  const movement: GameDetail['movement'] = [];
  const movementKind: 'line' | 'prob' = focus && (focus.market === 'spread' || focus.market === 'total') ? 'line' : 'prob';
  for (const t of pulls) {
    const at = snaps.filter((s) => s.pulled_at === t);
    if (movementKind === 'line') {
      const c = new Map<number, number>();
      for (const s of at) if (s.line !== null) c.set(Number(s.line), (c.get(Number(s.line)) ?? 0) + 1);
      const modal = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (modal === undefined) continue;
      const v = focus!.market === 'spread' && focus!.selection.side === 'away' ? -modal : modal;
      movement.push({ t, value: v, label: String(v) });
    } else {
      const sides = SPORT_DEFS[sport].threeWay ? ['home', 'away', 'draw'] : ['home', 'away'];
      const cons = consensus(at.filter((s) => sides.every((x) => s.prices[x] > 1)).map((s) => ({ book: s.book, prices: sides.map((x) => s.prices[x]) })));
      if (!cons) continue;
      const v = cons.probs[sides.indexOf(focus!.selection.side)];
      movement.push({ t, value: v, label: `${Math.round(v * 100)}%` });
    }
  }

  // Every book's price for the top pick's exact selection, from the newest pull.
  const bookPrices: GameDetail['bookPrices'] = [];
  if (top && top.market !== 'prop' && pulls.length) {
    const sel = top.selection;
    const homeLine = sel.market === 'spread' && sel.line !== undefined ? (sel.side === 'home' ? sel.line : -sel.line) : sel.line;
    const seen = new Map<string, number>();
    for (const s of snaps.filter((x) => x.pulled_at === pulls[pulls.length - 1])) {
      if (sel.market !== 'ml' && Number(s.line) !== homeLine) continue;
      const d = Number(s.prices?.[sel.side]);
      if (d > 1) seen.set(s.book, d);
    }
    for (const [book, decimal] of seen) bookPrices.push({ book, decimal });
  }

  // Write-up: the stored one for a published pick; otherwise built now from the same stored facts.
  let writeup: Writeup | null = null;
  const stored = pick?.writeup as (Writeup & { facts?: WriteupFacts }) | null;
  if (stored?.edge) writeup = { edge: stored.edge, reasons: stored.reasons ?? [], risk: stored.risk, drivers: stored.drivers ?? [] };
  else if (top && sim && top.best_decimal) {
    const injuries = await injuriesFor(event);
    writeup = buildWriteup({
      sport, home: event.home, away: event.away, selection: top.selection, selectionLabel: selectionLabel(top.selection, event.home, event.away),
      team: top.selection.side === 'home' ? event.home : top.selection.side === 'away' ? event.away : undefined,
      opponent: top.selection.side === 'home' ? event.away : top.selection.side === 'away' ? event.home : undefined,
      bestDecimal: top.best_decimal, book: top.best_book ?? '', modelP: condWin(top.model_probs), consensusP: top.consensus_p ?? NaN,
      fairP: condWin(top.fair_probs), ev: top.ev ?? 0, booksChecked: top.books, modelMargin: sim.summary.meanHome - sim.summary.meanAway,
      modelTotal: sim.summary.meanHome + sim.summary.meanAway, restDays: sim.inputs.rest, injuries,
      modelIndependent: (sim.inputs.source === 'ratings' || sim.inputs.source === 'tennis-elo') && top.fair_source !== 'consensus',
      drawP: sport === 'soccer' ? sim.summary.draw : undefined, bestOf: sport === 'tennis' ? (event.meta as { bestOf?: number }).bestOf : undefined,
      fairSource: top.fair_source,
    });
  }
  // Prop write-up: the best graded prop, from the same stored facts (never invented).
  let propWriteup: { label: string; writeup: Writeup } | null = null;
  const topProp = prices.filter((p) => p.market === 'prop' && p.grade !== 'none' && p.best_decimal).sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))[0];
  if (topProp) {
    const label = selectionLabel(topProp.selection, event.home, event.away);
    propWriteup = {
      label,
      writeup: buildWriteup({
        sport, home: event.home, away: event.away, selection: topProp.selection, selectionLabel: label, bestDecimal: topProp.best_decimal!, book: topProp.best_book ?? '',
        modelP: condWin(topProp.model_probs), consensusP: topProp.consensus_p ?? NaN, fairP: condWin(topProp.fair_probs), ev: topProp.ev ?? 0,
        booksChecked: topProp.books, fairSource: topProp.fair_source, modelIndependent: topProp.fair_source !== 'consensus',
      }),
    };
  }
  const factors = await keyFactors(event, sim, prices);
  return { event, prices, top, pick, sim, histogram, movement, movementKind, bookPrices, writeup, propWriteup, factors, providers: sim?.inputs?.snapshot?.providers ?? [] };
}

const condWin = (o: OutcomeProbs) => (o.win + o.loss > 0 ? o.win / (o.win + o.loss) : NaN);
const order = (p: PriceRow) => ({ ml: 0, spread: 1, total: 2, prop: 3 })[p.market] * 10 + ({ home: 0, away: 1, draw: 2, over: 0, under: 1 } as Record<string, number>)[p.selection.side];

async function injuriesFor(e: EventRow) {
  const db = await getDb();
  const rows = await db.select<{ player: string; team: string | null; status: string; updated_at: string }>('injuries', { eq: { sport: e.sport_id } });
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return rows
    .filter((r) => Date.now() - Date.parse(r.updated_at) < 36 * 3600000 && r.team && (n(r.team) === n(e.home) || n(r.team) === n(e.away)))
    .map((r) => ({ player: r.player, team: (n(r.team!) === n(e.home) ? 'home' : 'away') as 'home' | 'away', status: r.status }));
}

const LEAGUE_AVG_TOTAL: Partial<Record<SportId, number>> = { nba: 228, cbb: 145, nfl: 44, cfb: 54, nhl: 6.1, soccer: 2.7 };

async function keyFactors(e: EventRow, sim: GameDetail['sim'], prices: PriceRow[]) {
  const f: { label: string; value: string }[] = [];
  const rest = sim?.inputs?.rest;
  const restTxt = (d?: number) => (d === undefined ? 'n/a' : d === 0 ? 'back-to-back' : `${d} day${d === 1 ? '' : 's'}`);
  const restSports = ['nba', 'cbb', 'nhl', 'nfl', 'cfb'];
  if (restSports.includes(e.sport_id) && rest && (rest.home !== undefined || rest.away !== undefined)) f.push({ label: 'Rest', value: `${short(e.away)} ${restTxt(rest.away)} · ${short(e.home)} ${restTxt(rest.home)}` });
  const inj = await injuriesFor(e);
  // Injuries only where the injury feed covers the sport (PropLine: NBA, NFL, NHL, CBB, CFB) and only what it lists.
  if (inj.length) f.push({ label: 'Injuries', value: inj.slice(0, 4).map((i) => `${i.player} (${i.status})`).join(', ') });
  const avg = LEAGUE_AVG_TOTAL[e.sport_id];
  if (sim && avg) {
    const t = sim.summary.meanHome + sim.summary.meanAway;
    f.push({ label: e.sport_id === 'nhl' || e.sport_id === 'soccer' ? 'Projected goals' : 'Projected total', value: `${t.toFixed(1)} total (${t >= avg ? '+' : ''}${(((t / avg) - 1) * 100).toFixed(0)}% vs league avg)` });
  }
  const books = Math.max(0, ...prices.map((p) => p.books));
  f.push({ label: 'Books checked', value: String(books || sim?.inputs?.snapshot?.books || 0) });
  if (sim) f.push({ label: 'Model', value: sim.inputs.source === 'ratings' ? `ratings + market blend (${sim.model_version})` : 'market consensus only (not enough results yet for ratings)' });
  return f;
}

export function short(team: string): string {
  const w = team.split(' ');
  return w.length > 1 ? w[w.length - 1] : team;
}

export type Window = '7' | '30' | '90' | 'all';

export interface ResultsData {
  rows: RecordRow[];
  stats: ReturnType<typeof aggregate>;
  curve: ReturnType<typeof cumulativeCurve>;
  bySport: ReturnType<typeof breakdown>;
  byMarket: ReturnType<typeof breakdown>;
  hiddenPending: number;
}

/** Live record only (never backtests). Public visitors see a pick only once its game has started. */
export async function results(window: Window, member: boolean, now = new Date()): Promise<ResultsData> {
  const db = await getDb();
  const picks = await allPicks(db);
  const res = new Map((await db.select<PickResultRow>('pick_results')).map((r) => [r.pick_id, r]));
  const visible = member ? picks : publicVisible(picks, now);
  const from = windowStart(window, now);
  const rows: RecordRow[] = visible
    .filter((p) => !from || p.commence_time >= from)
    .map((p) => ({ ...p, price_decimal: Number(p.price_decimal), fair_decimal: Number(p.fair_decimal), ev: Number(p.ev), stake_units: Number(p.stake_units), result: res.get(p.id) }))
    .sort((a, b) => b.seq - a.seq);
  return { rows, stats: aggregate(rows), curve: cumulativeCurve(rows), bySport: breakdown(rows, 'sport'), byMarket: breakdown(rows, 'market'), hiddenPending: picks.length - visible.length };
}

/** Public chain: full rows for started games; sealed rows (seq + hashes only) for the rest. */
export async function publicChain(member: boolean, now = new Date()) {
  const db = await getDb();
  const picks = await allPicks(db);
  return picks.map((p) => (member || Date.parse(p.commence_time) <= now.getTime()
    ? p
    : { seq: p.seq, prev_hash: p.prev_hash, hash: p.hash, sealed: true }));
}

export async function backtests() {
  const db = await getDb();
  return db.select<{ id: number; sport: string; kind: string; label: string; games: number; games_with_odds: number; metrics: any; curve: any; from_date: string | null; to_date: string | null; source: string; created_at: string }>('backtest_runs', { order: [{ col: 'created_at', asc: false }], limit: 50 });
}

export interface EdgeLogEntry {
  edge_key: string; first_shown_at: string; sport: string; event_name: string; start_time: string; market: string; selection_label: string;
  book: string; price_taken: number; fair_price: number; edge_pct: number; grade: 'A' | 'B'; fair_source: string;
  closing_price: number | null; clv: number | null; result: string | null; units: number | null;
}

/**
 * The edge log (every edge the moment it was first shown). Public visitors see an edge only once its
 * game has started, like sealed picks; members see everything. Units are at a flat 1-unit stake.
 */
export async function edgeLog(member: boolean, now = new Date(), limit = 100) {
  const db = await getDb();
  let rows: EdgeLogEntry[] = [];
  try {
    rows = (await db.select<any>('edges_log', { ...(member ? {} : { lte: { start_time: now.toISOString() } }), order: [{ col: 'first_shown_at', asc: false }], limit: 5000 }))
      .map((r) => ({ ...r, price_taken: Number(r.price_taken), fair_price: Number(r.fair_price), edge_pct: Number(r.edge_pct), closing_price: num(r.closing_price), clv: num(r.clv), units: num(r.units) }));
  } catch { rows = []; } // migration 0002 not applied yet
  const settled = rows.filter((r) => r.result && r.result !== 'void');
  const withClv = rows.filter((r) => r.clv !== null);
  const units = settled.reduce((a, r) => a + (r.units ?? 0), 0);
  return {
    rows: rows.slice(0, limit),
    stats: {
      shown: rows.length, settled: settled.length, units, roi: settled.length ? units / settled.length : null,
      avgEdge: rows.length ? rows.reduce((a, r) => a + r.edge_pct, 0) / rows.length : null,
      avgClv: withClv.length ? withClv.reduce((a, r) => a + (r.clv ?? 0), 0) / withClv.length : null, clvN: withClv.length,
      beatClose: withClv.length ? withClv.filter((r) => (r.clv ?? 0) > 0).length / withClv.length : null,
    },
  };
}
