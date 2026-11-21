import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isStale, selectionLabel } from '@sigmaline/core';
import { MarginHistogram, LineChart, BLUE } from '@/components/charts';
import { Footer, GradeBadge, Header, Main, Section } from '@/components/chrome';
import { gameDetail, staleMinutes, type PriceRow } from '@/lib/data';
import { Ago, FreshRow } from '@/components/ago';
import { PropRow } from '@/components/prop-row';
import { demoMode } from '@/lib/db';
import { american, bookName, dayTime, pct } from '@/lib/format';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Game' };

const cond = (o: { win: number; loss: number }) => (o.win + o.loss > 0 ? o.win / (o.win + o.loss) : NaN);

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
        <Section title={pick ? 'Top pick · logged' : 'Top pick'}>
          {top && top.grade !== 'none' && top.best_decimal && !started && !isStale(top.price_ts, now, sm) ? (
            <div className="panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[24px] font-semibold leading-tight text-amber">{label}</p>
                  <p className="mt-1 text-[13px] text-ink">{american(top.best_decimal)} <span className="text-muted">at {bookName(top.best_book)}</span></p>
                  <Ago ts={top.price_ts} staleMin={sm} serverNow={now} />
                  {pick && <p className="mt-1 text-[11px] text-muted">Logged {dayTime(pick.created_at)} ET · #{pick.seq} · {pick.stake_units}u (record only)</p>}
                </div>
                <GradeBadge grade={top.grade} size="lg" />
              </div>
              <dl className="mt-3 grid grid-cols-3 border-t border-line pt-2">
                <div><dt className="label">{top.market === 'ml' ? 'Win %' : top.market === 'total' ? 'Hit %' : 'Cover %'}</dt><dd className="text-[16px]">{Math.round(cond(top.fair_probs) * 1000) / 10}%</dd></div>
                <div><dt className="label">Fair</dt><dd className="text-[16px] text-fair">{american(top.fair_decimal)}</dd></div>
                <div><dt className="label">EV</dt><dd className="text-[16px] text-amber">{pct(top.ev)}</dd></div>
              </dl>
            </div>
          ) : (
            <p className="panel p-3 text-[13px] text-muted">{pick && started ? `Logged pick: ${pick.label} at ${american(Number(pick.price_decimal))} (${bookName(pick.book)}), grade ${pick.grade}.` : (g.prices.length ? 'No live edge. Every fresh market below is priced at or near fair.' : 'No prices from the books for this game yet. It will be priced as soon as books post lines.')}</p>
          )}
        </Section>

        {g.histogram && (
          <Section title={g.histogram.axis === 'total' ? 'Simulated total' : 'Simulated final margin'} right={<span className="label">{(g.sim?.n_sims ?? 10000).toLocaleString()} runs</span>}>
            <MarginHistogram bins={g.histogram.bins} axis={g.histogram.axis} pickLabel={top && top.grade !== 'none' ? label : null} />
            {(top?.fair_source === 'consensus' || g.sim?.inputs?.source !== 'ratings') && (
              <p className="mt-1 text-[12px] text-muted">We don&apos;t have enough results yet to rate these teams, so the fair prices on this page are the market consensus, not this simulation. The chart shows the score spread the market implies; its percentages can differ from the fair price above.</p>
            )}
          </Section>
        )}

        <Section title="All markets" right={<span className="label">Prices go stale after {sm} min</span>}>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="All markets table">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="label py-1 font-normal">Line</th>
                  <th scope="col" className="label py-1 text-right font-normal">Best</th>
                  <th scope="col" className="label py-1 text-right font-normal">Fair</th>
                  <th scope="col" className="label py-1 text-right font-normal">EV</th>
                  <th scope="col" className="label py-1 text-right font-normal"><span className="sr-only">Grade</span></th>
                </tr>
              </thead>
              <tbody>
                {markets.map((p) => <MarketRow key={p.selection_key} p={p} home={e.home} away={e.away} now={now} sm={sm} started={started} />)}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Player props" right={<span className="label">{props.length} prices</span>}>
          {props.length ? (
            <>
              {props.every((p) => p.fair_source === 'consensus') && (
                <p className="mb-1 text-[12px] text-muted"><span className="mr-1 border border-line px-1 text-[11px] uppercase tracking-[0.1em] text-ink">Consensus-only</span>No player simulation for this game: each fair price is the no-vig consensus of every book.</p>
              )}
              <ul>{props.map((p) => <PropRow key={p.selection_key} r={{ ...p, label: selectionLabel(p.selection, e.home, e.away), grade: started ? 'none' : p.grade }} now={now} sm={sm} />)}</ul>
            </>
          ) : <p className="panel p-3 text-[13px] text-muted">No player props for this game from our data provider yet.</p>}
        </Section>

        <Section title={g.movementKind === 'line' ? 'Line movement' : 'Market probability'}>
          <LineChart
            points={g.movement}
            label={g.movementKind === 'line' ? 'Consensus line, open to now' : 'No-vig market probability, open to now'}
            color={BLUE}
            format={g.movementKind === 'line' ? (v) => (v > 0 ? `+${v}` : `${v}`) : (v) => `${Math.round(v * 100)}%`}
            xLabel={(t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}
          />
        </Section>

        {g.writeup && (
          <Section title="Why we like it">
            <div className="prose-sl panel p-3 text-[15px] leading-relaxed">
              <p>{g.writeup.edge}</p>
              <ul className="mt-2 list-disc pl-5">
                {g.writeup.reasons.map((r, i) => <li key={i} className="mt-1">{r}</li>)}
              </ul>
              <p className="mt-2 text-muted">{g.writeup.risk}</p>
            </div>
          </Section>
        )}

        {g.propWriteup && !started && (
          <Section title={`Prop: ${g.propWriteup.label}`}>
            <div className="prose-sl panel p-3 text-[15px] leading-relaxed">
              <p>{g.propWriteup.writeup.edge}</p>
              <ul className="mt-2 list-disc pl-5">{g.propWriteup.writeup.reasons.map((r, i) => <li key={i} className="mt-1">{r}</li>)}</ul>
              <p className="mt-2 text-muted">{g.propWriteup.writeup.risk}</p>
            </div>
          </Section>
        )}

        <Section title="Key factors">
          <dl className="panel divide-y divide-line2 text-[12px]">
            {g.factors.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 px-3 py-2">
                <dt className="label shrink-0">{f.label}</dt>
                <dd className="text-right">{f.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </Main>
      <Footer sharpApi={g.providers.includes('sharpapi')} />
    </>
  );
}

function MarketRow({ p, home, away, now, sm, started }: { p: PriceRow; home: string; away: string; now: number; sm: number; started: boolean }) {
  const edge = p.grade !== 'none' && !started;
  return (
    <FreshRow as="tr" ts={p.price_ts} staleMin={sm} serverNow={now} className={`border-t border-line2 ${edge ? '' : 'text-muted'}`}>
      <td className="py-2 pr-2">
        {selectionLabel(p.selection, home, away)}
        <span className="block text-[11px] text-muted">{bookName(p.best_book)} · {p.books} {p.books === 1 ? 'book' : 'books'}{p.fair_source === 'consensus' ? ' · consensus-only' : ''}</span>
        <Ago ts={p.price_ts} staleMin={sm} serverNow={now} />
      </td>
      <td className="py-2 text-right">{american(p.best_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-fair' : ''}`}>{american(p.fair_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-amber' : ''}`}>{pct(p.ev)}</td>
      <td className="py-2 pl-1 text-right">{edge ? <span className="edge-only"><GradeBadge grade={p.grade} /></span> : <span className="sr-only">no edge</span>}</td>
    </FreshRow>
  );
}
