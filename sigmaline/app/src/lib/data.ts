import 'server-only';
import {
  buildWriteup, budgetMode, consensus, pickHistogram, selectionLabel, SPORT_DEFS,
  type DistSummary, type Grade, type MarketAnchor, type OutcomeProbs, type Selection, type SportId, type WriteupFacts, type Writeup,
} from '@sigmaline/core';
import {
  aggregate, allPicks, breakdown, cumulativeCurve, getEvent, getEvents, getSettings, periodUsage, publicVisible, windowStart,
  type EventRow, type PickResultRow, type PickRow, type RecordRow,
} from '@sigmaline/db';
import { getDb } from './db';

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
}

export interface SlateRow {
  event: EventRow;
  label: string;
  top: PriceRow | null;
  /** Shown when there is no edge: the main spread (or ML) best price. */
  main: PriceRow | null;
  published: boolean;
  started: boolean;
  snapshotTs: string | null;
}

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
function normPrice(r: any): PriceRow {
  return { ...r, line: num(r.line), fair_decimal: num(r.fair_decimal), consensus_p: num(r.consensus_p), best_decimal: num(r.best_decimal), ev: num(r.ev), model_ev: num(r.model_ev), consensus_ev: num(r.consensus_ev), books: Number(r.books) };
}

export function isPriceStale(snapshotTs: string | null, now = Date.now()): boolean {
  return !snapshotTs || now - Date.parse(snapshotTs) > 6 * 3600000;
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

/** Slate: every game today and tomorrow for a sport, with its best edge, sorted by EV. */
export async function slate(sport: SportId, now = new Date()): Promise<{ rows: SlateRow[]; asOf: string | null; providers: string[] }> {
  const db = await getDb();
  const start = new Date(now.getTime() - 4 * 3600000);
  const tomorrowEnd = new Date(now); tomorrowEnd.setUTCHours(24 * 2 + 10, 0, 0, 0); // through tomorrow night (US time)
  const evs = (await getEvents(db, { sport, from: start.toISOString(), to: tomorrowEnd.toISOString() }))
    .filter((e) => e.source === 'live' && e.status !== 'final' && e.status !== 'void' && e.status !== 'postponed');
  const ids = evs.map((e) => e.id);
  const prices = ids.length ? (await db.select<any>('market_prices', { in: { event_id: ids } })).map(normPrice) : [];
  const picks = ids.length ? await db.select<PickRow>('picks', { in: { event_id: ids } }) : [];
  const providers = ids.length ? [...new Set((await db.select<{ provider: string }>('odds_snapshots', { in: { event_id: ids.slice(0, 50) }, limit: 2000 })).map((s) => s.provider))] : [];
  let asOf: string | null = null;
  const rows: SlateRow[] = evs.map((e) => {
    const ps = prices.filter((p) => p.event_id === e.id && p.market !== 'prop');
    const graded = ps.filter((p) => p.grade !== 'none' && p.ev !== null).sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
    const top = graded[0] ?? null;
    const main = top ?? mainPrice(ps);
    const ts = ps.reduce<string | null>((m, p) => (p.snapshot_ts && (!m || p.snapshot_ts > m) ? p.snapshot_ts : m), null);
    if (ts && (!asOf || ts > asOf)) asOf = ts;
    return {
      event: e, label: sport === 'soccer' || sport === 'tennis' ? `${e.away} @ ${e.home}` : `${short(e.away)} @ ${short(e.home)}`, top, main, published: picks.some((p) => p.event_id === e.id),
      started: Date.parse(e.commence_time) <= now.getTime(), snapshotTs: ts,
    };
  });
  rows.sort((a, b) => (b.top?.ev ?? -1) - (a.top?.ev ?? -1) || a.event.commence_time.localeCompare(b.event.commence_time));
  return { rows, asOf, providers };
}

/** Main line to display when there is no edge: modal spread, else moneyline favourite. */
function mainPrice(ps: PriceRow[]): PriceRow | null {
  const sp = ps.filter((p) => p.market === 'spread' && p.selection.side === 'home' && p.best_decimal);
  if (sp.length) return sp.sort((a, b) => b.books - a.books)[0];
  const ml = ps.filter((p) => p.market === 'ml' && p.best_decimal);
  return ml.sort((a, b) => b.books - a.books)[0] ?? null;
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
  writeup: Writeup | null;
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
      modelIndependent: sim.inputs.source === 'ratings' || sim.inputs.source === 'tennis-elo',
    });
  }
  const factors = await keyFactors(event, sim, prices);
  return { event, prices, top, pick, sim, histogram, movement, movementKind, writeup, factors, providers: sim?.inputs?.snapshot?.providers ?? [] };
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
  if (rest && (rest.home !== undefined || rest.away !== undefined)) f.push({ label: 'Rest', value: `${short(e.away)} ${restTxt(rest.away)} · ${short(e.home)} ${restTxt(rest.home)}` });
  const inj = await injuriesFor(e);
  f.push({ label: 'Injuries', value: inj.length ? inj.slice(0, 4).map((i) => `${i.player} (${i.status})`).join(', ') : 'none listed' });
  const avg = LEAGUE_AVG_TOTAL[e.sport_id];
  if (sim && avg) {
    const t = sim.summary.meanHome + sim.summary.meanAway;
    f.push({ label: e.sport_id === 'nhl' || e.sport_id === 'soccer' ? 'Projected goals' : 'Projected pace', value: `${t.toFixed(1)} total (${t >= avg ? '+' : ''}${(((t / avg) - 1) * 100).toFixed(0)}% vs league avg)` });
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
