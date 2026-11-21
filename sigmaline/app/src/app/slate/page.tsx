import Link from 'next/link';
import { SPORT_DEFS, SPORTS, type SportId } from '@sigmaline/core';
import type { EdgeRow, FeedPrice } from '@sigmaline/db';
import { Ago, FreshRow } from '@/components/ago';
import { PropRow } from '@/components/prop-row';
import { Footer, GradeBadge, Header, Main } from '@/components/chrome';
import { SportTabs } from '@/components/sport-tabs';
import { isPriceStale, propsFeed, quotaState, slate, staleMinutes } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, bookName, dayTime, pct, time } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Slate' };

type View = 'lines' | 'props';

export default async function SlatePage({ searchParams }: { searchParams: Promise<{ sport?: string; edges?: string; view?: string }> }) {
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
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <nav aria-label="Market type" className="flex gap-1">
            {(['lines', 'props'] as View[]).map((v) => (
              <Link key={v} href={qs({ view: v })} prefetch={false} aria-current={v === view ? 'page' : undefined}
                className={`tap inline-flex items-center border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${v === view ? 'border-amber text-amber' : 'border-line text-muted'}`}>
                {v === 'lines' ? 'Game lines' : 'Props'}
              </Link>
            ))}
          </nav>
          <Link href={qs({ edges: !edgesOnly })} prefetch={false} role="switch" aria-checked={edgesOnly}
            className={`tap inline-flex items-center gap-2 border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${edgesOnly ? 'border-amber text-amber' : 'border-line text-muted'}`}>
            <span aria-hidden className={`inline-block h-2.5 w-2.5 ${edgesOnly ? 'bg-amber' : 'border border-muted'}`} />
            Edges only
          </Link>
        </div>
        {view === 'lines' ? <Lines sport={sport} edgesOnly={edgesOnly} now={now} sm={sm} /> : <Props sport={sport} edgesOnly={edgesOnly} now={now} sm={sm} />}
      </Main>
      <Footer />
    </>
  );
}

async function Lines({ sport, edgesOnly, now, sm }: { sport: SportId; edgesOnly: boolean; now: number; sm: number }) {
  const [{ rows, asOf }, quota] = await Promise.all([slate(sport), quotaState()]);
  const shown = edgesOnly ? rows.filter((r) => r.top) : rows;
  const exhausted = Object.values(quota).some((q) => q.mode === 'exhausted');
  const today = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  return (
    <div className="mx-auto max-w-3xl px-4">
      <p className="label pb-1">{rows.length} upcoming {rows.length === 1 ? 'game' : 'games'} · 10,000 sims each</p>
      {(exhausted || isPriceStale(asOf, now)) && asOf && (
        <p className="pb-2 text-[12px] text-amber" role="status">Latest prices are from {dayTime(asOf)} ET, older than {sm} min, so no grades are shown until the next refresh.</p>
      )}
      <div className="grid grid-cols-[52px_1fr_auto] gap-2 border-b border-line pb-1" aria-hidden>
        <span className="label">Start</span>
        <span className="label">Best line · book</span>
        <span className="label text-right">Fair · Edge</span>
      </div>
      {shown.length === 0 && (
        <p className="py-10 text-center text-[13px] text-muted">
          {edgesOnly && rows.length ? 'No live edges on this slate right now. Turn off “Edges only” to see every game.' : `No upcoming ${SPORT_DEFS[sport].label} games on the board for today or tomorrow.`}
        </p>
      )}
      <ul>
        {shown.map((r) => {
          const p = r.top ?? r.main;
          const edge = !!r.top;
          const isToday = new Date(r.event.commence_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === today;
          return (
            <FreshRow key={r.event.id} ts={p?.price_ts ?? null} staleMin={sm} serverNow={now} className="border-b border-line2">
              <Link href={`/game/${encodeURIComponent(r.event.id)}`} prefetch={false} className="grid min-h-[60px] grid-cols-[52px_1fr_auto] items-center gap-2 py-2 hover:bg-panel">
                <span className="text-[12px] leading-tight text-muted">
                  {time(r.event.commence_time)}
                  {!isToday && <span className="block text-[10px] uppercase">Tmrw</span>}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] ${edge ? 'text-ink' : 'text-muted'}`}>{r.event.label}</span>
                  {p ? (
                    <>
                      <span className={`block text-[12px] leading-snug ${edge ? 'text-ink' : 'text-muted'}`}>{p.label}</span>
                      <span className="block text-[12px] leading-snug"><span className={edge ? 'text-amber' : 'text-muted'}>{american(p.best_decimal)}</span> <span className="text-muted">{bookName(p.best_book)}</span></span>
                      <Ago ts={p.price_ts} staleMin={sm} serverNow={now} />
                    </>
                  ) : <span className="block text-[12px] text-muted">No prices yet</span>}
                  {r.published && <span className="block text-[10px] uppercase tracking-[0.12em] text-amber">Logged pick</span>}
                </span>
                <span className="flex flex-col items-end gap-1 text-right">
                  <span className={`text-[12px] ${edge ? 'text-fair' : 'text-muted'}`}>{p ? american(p.fair_decimal) : '—'}</span>
                  {edge ? (
                    <span className="edge-only flex items-center gap-2"><span className="text-[13px] text-amber">{pct(p!.ev)}</span><GradeBadge grade={p!.grade} /></span>
                  ) : <span className="text-[11px] text-muted">No edge</span>}
                </span>
              </Link>
            </FreshRow>
          );
        })}
      </ul>
    </div>
  );
}

/** Props tab: every prop market the provider returned for this sport, main line per player and stat. */
async function Props({ sport, edgesOnly, now, sm }: { sport: SportId; edgesOnly: boolean; now: number; sm: number }) {
  const { rows, events } = await propsFeed(sport);
  const live = (r: FeedPrice) => r.grade !== 'none' && !(now - Date.parse(r.price_ts ?? '') > sm * 60000);
  const shown = edgesOnly ? rows.filter(live) : rows;
  const consensusOnly = rows.length > 0 && rows.every((r) => r.fair_source === 'consensus');
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
      {consensusOnly && (
        <p className="pb-2 text-[12px] text-muted">
          <span className="mr-1 border border-line px-1 text-[10px] uppercase tracking-[0.1em] text-ink">Consensus-only</span>
          We don&apos;t simulate {SPORT_DEFS[sport].label} players yet, so the fair price is the no-vig consensus of every book. Edges here come from a book being out of line with the market.
        </p>
      )}
      {shown.length === 0 && <p className="py-10 text-center text-[13px] text-muted">No live prop edges right now. Turn off “Edges only” to see every prop.</p>}
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
