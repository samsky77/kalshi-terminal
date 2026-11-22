import { EDGE_FLAG_THRESHOLD, GRADE_CONFIG, ageMinutes, bookName, formatAmerican, SPORTS, type SportId } from '@sigmaline/core';
import { feedEvent, getEvents, normPrice } from '@sigmaline/db';
import type { Ctx } from './context';

/**
 * `npm run worker -- edges [sport…]` prints the edges on today's real slate straight from the price board
 * the worker maintains (market_prices), so you can check the engine without opening the app.
 * Edge = no-vig consensus probability × best bettable decimal price − 1. Nothing here is invented:
 * a game with no usable consensus or price is listed as "no data", and prices past the stale window are marked STALE.
 */
export async function edgesToday(ctx: Ctx, sports: SportId[] = SPORTS, hours = 24): Promise<string> {
  const now = ctx.now().getTime();
  const out: string[] = [];
  const events = (await getEvents(ctx.db, { from: new Date(now).toISOString(), to: new Date(now + hours * 3600000).toISOString(), status: ['scheduled'] })).filter((e) => sports.includes(e.sport_id));
  out.push(`Sigmaline edges, next ${hours}h · now ${new Date(now).toISOString()} · flag threshold ${(EDGE_FLAG_THRESHOLD * 100).toFixed(1)}% · stale after ${GRADE_CONFIG.staleMinutes} min`);
  out.push(`${events.length} scheduled games on the slate`);
  if (!events.length) { out.push('No data: no scheduled games found.'); return out.join('\n'); }
  const byId = new Map(events.map((e) => [e.id, e]));
  const rows: Record<string, unknown>[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 80) rows.push(...(await ctx.db.select<Record<string, unknown>>('market_prices', { in: { event_id: ids.slice(i, i + 80) } })));
  type Line = { sport: string; game: string; start: string; label: string; book: string; price: string; fair: string; edge: number; books: number; age: number; stale: boolean; grade: string };
  const lines: Line[] = [];
  const per = new Map<string, { priced: number; flagged: number; stale: number; newest: number }>();
  let newest = 0;
  for (const r of rows) {
    const e = byId.get(String(r.event_id))!;
    const p = normPrice(r, e.home, e.away);
    if (p.ev === null || p.best_decimal === null) continue;
    const age = ageMinutes(p.price_ts, now);
    const stale = age > GRADE_CONFIG.staleMinutes;
    const s = per.get(e.sport_id) ?? { priced: 0, flagged: 0, stale: 0, newest: 0 };
    s.priced++; if (stale) s.stale++;
    const t = p.price_ts ? Date.parse(p.price_ts) : 0; if (t > s.newest) s.newest = t; if (t > newest) newest = t;
    if (p.ev >= EDGE_FLAG_THRESHOLD) {
      s.flagged++;
      const f = feedEvent(e);
      lines.push({ sport: e.sport_id, game: f.label, start: e.commence_time.slice(5, 16).replace('T', ' '), label: p.label, book: bookName(p.best_book), price: formatAmerican(p.best_decimal),
        fair: p.fair_decimal ? formatAmerican(p.fair_decimal) : '—', edge: p.ev, books: p.books, age, stale, grade: p.grade });
    }
    per.set(e.sport_id, s);
  }
  out.push(`Newest price on the board: ${newest ? new Date(newest).toISOString() + ` (${Math.round((now - newest) / 60000)} min ago)` : 'none (No data)'}`);
  out.push('');
  out.push('sport    priced  edges>=thr  stale  newest price');
  for (const sp of sports) {
    const s = per.get(sp);
    out.push(`${sp.padEnd(8)} ${String(s?.priced ?? 0).padStart(6)}  ${String(s?.flagged ?? 0).padStart(10)}  ${String(s?.stale ?? 0).padStart(5)}  ${s?.newest ? Math.round((now - s.newest) / 60000) + ' min ago' : 'No data'}`);
  }
  out.push('');
  lines.sort((a, b) => b.edge - a.edge);
  if (!lines.length) out.push(`No edges at or above ${(EDGE_FLAG_THRESHOLD * 100).toFixed(1)}% right now.`);
  for (const l of lines.slice(0, 60)) {
    out.push(`${(l.edge * 100).toFixed(1).padStart(5)}%  ${l.grade === 'none' ? '-' : l.grade}  ${l.sport.padEnd(6)} ${l.game.slice(0, 34).padEnd(34)} ${l.start}  ${l.label.slice(0, 30).padEnd(30)} ${l.price.padStart(5)} @ ${l.book.slice(0, 14).padEnd(14)} fair ${l.fair.padStart(5)}  ${String(l.books).padStart(3)} books  ${Math.round(l.age)}m${l.stale ? ' STALE' : ''}`);
  }
  if (lines.length > 60) out.push(`… and ${lines.length - 60} more`);
  return out.join('\n');
}
