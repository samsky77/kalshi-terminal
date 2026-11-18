import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectionLabel } from '@sigmaline/core';
import { MarginHistogram, LineChart, BLUE } from '@/components/charts';
import { Footer, GradeBadge, Header, Main, Section } from '@/components/chrome';
import { gameDetail, type PriceRow } from '@/lib/data';
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
  const markets = g.prices.filter((p) => p.market !== 'prop');
  const props = g.prices.filter((p) => p.market === 'prop' && p.grade !== 'none');
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

        <Section title={pick ? 'Top pick · logged' : 'Top pick'}>
          {top && top.grade !== 'none' && top.best_decimal ? (
            <div className="panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[24px] font-semibold leading-tight text-amber">{label}</p>
                  <p className="mt-1 text-[13px] text-ink">{american(top.best_decimal)} <span className="text-muted">at {bookName(top.best_book)}</span></p>
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
            <p className="panel p-3 text-[13px] text-muted">No edge found. Every market below is priced at or near fair.</p>
          )}
        </Section>

        {g.histogram && (
          <Section title={g.histogram.axis === 'total' ? 'Simulated total' : 'Simulated final margin'} right={<span className="label">{(g.sim?.n_sims ?? 10000).toLocaleString()} runs</span>}>
            <MarginHistogram bins={g.histogram.bins} axis={g.histogram.axis} pickLabel={top && top.grade !== 'none' ? label : null} />
          </Section>
        )}

        <Section title="All markets">
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
                {markets.map((p) => <MarketRow key={p.selection_key} p={p} home={e.home} away={e.away} />)}
                {props.map((p) => <MarketRow key={p.selection_key} p={p} home={e.home} away={e.away} />)}
              </tbody>
            </table>
          </div>
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

function MarketRow({ p, home, away }: { p: PriceRow; home: string; away: string }) {
  const edge = p.grade !== 'none';
  return (
    <tr className={`border-t border-line2 ${edge ? '' : 'text-muted'}`}>
      <td className="py-2 pr-2">{selectionLabel(p.selection, home, away)}<span className="block text-[10px] text-muted">{bookName(p.best_book)} · {p.books} {p.books === 1 ? 'book' : 'books'}</span></td>
      <td className="py-2 text-right">{american(p.best_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-fair' : ''}`}>{american(p.fair_decimal)}</td>
      <td className={`py-2 text-right ${edge ? 'text-amber' : ''}`}>{pct(p.ev)}</td>
      <td className="py-2 pl-1 text-right">{edge ? <GradeBadge grade={p.grade} /> : <span className="sr-only">no edge</span>}</td>
    </tr>
  );
}
