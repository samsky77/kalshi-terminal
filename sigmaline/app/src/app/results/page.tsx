import Link from 'next/link';
import { SPORT_DEFS, type SportId } from '@sigmaline/core';
import { LineChart, AMBER } from '@/components/charts';
import { Footer, GradeBadge, Header, Main, Section } from '@/components/chrome';
import { VerifyChain } from '@/components/verify-chain';
import { getViewer } from '@/lib/auth';
import { backtests, edgeLog, results, type Window } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, bookName, pct, shortDate, units } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Results — the live track record', description: 'Every Sigmaline pick, logged before the game, hash-chained and graded. Verify it yourself.' };

const WINDOWS: [Window, string][] = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']];
const resultText: Record<string, string> = { win: 'Win', loss: 'Loss', push: 'Push', half_win: '½ Win', half_loss: '½ Loss', void: 'Void' };

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ w?: string; q?: string }> }) {
  const sp = await searchParams;
  const w = (['7', '30', '90', 'all'].includes(sp.w ?? '') ? sp.w : 'all') as Window;
  const q = (sp.q ?? '').trim().toLowerCase();
  const viewer = await getViewer();
  const [d, bts, el] = await Promise.all([results(w, viewer.active), backtests(), edgeLog(viewer.active)]);
  const s = d.stats;
  const log = q ? d.rows.filter((r) => `${r.event_name} ${r.label} ${r.book} ${r.sport} ${r.market}`.toLowerCase().includes(q)) : d.rows;
  const range = s.from && s.to ? `${shortDate(s.from)} – ${shortDate(s.to)}` : 'no bets yet';
  return (
    <>
      <Header nav={viewer.active ? 'member' : 'public'} demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3">
          <h1 className="text-[18px] font-semibold">Live record</h1>
          <p className="mt-1 text-[12px] text-muted">
            Every pick is logged automatically before its game starts and can never be edited or deleted. Stakes are for the record only (A = 2u, B = 1u), not advice.
            {!viewer.active && ' Picks for games that haven’t started are sealed until kick-off.'}
          </p>
          <nav aria-label="Time window" className="mt-3 flex flex-wrap gap-1">
            {WINDOWS.map(([k, l]) => (
              <Link key={k} href={`/results?w=${k}`} aria-current={k === w ? 'page' : undefined} className={`tap inline-flex items-center border px-3 text-[12px] uppercase tracking-[0.1em] ${k === w ? 'border-amber text-amber' : 'border-line text-muted'}`}>{l}</Link>
            ))}
          </nav>
        </div>

        <Section title={`Live record · ${range}`}>
          <dl className="panel grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            <Stat label="Units" value={units(s.units)} amber />
            <Stat label="ROI" value={pct(s.roi)} />
            <Stat label="Bets" value={`${s.graded}${s.pending ? ` (+${s.pending} open)` : ''}`} />
            <Stat label="Avg CLV" value={s.avgClv === null ? '—' : pct(s.avgClv)} sub={s.clvBets ? `${s.clvBets} bets with a close` : undefined} />
          </dl>
          <p className="mt-1 text-[11px] text-muted">{s.wins}W · {s.losses}L · {s.pushes} push/void · {range}</p>
        </Section>

        <Section title="Cumulative profit (units)">
          <LineChart points={d.curve.map((c) => ({ t: c.t, value: c.units }))} label="Cumulative profit in units, live record" color={AMBER} zero format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}u`} />
        </Section>

        <Section title="By sport">
          <Breakdown rows={d.bySport.map((b) => ({ ...b, name: SPORT_DEFS[b.key as SportId]?.label ?? b.key }))} />
        </Section>
        <Section title="By market">
          <Breakdown rows={d.byMarket.map((b) => ({ ...b, name: ({ ml: 'Moneyline', spread: 'Spread', total: 'Total', prop: 'Player props' } as Record<string, string>)[b.key] ?? b.key }))} />
        </Section>

        <Section title="Every edge we've shown">
          <p className="mb-2 text-[12px] text-muted">
            Separate from the picks above: every graded edge is written to an append-only log the moment it first appears in the feed, with the price and the time. Nobody can edit or delete a row; closing line and result are filled in once, afterwards. Flat 1-unit stakes.{!viewer.active && ' Edges for games that haven’t started are hidden until kick-off.'}
          </p>
          <dl className="panel grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            <Stat label="Edges shown" value={String(el.stats.shown)} />
            <Stat label="Units (1u flat)" value={el.stats.settled ? units(el.stats.units) : '—'} amber sub={el.stats.settled ? `${el.stats.settled} settled` : undefined} />
            <Stat label="Avg edge shown" value={el.stats.avgEdge === null ? '—' : pct(el.stats.avgEdge)} />
            <Stat label="Avg CLV" value={el.stats.avgClv === null ? '—' : pct(el.stats.avgClv)} sub={el.stats.clvN ? `${Math.round((el.stats.beatClose ?? 0) * 100)}% beat the close` : undefined} />
          </dl>
          {el.rows.length > 0 && (
            <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Edge log table, scrolls sideways">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead><tr className="text-left">{['First shown', 'Edge', 'Book', 'Price', 'Edge %', 'CLV', 'Result'].map((h) => <th key={h} scope="col" className="label py-1 pr-2 font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {el.rows.map((r) => (
                    <tr key={r.edge_key} className="border-t border-line2 align-top">
                      <td className="py-2 pr-2 text-muted">{shortDate(r.first_shown_at)}<span className="block text-[11px]">{new Date(r.first_shown_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET</span></td>
                      <td className="py-2 pr-2"><span className="mr-1 inline-block"><GradeBadge grade={r.grade} /></span>{r.selection_label}<span className="block text-[11px] text-muted">{r.event_name}</span></td>
                      <td className="py-2 pr-2">{bookName(r.book)}</td>
                      <td className="py-2 pr-2">{american(r.price_taken)}</td>
                      <td className="py-2 pr-2 text-amber">{pct(r.edge_pct)}</td>
                      <td className="py-2 pr-2">{r.clv === null ? '—' : pct(r.clv)}</td>
                      <td className="py-2 pr-2">{r.result ? `${resultText[r.result] ?? r.result}${r.units !== null && r.result !== 'void' ? ` ${units(r.units)}` : ''}` : 'Open'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Bet log" right={<a className="tap inline-flex items-center text-[12px] text-amber underline" href={`/api/results/csv?w=${w}`}>Export CSV</a>}>
          <form className="mb-2 flex gap-2" role="search">
            <input type="hidden" name="w" value={w} />
            <label htmlFor="q" className="sr-only">Search the bet log</label>
            <input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Search team, book, market" className="tap min-w-0 flex-1 border border-line bg-panel px-3 text-[13px] text-ink placeholder:text-muted" />
            <button className="tap border border-line px-3 text-[12px] uppercase tracking-[0.1em] text-ink" type="submit">Search</button>
          </form>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Bet log table, scrolls sideways">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="text-left">
                  {['Logged', 'Pick', 'Book', 'Taken', 'Close', 'Stake', 'Result'].map((h) => <th key={h} scope="col" className="label py-1 pr-2 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t border-line2 align-top">
                    <td className="py-2 pr-2 text-muted">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</td>
                    <td className="py-2 pr-2"><span className="flex items-center gap-1"><GradeBadge grade={r.grade} /> {r.label}</span><span className="block text-[11px] text-muted">{r.event_name}</span></td>
                    <td className="py-2 pr-2">{bookName(r.book)}</td>
                    <td className="py-2 pr-2">{american(r.price_decimal)}</td>
                    <td className="py-2 pr-2 text-muted">{american(r.result?.closing_decimal ?? null)}</td>
                    <td className="py-2 pr-2">{r.stake_units}u</td>
                    <td className={`py-2 pr-2 ${r.result && ['win', 'half_win'].includes(r.result.result) ? 'text-amber' : 'text-muted'}`}>{r.result ? `${resultText[r.result.result]} ${units(Number(r.result.profit_units))}` : 'Open'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!log.length && <p className="py-6 text-center text-[13px] text-muted">{q ? 'No bets match your search.' : 'No graded picks in this window yet.'}</p>}
          </div>
          <p className="mt-2 text-[11px] text-muted">Rows are never deleted. Void = game cancelled or player did not play.</p>
        </Section>

        <Section title="Verify it yourself">
          <p className="mb-2 text-[12px] text-muted">Each row stores a SHA-256 hash of its own contents plus the previous row's hash. Changing or deleting any past pick breaks every hash after it. Your browser can check this:</p>
          <VerifyChain />
        </Section>

        <Section title="Backtest (simulated) — not part of the live record">
          <p className="mb-2 text-[12px] text-muted">These numbers come from replaying past seasons. Ratings are rebuilt walking forward, so there is no look-ahead. They are a model check, not a track record, and are never added to the numbers above.</p>
          {bts.length === 0 ? <p className="text-[12px] text-muted">No backtests run yet.</p> : (
            <ul className="space-y-1 text-[12px]">
              {bts.slice(0, 10).map((b) => (
                <li key={b.id} className="panel px-3 py-2">
                  <span className="label mr-2">Backtest (simulated)</span>
                  {SPORT_DEFS[b.sport as SportId]?.label ?? b.sport} · {b.kind === 'accuracy' ? `${b.games} games · Brier ${Number(b.metrics.brier).toFixed(3)} · log loss ${Number(b.metrics.logLoss).toFixed(3)}` : `${b.games_with_odds} games with odds · ${b.metrics.bets} bets · ROI ${pct(b.metrics.roi)}`}
                  {b.from_date && <span className="text-muted"> · {b.from_date} to {b.to_date}</span>}
                  <span className="block text-[11px] text-muted">Source: {b.source === 'nflverse-data (CC BY 4.0)' ? 'NFL schedule data: nflverse (CC BY 4.0)' : b.source === 'openfootball (CC0)' ? 'Soccer results: openfootball (CC0)' : b.source}{b.kind === 'price' ? ' · priced at closing lines, so CLV is not meaningful' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Main>
      <Footer />
    </>
  );
}

function Stat({ label, value, sub, amber }: { label: string; value: string; sub?: string; amber?: boolean }) {
  return (
    <div className="bg-panel p-3">
      <dt className="label">{label}</dt>
      <dd className={`mt-1 text-[20px] font-semibold ${amber ? 'text-amber' : ''}`}>{value}</dd>
      {sub && <dd className="text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}

function Breakdown({ rows }: { rows: { key: string; name: string; stats: { graded: number; units: number; roi: number; avgClv: number | null } }[] }) {
  if (!rows.length) return <p className="text-[12px] text-muted">No bets yet.</p>;
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="text-left">{['', 'Bets', 'Units', 'ROI', 'CLV'].map((h) => <th key={h} scope="col" className="label py-1 font-normal">{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line2">
            <th scope="row" className="py-2 text-left font-normal">{r.name}</th>
            <td>{r.stats.graded}</td>
            <td className={r.stats.units > 0 ? 'text-amber' : ''}>{units(r.stats.units)}</td>
            <td>{pct(r.stats.roi)}</td>
            <td>{r.stats.avgClv === null ? '—' : pct(r.stats.avgClv)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
