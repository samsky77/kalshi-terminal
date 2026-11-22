import Link from 'next/link';
import { SPORT_DEFS, SPORTS, type SportId } from '@sigmaline/core';
import type { EdgeRow, FeedPrice } from '@sigmaline/db';
import { Ago, FreshRow } from '@/components/ago';
import { PropRow } from '@/components/prop-row';
import { Pending } from '@/components/pending';
import { Footer, GradeBadge, Header, Main } from '@/components/chrome';
import { SportTabs } from '@/components/sport-tabs';
import { isPriceStale, propsFeed, quotaState, slate, staleMinutes } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, bookName, dayTime, pct, time } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Slate' };

type View = 'lines' | 'props';

export default async function SlatePage({ searchParams }: { searchParams: Promise<{ sport?: string; edges?: string; view?: string; all?: string }> }) {
  const sp = await searchParams;
  const sport = (SPORTS as string[]).includes(sp.sport ?? '') ? (sp.sport as SportId) : 'nba';
  const view: View = sp.view === 'props' ? 'props' : 'lines';
  const edgesOnly = sp.edges === '1';
  await requirePaid(`/slate?sport=${sport}`);
  const now = Date.now();
  const sm = staleMinutes();
  const qs = (o: { sport?: SportId; edges?: boolean; view?: View }) => {
    const p = new URLSearchParams({ sport: o.sport ?? sport });
    if (o.edges ?? edgesOnly) p.set('edges', '1');
    if ((o.view ?? view) === 'props') p.set('view', 'props');
    return `/slate?${p}`;
  };
  return (
    <>
      <Header demo={demoMode()} />
      <SportTabs active={sport} hrefFor={(s) => qs({ sport: s })} />
      <Main>
        <h1 className="sr-only">{SPORT_DEFS[sport].label} slate: {view === 'props' ? 'player props' : 'game lines'}</h1>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <nav aria-label="Market type" className="flex gap-1">
            {(['lines', 'props'] as View[]).map((v) => (
              <Link key={v} href={qs({ view: v })} prefetch={false} aria-current={v === view ? 'page' : undefined}
                className={`tap inline-flex items-center rounded-full border px-4 text-[11px] font-semibold uppercase tracking-[0.12em] ${v === view ? 'border-amber text-amber' : 'border-line text-muted'}`}>
                {v === 'lines' ? 'Game lines' : 'Props'}
                <Pending />
              </Link>
            ))}
          </nav>
          <Link href={qs({ edges: !edgesOnly })} prefetch={false} aria-label={`Edges only: ${edgesOnly ? 'on, show every game' : 'off, show only games with an edge'}`}
            className={`tap inline-flex items-center gap-2 rounded-full border px-4 text-[11px] font-semibold uppercase tracking-[0.12em] ${edgesOnly ? 'border-amber text-amber' : 'border-line text-muted'}`}>
            <span aria-hidden className={`inline-block h-2.5 w-2.5 ${edgesOnly ? 'bg-amber' : 'border border-muted'}`} />
            Edges only
            <Pending />
          </Link>
        </div>
        {view === 'lines' ? <Lines sport={sport} edgesOnly={edgesOnly} now={now} sm={sm} showAll={sp.all === '1'} allHref={`${qs({})}&all=1`} /> : <Props sport={sport} edgesOnly={edgesOnly} now={now} sm={sm} />}
      </Main>
      <Footer />
    </>
  );
}

/** Long slates (CBB can have 70+ games) show the first rows; the rest load on request (SLO-003). */
const SLATE_PAGE = 40;

async function Lines({ sport, edgesOnly, now, sm, showAll, allHref }: { sport: SportId; edgesOnly: boolean; now: number; sm: number; showAll: boolean; allHref: string }) {
  const [{ rows, asOf }, quota] = await Promise.all([slate(sport), quotaState()]);
  // Games with no price at all aren't shown as rows (DAT-001); they're counted under the list.
  const priced = rows.filter((r) => r.top || r.main);
  const unpriced = rows.length - priced.length;
  const matching = edgesOnly ? priced.filter((r) => r.top) : priced;
  const shown = showAll ? matching : matching.slice(0, SLATE_PAGE);
  const hidden = matching.length - shown.length;
  const exhausted = Object.values(quota).some((q) => q.mode === 'exhausted');
  const today = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const stalePrices = (exhausted || isPriceStale(asOf, now)) && !!asOf;
  return (
    <div className="mx-auto max-w-3xl px-4">
      <p className="label pb-2">{priced.length} upcoming {priced.length === 1 ? 'game' : 'games'} · times ET</p>
      {stalePrices && (
        <p className="mb-3 rounded-lg border border-dashed border-[#c9a24a] px-3 py-2 text-[12.5px] text-[#c9a24a]" role="status">
          <span className="mr-2 inline-flex min-h-[22px] items-center rounded-full border border-[#c9a24a] px-2 text-[11px] font-semibold uppercase tracking-[0.08em]">Stale</span>
          Prices are from {dayTime(asOf!)} ET, older than {sm} min. Edges are hidden until the next refresh.
        </p>
      )}
      {shown.length === 0 && (
        <div className="rounded-xl border border-dashed border-line p-4 text-[13.5px] text-muted" role="status">
          <b className="mb-1 block text-ink">{edgesOnly && rows.length ? 'No live edges right now' : 'No data'}</b>
          {edgesOnly && rows.length ? 'Turn off “Edges only” to see every game.' : `No upcoming ${SPORT_DEFS[sport].label} games have prices on the board yet. We never fill gaps with guesses.`}
        </div>
      )}
      <ul>
        {shown.map((r) => {
          const p = r.top ?? r.main;
          const edge = !!r.top;
          const isToday = new Date(r.event.commence_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === today;
          const [away, home] = r.event.label.split(' @ ');
          return (
            <FreshRow key={r.event.id} ts={p?.price_ts ?? null} staleMin={sm} serverNow={now} className="border-b border-line2">
              <Link href={`/game/${encodeURIComponent(r.event.id)}`} prefetch={false} className="grid min-h-[68px] grid-cols-[56px_1fr_auto] items-center gap-3 py-2 hover:bg-panel"
                aria-label={`${r.event.label}, ${time(r.event.commence_time)} Eastern. ${p ? (edge ? `Best edge ${pct(p.ev)}: ${p.label} ${american(p.best_decimal)} at ${bookName(p.best_book)}` : 'No edge') : 'No prices yet'}.`}>
                <span className="text-[12.5px] leading-tight text-muted">
                  {time(r.event.commence_time)}
                  <span className="block text-[11px] uppercase tracking-[0.08em]">{isToday ? SPORT_DEFS[r.event.sport].tab : dayLabel(r.event.commence_time, now)}</span>
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-[14.5px] leading-snug ${edge ? 'text-ink' : 'text-muted'}`}>{away}</span>
                  <span className="block truncate text-[12.5px] text-muted">at {home}</span>
                  <Ago ts={p?.price_ts ?? null} staleMin={sm} serverNow={now} className="!text-[11px]" />
                </span>
                <span className="edge-chip flex min-w-[72px] justify-end">
                  {edge ? (
                    <span className="inline-flex min-h-[28px] items-center rounded-full bg-amber px-3 text-[13px] font-bold text-black" aria-hidden>{pct(p!.ev)}</span>
                  ) : <span className="text-[13px] text-muted" aria-hidden>{p ? '—' : 'No data'}</span>}
                </span>
              </Link>
            </FreshRow>
          );
        })}
      </ul>
      {hidden > 0 && <Link href={allHref} prefetch={false} className="tap my-3 inline-flex w-full items-center justify-center rounded-xl border border-line text-[12px] uppercase tracking-[0.12em] text-ink">Show all {matching.length} games<Pending /></Link>}
      {unpriced > 0 && <p className="py-3 text-[12px] text-muted">{unpriced} more {unpriced === 1 ? 'game has' : 'games have'} no prices from the books yet and will appear once they do.</p>}
      <p className="pt-2 text-[12px] text-muted">One number per game: the best edge, if any. Tap a game for the pick, the price and the why.</p>
    </div>
  );
}

/** "Tmrw" for tomorrow (US Eastern), else the weekday. */
function dayLabel(iso: string, now: number): string {
  const ymd = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return ymd(Date.parse(iso)) === ymd(now + 86400000) ? 'Tmrw' : new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
}

/** Props tab: every prop market the provider returned for this sport, main line per player and stat. */
async function Props({ sport, edgesOnly, now, sm }: { sport: SportId; edgesOnly: boolean; now: number; sm: number }) {
  const { rows, events } = await propsFeed(sport);
  const live = (r: FeedPrice) => r.grade !== 'none' && !(now - Date.parse(r.price_ts ?? '') > sm * 60000);
  const shown = edgesOnly ? rows.filter(live) : rows;
  if (!rows.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center text-[13px] text-muted" role="status">
        <p className="text-ink">No {SPORT_DEFS[sport].label} player props right now.</p>
        <p className="mt-1">{sport === 'tennis' ? 'Our data provider doesn’t send tennis player props yet.' : 'Books haven’t posted props for the upcoming games yet, or our data provider doesn’t carry them. Props appear here as soon as a book lists them.'}</p>
      </div>
    );
  }
  const byEvent = new Map<string, EdgeRow[]>();
  for (const r of shown) { const a = byEvent.get(r.event.id); if (a) a.push(r); else byEvent.set(r.event.id, [r]); }
  return (
    <div className="mx-auto max-w-3xl px-4">
      <p className="label pb-1">{rows.length} prop prices · {events} {events === 1 ? 'game' : 'games'}</p>
      {shown.length === 0 && <p className="py-10 text-center text-[13px] text-muted">No live prop edges right now. Turn off “Edges only” to see every prop, or check Game lines for this sport.</p>}
      {[...byEvent.values()].map((list) => (
        <section key={list[0].event.id} className="mt-3" aria-label={list[0].event.label}>
          <h2 className="label border-b border-line pb-1"><Link href={`/game/${encodeURIComponent(list[0].event.id)}`} prefetch={false} className="hover:text-ink">{list[0].event.label} · {time(list[0].event.commence_time)}</Link></h2>
          <ul>
            {list.map((r) => <PropRow key={r.selection_key} r={r} now={now} sm={sm} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
