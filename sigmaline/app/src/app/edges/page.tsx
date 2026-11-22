import Link from 'next/link';
import { GRADE_CONFIG, SPORT_DEFS, SPORTS } from '@sigmaline/core';
import { applyEdgeFilters, parseEdgeFilters } from '@sigmaline/db';
import { Ago, FreshRow } from '@/components/ago';
import { EdgeMeter } from '@/components/charts';
import { Footer, Header, Main } from '@/components/chrome';
import { edgeFeed, staleMinutes } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, bookName, pct, time } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edge Finder' };

const MIN_EDGES = ['', '2', '3', '5', '8'];

export default async function EdgeFinder({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requirePaid('/edges');
  const f = parseEdgeFilters(sp, SPORTS);
  const now = Date.now();
  const sm = staleMinutes();
  const feed = await edgeFeed();
  const rows = applyEdgeFilters(feed.rows, f);
  // One idea per game, market and book: several alternate lines at one book are the same bet, shown once.
  const byIdea = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.event_id}|${r.market}|${r.best_book}|${r.selection.player ?? ''}|${r.selection.stat ?? ''}`; byIdea.set(k, [...(byIdea.get(k) ?? []), r]); }
  const groups = [...byIdea.values()].map((g) => { const sorted = [...g].sort((x, y) => (y.ev ?? 0) - (x.ev ?? 0)); return { lead: sorted[0], rest: sorted.slice(1) }; });
  // The active book stays selectable even with no live edges right now (EFP-002).
  const books = [...new Set([...feed.rows.map((r) => r.best_book).filter(Boolean) as string[], ...(f.book !== 'all' ? [f.book] : [])])].sort();
  // The active minimum stays selectable even if it isn't a preset (EFP-003).
  const minNow = f.minEdge ? String(Math.round(f.minEdge * 1000) / 10) : '';
  const minOptions = [...new Set([...MIN_EDGES, minNow])].sort((a, b) => Number(a || 0) - Number(b || 0));
  const sel = 'tap w-full border border-line bg-panel px-2 text-[13px] text-ink';
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3">
          <h1 className="text-[20px] font-semibold">Best bets</h1>
          <p className="mt-1 text-[13px] text-muted">
            The best-priced bets right now, biggest edge first. An edge is how much better a book&apos;s price is than the fair price built from every book. Only prices updated in the last {sm} minutes count, and only edges of {pct(GRADE_CONFIG.B.minEdge, 0, false)} or more are shown.
          </p>
          <details open={f.sport !== 'all' || f.type !== 'all' || f.book !== 'all' || !!f.minEdge || f.grade !== 'all' || f.sort !== 'edge'} className="group mt-3 rounded-2xl border border-line2 bg-panel">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 font-sans text-[15px] [&::-webkit-details-marker]:hidden">
              <span>Filters{f.sport !== 'all' || f.type !== 'all' || f.book !== 'all' || !!f.minEdge || f.grade !== 'all' || f.sort !== 'edge' && <span className="ml-2 text-[12px] text-amber">on</span>}</span>
              <span aria-hidden className="text-[20px] text-amber group-open:hidden">+</span>
              <span aria-hidden className="hidden text-[20px] text-amber group-open:inline">–</span>
            </summary>
            <div className="px-4 pb-4">
          {/* key: remount on every filter change so the selects always show the active filters (EFP-001). */}
          <form key={JSON.stringify(f)} method="get" className="grid grid-cols-2 gap-2 sm:grid-cols-6" aria-label="Filter edges">
            <label className="flex flex-col gap-1"><span className="label">Sport</span>
              <select name="sport" defaultValue={f.sport} className={sel}>
                <option value="all">All</option>
                {SPORTS.map((s) => <option key={s} value={s}>{SPORT_DEFS[s].tab}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Market</span>
              <select name="type" defaultValue={f.type} className={sel}>
                <option value="all">All</option><option value="game">Game lines</option><option value="prop">Props</option>
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Book</span>
              <select name="book" defaultValue={f.book} className={sel}>
                <option value="all">All</option>
                {books.map((b) => <option key={b} value={b}>{bookName(b)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Min edge</span>
              <select name="min" defaultValue={minNow} className={sel}>
                {minOptions.map((m) => <option key={m} value={m}>{m ? `${m}%+` : 'Any'}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Grade</span>
              <select name="grade" defaultValue={f.grade} className={sel}>
                <option value="all">A + B</option><option value="A">A only</option><option value="B">B only</option>
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Sort</span>
              <select name="sort" defaultValue={f.sort} className={sel}>
                <option value="edge">Biggest edge</option><option value="start">Starting soonest</option><option value="updated">Recently updated</option>
              </select>
            </label>
            <div className="col-span-2 flex gap-2 sm:col-span-6">
              <button type="submit" className="tap flex-1 border border-amber px-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-amber">Apply filters</button>
              <Link href="/edges" prefetch={false} className="tap inline-flex items-center border border-line px-4 text-[12px] uppercase tracking-[0.12em] text-muted">Reset</Link>
            </div>
          </form>
            </div>
          </details>
          <p className="label mt-3 border-b border-line pb-1" role="status">{groups.length} {groups.length === 1 ? 'idea' : 'ideas'} · {rows.length} of {feed.rows.length} live {feed.rows.length === 1 ? 'edge' : 'edges'}</p>
          {rows.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted">
              {feed.rows.length ? 'No edges match these filters. Loosen them or press Reset.' : (f.type === 'prop' ? 'No live prop edges right now. Props are only priced for sports and books that post them; try Market = All, or another sport.' : 'No live edges right now. Edges appear as soon as a book is out of line with the fair price, and disappear when the price goes stale or the game starts.')}
            </p>
          )}
          <ul className="mt-2">
            {groups.map(({ lead, rest }) => (
              <li key={`${lead.event_id}|${lead.selection_key}`} className="mb-3">
                <FreshRow as="div" ts={lead.price_ts} staleMin={sm} serverNow={now} className="rounded-2xl border border-line2 bg-panel">
                  <Link href={`/game/${encodeURIComponent(lead.event_id)}`} prefetch={false} className="block p-4 hover:bg-[#101010]"
                    aria-label={`${lead.event.label}, ${time(lead.event.commence_time)} Eastern. ${lead.label} ${american(lead.best_decimal)} at ${bookName(lead.best_book)}, fair ${american(lead.fair_decimal)}, edge ${pct(lead.ev)}${rest.length ? `, plus ${rest.length} more lines at the same book` : ''}.`}>
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-muted">{SPORT_DEFS[lead.event.sport].tab} · {lead.market === 'prop' ? 'Prop' : 'Game line'} · {time(lead.event.commence_time)}</span>
                    <span className="mt-1 block font-sans text-[19px] font-semibold leading-tight">{lead.label}</span>
                    <span className="block truncate text-[12.5px] text-muted">{lead.event.label}</span>
                    <span className="mt-3 flex gap-6">
                      <span><span className="label block">Book</span><span className="text-[16px] font-semibold">{bookName(lead.best_book)}</span></span>
                      <span><span className="label block">Price</span><span className="text-[16px] font-semibold">{american(lead.best_decimal)}</span></span>
                      <span className="edge-chip"><span className="label block">Edge</span><span className="text-[16px] font-semibold text-amber">{pct(lead.ev)}</span></span>
                    </span>
                    <EdgeMeter ev={lead.ev ?? 0} min={GRADE_CONFIG.B.minEdge} />
                    <span className="prose-sl block text-[13.5px] leading-snug text-muted">Fair price is {american(lead.fair_decimal)}; this pays {american(lead.best_decimal)}. {lead.books} books priced it.{lead.books <= 5 ? ' Few books: lower confidence.' : ''}{rest.length ? <b className="text-ink"> {rest.length} other {rest.length === 1 ? 'line' : 'lines'} at {bookName(lead.best_book)} also {rest.length === 1 ? 'shows' : 'show'} an edge: one idea, not {rest.length + 1}.</b> : null}</span>
                    <Ago ts={lead.price_ts} staleMin={sm} serverNow={now} />
                  </Link>
                </FreshRow>
                {rest.length > 0 && (
                  <details className="mt-1.5 rounded-xl border border-line2">
                    <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-[13px] text-muted">Other {rest.length === 1 ? 'line' : 'lines'} at {bookName(lead.best_book)}</summary>
                    <ul className="px-4 pb-3 text-[13px]">{rest.map((r) => <li key={r.selection_key} className="flex justify-between border-t border-line2 py-2"><span>{r.label}</span><span>{american(r.best_decimal)} <span className="ml-2 text-amber">{pct(r.ev)}</span></span></li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Main>
      <Footer />
    </>
  );
}
