import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GRADE_CONFIG, isStale, selectionLabel } from '@sigmaline/core';
import { BookDots, EdgeMeter, MarginHistogram, LineChart, BLUE } from '@/components/charts';
import { Footer, GradeBadge, Header, Main } from '@/components/chrome';
import { gameDetail, short, staleMinutes, type GameDetail, type PriceRow } from '@/lib/data';
import { Ago, FreshRow } from '@/components/ago';
import { PropRow } from '@/components/prop-row';
import { demoMode } from '@/lib/db';
import { american, bookName, dayTime, pct } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Game' };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePaid(`/game/${id}`);
  const g = await gameDetail(decodeURIComponent(id));
  if (!g) notFound();
  const { event: e, top, pick } = g;
  const label = top ? selectionLabel(top.selection, e.home, e.away) : null;
  const now = Date.now();
  const sm = staleMinutes();
  const started = Date.parse(e.commence_time) <= now;
  const markets = g.prices.filter((p) => p.market !== 'prop');
  const props = g.prices.filter((p) => p.market === 'prop');
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-2 pt-2">
          <Link href={`/slate?sport=${e.sport_id}`} className="tap inline-flex items-center px-2 text-[13px] text-muted hover:text-ink" aria-label="Back to slate">
            <span aria-hidden>←</span><span className="ml-2 uppercase tracking-[0.12em]">Slate</span>
          </Link>
        </div>
        <div className="mx-auto max-w-3xl px-4">
          <h1 className="text-[18px] font-semibold leading-tight">{e.away} <span className="text-muted">@</span> {e.home}</h1>
          <p className="label mt-1">{dayTime(e.commence_time)} ET · {e.league_id.toUpperCase()}{e.status === 'final' ? ` · Final ${e.away_score}-${e.home_score}` : ''}</p>
        </div>

        {started && (
          <p className="mx-auto mt-3 max-w-3xl border border-line px-4 py-2 text-[12px] text-muted" role="status">
            This game has started. Pre-game prices are closed, so nothing below is graded or counted as an edge; live betting isn&apos;t covered.
          </p>
        )}
        <BestBet g={g} started={started} now={now} sm={sm} />

        <div className="mx-auto mt-3 max-w-3xl px-4">
          {g.bookPrices.length >= 4 && top?.best_decimal && top.fair_decimal && (
            <Fold title="Prices at every book" open>
              <BookDots prices={g.bookPrices} best={{ book: bookName(top.best_book), decimal: top.best_decimal }} fair={top.fair_decimal} fmt={american} label={`${label} at each book`} />
            </Fold>
          )}

          {g.histogram && (
            <Fold title="What our simulation says" hint={`${(g.sim?.n_sims ?? 10000).toLocaleString()} runs`}>
              {g.sim && g.sim.summary.draw === 0 && <WinBar home={e.home} away={e.away} p={g.sim.summary.homeWin} />}
              <div className="h-3" />
              <MarginHistogram bins={g.histogram.bins} axis={g.histogram.axis} pickLabel={top && top.grade !== 'none' ? label : null} />
              <p className="mt-2 text-[13px] text-muted">For reference only. The fair price and the edge come from the books, not from this simulation.</p>
            </Fold>
          )}

          <Fold title={g.movementKind === 'line' ? 'Line movement' : 'Market probability'}>
            <p className="mb-2 text-[13px] text-muted">{g.movementKind === 'line' ? 'How the main spread has moved across the books we checked.' : 'How the no-vig market probability for the top pick has moved. Each point is one snapshot of all books together.'}</p>
            {g.movement.length < 3 ? (
              <div className="rounded-xl border border-dashed border-line p-4 text-[13.5px] text-muted"><b className="mb-1 block text-ink">Not enough history yet</b>We have {g.movement.length} price {g.movement.length === 1 ? 'snapshot' : 'snapshots'} for this game. The chart appears at 3 or more. We never fill gaps with guesses.</div>
            ) : (
              <LineChart
                points={g.movement}
                label={g.movementKind === 'line' ? 'Consensus line, open to now' : 'No-vig market probability, open to now'}
                color={BLUE}
                format={g.movementKind === 'line' ? (v) => (v > 0 ? `+${v}` : `${v}`) : (v) => `${Math.round(v * 100)}%`}
                xLabel={(t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}
              />
            )}
          </Fold>

          {top && top.best_decimal && top.fair_decimal && top.consensus_p !== null && (
            <Fold title="How the edge is worked out">
              <table className="w-full text-[13px]"><tbody>
                <tr><td className="py-1">Books pricing this line</td><td className="py-1 text-right">{top.books}</td></tr>
                <tr><td className="py-1">Market chance (margin removed)</td><td className="py-1 text-right">{pct(top.consensus_p, 1, false)}</td></tr>
                <tr><td className="py-1">Fair price</td><td className="py-1 text-right text-fair">{american(top.fair_decimal)} ({top.fair_decimal.toFixed(3)})</td></tr>
                <tr><td className="py-1">Best price you can bet</td><td className="py-1 text-right">{american(top.best_decimal)} ({top.best_decimal.toFixed(2)})</td></tr>
                <tr className="border-t border-line"><td className="pt-2 font-semibold text-amber">Edge = {top.consensus_p.toFixed(4)} × {top.best_decimal.toFixed(2)} − 1</td><td className="pt-2 text-right font-semibold text-amber">{pct(top.ev)}</td></tr>
              </tbody></table>
              <p className="mt-2 text-[13px] text-muted">The fair price is every book&apos;s price with its margin removed, combined, with sharp books like Pinnacle counting double.</p>
            </Fold>
          )}

          <Fold title="All markets" hint={`stale after ${sm} min`}>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="All markets table">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="label py-1 font-normal">Line</th>
                    <th scope="col" className="label py-1 text-right font-normal">Best</th>
                    <th scope="col" className="label py-1 text-right font-normal">Fair</th>
                    <th scope="col" className="label py-1 text-right font-normal">Edge</th>
                    <th scope="col" className="label py-1 text-right font-normal"><span className="sr-only">Grade</span></th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((p) => <MarketRow key={p.selection_key} p={p} home={e.home} away={e.away} now={now} sm={sm} started={started} />)}
                </tbody>
              </table>
            </div>
          </Fold>

          <Fold title="Player props" hint={`${props.length} prices`}>
            {props.length ? (
              <ul>{props.map((p) => <PropRow key={p.selection_key} r={{ ...p, label: selectionLabel(p.selection, e.home, e.away), grade: started ? 'none' : p.grade }} now={now} sm={sm} />)}</ul>
            ) : <p className="text-[13.5px] text-muted"><b className="block text-ink">No data</b>No player props for this game from our data provider yet.</p>}
          </Fold>

          {(g.writeup || (g.propWriteup && !started)) && (
            <Fold title="Analyst notes">
              {g.writeup && (
                <div className="prose-sl text-[15px] leading-relaxed">
                  <p>{g.writeup.edge}</p>
                  <ul className="mt-2 list-disc pl-5">{g.writeup.reasons.map((r, i) => <li key={i} className="mt-1">{r}</li>)}</ul>
                  <p className="mt-2 text-muted">{g.writeup.risk}</p>
                </div>
              )}
              {g.propWriteup && !started && (
                <div className="prose-sl mt-4 border-t border-line pt-3 text-[15px] leading-relaxed">
                  <p className="label mb-1">Prop: {g.propWriteup.label}</p>
                  <p>{g.propWriteup.writeup.edge}</p>
                  <ul className="mt-2 list-disc pl-5">{g.propWriteup.writeup.reasons.map((r, i) => <li key={i} className="mt-1">{r}</li>)}</ul>
                  <p className="mt-2 text-muted">{g.propWriteup.writeup.risk}</p>
                </div>
              )}
            </Fold>
          )}

          <Fold title="Key factors">
            <dl className="divide-y divide-line2 text-[12.5px]">
              {g.factors.map((f2) => (
                <div key={f2.label} className="flex justify-between gap-3 py-2">
                  <dt className="label shrink-0">{f2.label}</dt>
                  <dd className="text-right">{f2.value}</dd>
                </div>
              ))}
            </dl>
          </Fold>
        </div>
      </Main>
      <Footer sharpApi={g.providers.includes('sharpapi')} />
    </>
  );
}

/** Collapsible section: advanced detail lives behind a tap (native <details>, no JS). */
function Fold({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group mb-2.5 rounded-2xl border border-line2 bg-panel">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 font-sans text-[15px] [&::-webkit-details-marker]:hidden">
        <span>{title}{hint && <span className="ml-2 text-[12px] text-muted">{hint}</span>}</span>
        <span aria-hidden className="text-[20px] text-amber group-open:hidden">+</span>
        <span aria-hidden className="hidden text-[20px] text-amber group-open:inline">–</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function WinBar({ home, away, p }: { home: string; away: string; p: number }) {
  const h = Math.round(p * 100);
  return (
    <div role="img" aria-label={`Our simulation: ${home} win ${h}%, ${away} win ${100 - h}%`} className="flex h-9 overflow-hidden rounded-lg text-[13px] font-semibold">
      <div className="flex items-center bg-amber pl-3 text-black" style={{ flex: p }}>{short(home)} {h}%</div>
      <div className="flex items-center justify-end bg-[#2a2618] pr-3 text-ink" style={{ flex: 1 - p }}>{short(away)} {100 - h}%</div>
    </div>
  );
}

/** The one card a beginner needs: the pick, the book, the price, the edge in plain words, a friendly line. */
function BestBet({ g, started, now, sm }: { g: GameDetail; started: boolean; now: number; sm: number }) {
  const { event: e, top, pick } = g;
  const label = top ? selectionLabel(top.selection, e.home, e.away) : null;
  const flagged = !!top && top.grade !== 'none' && !!top.best_decimal && !started;
  if (!flagged || !top || !top.best_decimal) {
    return (
      <section className="mx-auto mt-4 max-w-3xl px-4" aria-label="Best bet">
        <div className="rounded-2xl border border-dashed border-line p-4 text-[13.5px] text-muted">
          <b className="mb-1 block text-ink">{pick && started ? 'Logged pick' : g.prices.length ? 'No edge right now' : 'No data'}</b>
          {pick && started ? `${pick.label} at ${american(Number(pick.price_decimal))} (${bookName(pick.book)}), grade ${pick.grade}.` : g.prices.length ? 'Every fresh price for this game is at or near fair.' : 'No prices from the books for this game yet. It will be priced as soon as books post lines.'}
        </div>
      </section>
    );
  }
  const stale = isStale(top.price_ts, now, sm);
  const others = g.bookPrices.filter((p) => p.book !== top.best_book).map((p) => p.decimal);
  const lo = others.length ? Math.min(...others) : NaN, hi = others.length ? Math.max(...others) : NaN;
  const outlier = others.length >= 3 && top.best_decimal > hi;
  return (
    <section className="mx-auto mt-4 max-w-3xl px-4" aria-label="Best bet">
      <div className={`rounded-2xl border p-4 ${stale ? 'border-dashed border-[#c9a24a]' : 'border-amber bg-gradient-to-b from-[#171106] to-panel'}`}>
        <p className="label mb-1.5">{stale ? 'Best bet · prices are stale, re-check' : pick ? 'Best bet · logged' : 'Best bet'}</p>
        <p className="font-sans text-[24px] font-semibold leading-tight">{label}</p>
        <dl className="mt-3 flex gap-6">
          <div><dt className="label">Bet at</dt><dd className="text-[19px] font-semibold">{bookName(top.best_book)}</dd></div>
          <div><dt className="label">Price</dt><dd className="text-[19px] font-semibold">{american(top.best_decimal)}</dd></div>
          <div><dt className="label">Edge</dt><dd className={`text-[19px] font-semibold ${stale ? 'text-[#c9a24a]' : 'text-amber'}`}>{pct(top.ev)}</dd></div>
        </dl>
        <Ago ts={top.price_ts} staleMin={sm} serverNow={now} />
        <EdgeMeter ev={top.ev ?? 0} min={GRADE_CONFIG.B.minEdge} />
        <p className="prose-sl mt-3 text-[15px] leading-relaxed"><b>In plain words:</b> {bookName(top.best_book)} pays more for this bet than the market says it is worth. Over many bets like this you would expect about ${((top.ev ?? 0) * 100).toFixed(2)} back for every $100 staked. It is not a guarantee on any single bet.</p>
        {outlier ? (
          <p className="prose-sl mt-2 text-[14px] leading-relaxed text-muted">&ldquo;The other {others.length} books pay {american(lo)} to {american(hi)}. {bookName(top.best_book)} is out on its own at {american(top.best_decimal)}. That gap is the edge, but one outlier can be a stale or mistaken price, so confirm it is still there before you bet.&rdquo;</p>
        ) : (
          <p className="prose-sl mt-2 text-[14px] leading-relaxed text-muted">&ldquo;{top.books} books priced this line. The best price is {american(top.best_decimal)} at {bookName(top.best_book)}, against a fair price of {american(top.fair_decimal)}.&rdquo;</p>
        )}
        {pick && <p className="mt-2 text-[11px] text-muted">Logged {dayTime(pick.created_at)} ET · #{pick.seq} · {pick.stake_units}u (record only)</p>}
      </div>
    </section>
  );
}

function MarketRow({ p, home, away, now, sm, started }: { p: PriceRow; home: string; away: string; now: number; sm: number; started: boolean }) {
  const edge = p.grade !== 'none' && !started;
  return (
    <FreshRow as="tr" ts={p.price_ts} staleMin={sm} serverNow={now} className={`border-t border-line2 ${edge ? '' : 'text-muted'}`}>
      <td className="py-2 pr-2">
        {selectionLabel(p.selection, home, away)}
        <span className="block text-[11px] text-muted">{bookName(p.best_book)} · {p.books} {p.books === 1 ? 'book' : 'books'}</span>
        <Ago ts={p.price_ts} staleMin={sm} serverNow={now} />
      </td>
      <td className="py-2 text-right">{american(p.best_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-fair' : ''}`}>{american(p.fair_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-amber' : ''}`}>{pct(p.ev)}</td>
      <td className="py-2 pl-1 text-right">{edge ? <span className="edge-only"><GradeBadge grade={p.grade} /></span> : <span className="sr-only">no edge</span>}</td>
    </FreshRow>
  );
}
