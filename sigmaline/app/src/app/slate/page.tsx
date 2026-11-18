import Link from 'next/link';
import { SPORTS, type SportId } from '@sigmaline/core';
import { Footer, GradeBadge, Header, Main } from '@/components/chrome';
import { SportTabs } from '@/components/sport-tabs';
import { slate, quotaState, isPriceStale } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, bookName, dayTime, pct, selLabel, time } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Slate' };

export default async function SlatePage({ searchParams }: { searchParams: Promise<{ sport?: string; edges?: string }> }) {
  const sp = await searchParams;
  const sport = (SPORTS as string[]).includes(sp.sport ?? '') ? (sp.sport as SportId) : 'nba';
  const edgesOnly = sp.edges === '1';
  await requirePaid(`/slate?sport=${sport}`);
  const [{ rows, asOf, providers }, quota] = await Promise.all([slate(sport), quotaState()]);
  const shown = edgesOnly ? rows.filter((r) => r.top) : rows;
  const exhausted = Object.values(quota).some((q) => q.mode === 'exhausted');
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  return (
    <>
      <Header demo={demoMode()} />
      <SportTabs active={sport} edgesOnly={edgesOnly} />
      <Main>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <p className="label">
            {rows.length} {rows.length === 1 ? 'game' : 'games'} · 10,000 sims each
          </p>
          <Link
            href={`/slate?sport=${sport}${edgesOnly ? '' : '&edges=1'}`}
            role="switch"
            aria-checked={edgesOnly}
            className={`tap inline-flex items-center gap-2 border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${edgesOnly ? 'border-amber text-amber' : 'border-line text-muted'}`}
          >
            <span aria-hidden className={`inline-block h-2.5 w-2.5 ${edgesOnly ? 'bg-amber' : 'border border-muted'}`} />
            Edges only
          </Link>
        </div>
        {(exhausted || isPriceStale(asOf)) && asOf && (
          <p className="mx-auto max-w-3xl px-4 pb-2 text-[12px] text-amber" role="status">Prices as of {dayTime(asOf)} ET — live refreshes are paused.</p>
        )}
        <div className="mx-auto max-w-3xl px-4">
          <div className="grid grid-cols-[54px_1fr_64px_74px] gap-2 border-b border-line pb-1" aria-hidden>
            <span className="label">Time</span>
            <span className="label">Best line</span>
            <span className="label text-right">Fair</span>
            <span className="label text-right">EV</span>
          </div>
          {shown.length === 0 && (
            <p className="py-10 text-center text-[13px] text-muted">
              {edgesOnly && rows.length ? 'No edges on this slate yet. Turn off “Edges only” to see every game.' : 'No games on the board for today or tomorrow.'}
            </p>
          )}
          <ul>
            {shown.map((r) => {
              const p = r.top ?? r.main;
              const edge = !!r.top;
              const isToday = new Date(r.event.commence_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === today;
              return (
                <li key={r.event.id} className="border-b border-line2">
                  <Link href={`/game/${encodeURIComponent(r.event.id)}`} className="grid min-h-[56px] grid-cols-[54px_1fr_64px_74px] items-center gap-2 py-2 hover:bg-panel">
                    <span className="text-[12px] leading-tight text-muted">
                      {r.started ? <span className="text-amber">LIVE</span> : time(r.event.commence_time)}
                      {!isToday && !r.started && <span className="block text-[10px] uppercase">Tmrw</span>}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-[13px] ${edge ? 'text-ink' : 'text-muted'}`}>{r.label}</span>
                      <span className={`block truncate text-[12px] ${edge ? 'text-ink' : 'text-muted'}`}>
                        {p ? (
                          <>
                            {selLabel(p.selection, r.event.home, r.event.away)} <span className="text-muted">({american(p.best_decimal)} {bookName(p.best_book)})</span>
                          </>
                        ) : 'No prices yet'}
                      </span>
                      {!edge && <span className="block text-[11px] text-muted">No edge found</span>}
                      {r.published && <span className="block text-[10px] uppercase tracking-[0.12em] text-amber">Logged pick</span>}
                    </span>
                    <span className={`text-right text-[13px] ${edge ? 'text-fair' : 'text-muted'}`}>{p ? american(p.fair_decimal) : '—'}</span>
                    <span className="flex items-center justify-end gap-2">
                      <span className={`text-[13px] ${edge ? 'text-amber' : 'text-muted'}`}>{edge ? pct(p!.ev) : '—'}</span>
                      {edge && <GradeBadge grade={p!.grade} />}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Main>
      <Footer sharpApi={providers.includes('sharpapi')} />
    </>
  );
}
