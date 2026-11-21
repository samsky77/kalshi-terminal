import Link from 'next/link';
import { GRADE_CONFIG, SPORT_DEFS, SPORTS } from '@sigmaline/core';
import { applyEdgeFilters, parseEdgeFilters } from '@sigmaline/db';
import { Ago, FreshRow } from '@/components/ago';
import { Footer, GradeBadge, Header, Main } from '@/components/chrome';
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
          <h1 className="text-[18px] font-semibold">Edge Finder</h1>
          <p className="mt-1 text-[12px] text-muted">
            Every live edge across all sports, game lines and player props. Edge = fair probability × decimal odds − 1. Only prices updated in the last {sm} minutes count. Grades: A ≥ {pct(GRADE_CONFIG.A.minEdge, 0, false)} with model and consensus agreeing, B {pct(GRADE_CONFIG.B.minEdge, 0, false)}–{pct(GRADE_CONFIG.B.maxEdge, 0, false)}.
          </p>
          {/* key: remount on every filter change so the selects always show the active filters (EFP-001). */}
          <form key={JSON.stringify(f)} method="get" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6" aria-label="Filter edges">
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
          <p className="label mt-3 border-b border-line pb-1" role="status">{rows.length} of {feed.rows.length} live {feed.rows.length === 1 ? 'edge' : 'edges'}</p>
          {rows.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted">
              {feed.rows.length ? 'No edges match these filters. Loosen them or press Reset.' : (f.type === 'prop' ? 'No live prop edges right now. Props are only priced for sports and books that post them; try Market = All, or another sport.' : 'No live edges right now. Edges appear as soon as a book is out of line with the fair price, and disappear when the price goes stale or the game starts.')}
            </p>
          )}
          <ul>
            {rows.map((r) => (
              <FreshRow key={`${r.event_id}|${r.selection_key}`} ts={r.price_ts} staleMin={sm} serverNow={now} className="border-b border-line2">
                <Link href={`/game/${encodeURIComponent(r.event_id)}`} prefetch={false} className="grid grid-cols-[1fr_auto] gap-2 py-2 hover:bg-panel"
                  aria-label={`${r.event.label}, ${time(r.event.commence_time)} Eastern. ${r.label} ${american(r.best_decimal)} at ${bookName(r.best_book)}, fair ${american(r.fair_decimal)}, edge ${pct(r.ev)}, grade ${r.grade}${r.fair_source === 'consensus' ? ', consensus-only' : ''}.`}>
                  <span className="min-w-0">
                    <span className="block text-[11px] uppercase tracking-[0.1em] text-muted">{SPORT_DEFS[r.event.sport].tab} · {r.market === 'prop' ? 'Prop' : 'Game line'} · {time(r.event.commence_time)}</span>
                    <span className="block truncate text-[12px] text-muted">{r.event.label}</span>
                    <span className="block text-[13px] leading-snug text-ink">{r.label}</span>
                    <span className="block text-[12px]"><span className="text-amber">{american(r.best_decimal)}</span> <span className="text-muted">{bookName(r.best_book)} · {r.books} books</span></span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Ago ts={r.price_ts} staleMin={sm} serverNow={now} />
                      {r.fair_source === 'consensus' && <span className="text-[11px] uppercase tracking-[0.1em] text-muted">consensus-only</span>}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1 text-right">
                    <span className="text-[12px] text-fair">fair {american(r.fair_decimal)}</span>
                    <span className="edge-only text-[14px] font-semibold text-amber">{pct(r.ev)}</span>
                    <span className="edge-only"><GradeBadge grade={r.grade} /></span>
                  </span>
                </Link>
              </FreshRow>
            ))}
          </ul>
        </div>
      </Main>
      <Footer />
    </>
  );
}
