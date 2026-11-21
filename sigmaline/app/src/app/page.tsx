import Link from 'next/link';
import { gradeFaqAnswer } from '@sigmaline/core';
import { Footer, GradeBadge, Header, Main, Section } from '@/components/chrome';
import { JoinButton } from '@/components/join';
import { results } from '@/lib/data';
import { demoMode } from '@/lib/db';
import { american, pct, shortDate, units } from '@/lib/format';
import { checkoutUrl, noTrialCheckoutUrl, OFFER } from '@/lib/whop';

export const dynamic = 'force-dynamic';

const FAQ: [string, string][] = [
  ['Do you place bets for me?', 'No. Sigmaline is information only. We never place, hold or broker bets and never connect to your sportsbook accounts. You decide what, if anything, to bet.'],
  ['Where do the numbers on this page come from?', 'Only from the live record: picks logged automatically before each game and graded from official results. Backtests are shown separately and are never part of these numbers.'],
  ['How do I know you don’t delete losing picks?', 'Every pick is written to an append-only log. Each row’s SHA-256 hash covers its own contents and the row before it, so changing or deleting anything breaks the chain. Anyone can re-check it in the browser on the Results page.'],
  // Rendered from GRADE_CONFIG (packages/core/src/grades.ts): the same object the grading code reads.
  ['What does a grade mean?', gradeFaqAnswer()],
  ['Which sports?', 'NBA, NHL, NFL, college basketball, college football, soccer (EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS, Champions League) and ATP/WTA tennis. Moneylines, spreads and totals; NBA and NFL player props are rolling out.'],
  ['Is profit guaranteed?', 'No. A positive-EV bet still loses often. Results vary, and past performance does not guarantee future results. Only bet what you can afford to lose.'],
  ['What do Fair, Edge, CLV and units mean?', 'Fair is the price at which a bet breaks even by our numbers. Edge is how much better the best book’s price is than fair: fair probability × decimal odds − 1, so +4% means about 4 cents per dollar over the long run. CLV (closing line value) compares the price we flagged with the final price before the start; beating the close is the best early sign the edges are real. Units are a fixed stake size for the record (A = 2 units, B = 1), not advice. Small samples swing a lot, so judge us on hundreds of bets, not a handful.'],
  ['How does the free trial work?', OFFER.fine],
  ['Can I cancel?', 'Yes, any time from your Whop account. Cancel during the trial and you are never charged; cancel later and you keep access until the end of the period you paid for. See the Terms for refunds.'],
];

export default async function Landing({ searchParams }: { searchParams: Promise<{ membership?: string }> }) {
  const sp = await searchParams;
  const rec = await results('all', false);
  const s = rec.stats;
  const recent = rec.rows.filter((r) => r.result).slice(0, 5);
  const checkout = checkoutUrl();
  return (
    <>
      <Header nav="public" demo={demoMode()} />
      <Main>
        {sp.membership === 'trial_used' && (
          <p className="mx-auto mt-3 max-w-3xl border border-amber px-4 py-2 text-[13px] text-amber" role="status">
            You&apos;ve already used your free trial on this Whop account. <a className="tap inline-flex items-center underline" href={noTrialCheckoutUrl()}>Subscribe for ${OFFER.price}/month</a> to keep using Sigmaline.
          </p>
        )}
        {(sp.membership === 'expired' || sp.membership === 'past_due') && (
          <p className="mx-auto mt-3 max-w-3xl border border-amber px-4 py-2 text-[13px] text-amber" role="status">
            {sp.membership === 'past_due' ? 'Your last payment failed and the grace period is over. Update your card on Whop to get back in. ' : 'Your membership has ended. '}
            <a className="tap inline-flex items-center underline" href="/account">See your account</a>{sp.membership === 'expired' && <> or <a className="tap inline-flex items-center underline" href={noTrialCheckoutUrl()}>subscribe again</a></>}.
          </p>
        )}
        {sp.membership === 'inactive' && (
          <p className="mx-auto mt-3 max-w-3xl border border-amber px-4 py-2 text-[13px] text-amber" role="status">
            You&apos;re signed in, but we couldn&apos;t find an active membership. Join below, or manage billing on Whop.
          </p>
        )}
        <section className="mx-auto max-w-3xl px-4 pt-8">
          <p className="label text-amber">The Bloomberg terminal for sports betting</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight sm:text-[36px]">Every game simulated 10,000 times. Only the bets worth making.</h1>
          <p className="prose-sl mt-3 text-[16px] leading-relaxed text-ink">
            Sigmaline prices every game on the slate from its own simulations, compares that fair price with the best line at the books you can bet, and flags only the bets with positive expected value. Each one comes with a grade and a plain-English reason why.
          </p>
          <div className="mt-5 max-w-md"><JoinButton href={checkout} label={OFFER.cta} sub={`${OFFER.after} after the trial · card required · cancel any time`} /></div>
        </section>

        <Section title="How it works">
          <ol className="grid gap-px bg-line sm:grid-cols-3">
            {[
              ['01 Simulate', 'Team ratings plus 10,000 Monte Carlo runs give a full distribution of the final score. Moneyline, spread and total all come from that one distribution.'],
              ['02 Compare', 'We strip the vig from every book, take the market consensus and blend it with our model. Then we check the best price you can actually bet.'],
              ['03 Log it', 'Picks with an edge are logged and alerted as soon as we find them, up to 12 hours before the start. Each one is hash-chained and graded against the closing line and the final score.'],
            ].map(([t, d]) => (
              <li key={t} className="bg-panel p-3"><p className="text-[13px] font-semibold text-amber">{t}</p><p className="prose-sl mt-1 text-[14px] leading-relaxed">{d}</p></li>
            ))}
          </ol>
        </Section>

        <Section title="Live record preview" right={<Link className="tap inline-flex items-center text-[12px] text-amber underline" href="/results">Full record →</Link>}>
          {s.graded > 0 ? (
            <>
              <dl className="panel grid grid-cols-3 gap-px bg-line">
                <div className="bg-panel p-3"><dt className="label">Units</dt><dd className="text-[20px] font-semibold text-amber">{units(s.units)}</dd></div>
                <div className="bg-panel p-3"><dt className="label">ROI</dt><dd className="text-[20px] font-semibold">{pct(s.roi)}</dd></div>
                <div className="bg-panel p-3"><dt className="label">Avg CLV</dt><dd className="text-[20px] font-semibold">{s.avgClv === null ? '—' : pct(s.avgClv)}</dd></div>
              </dl>
              <p className="mt-1 text-[11px] text-muted">Live record only · {s.graded} graded bets · {s.from ? shortDate(s.from) : ''} – {s.to ? shortDate(s.to) : ''} · never includes backtests</p>
              <ul className="mt-2 divide-y divide-line2 text-[12px]">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="flex min-w-0 items-center gap-2"><GradeBadge grade={r.grade} /><span className="truncate">{r.label}</span></span>
                    <span className="shrink-0 text-muted">{american(r.price_decimal)} · <span className={r.result!.result.includes('win') ? 'text-amber' : ''}>{units(Number(r.result!.profit_units))}</span></span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="panel p-3 text-[13px] text-muted">The live record starts with our first logged pick. Every pick from day one will appear here, wins and losses, with the bet count and date range.</p>
          )}
        </Section>

        <Section title="Pricing">
          <div className="panel p-4">
            <p className="label text-amber">Founding Member</p>
            <p className="mt-1 text-[22px] font-semibold text-amber">{OFFER.trialDays} days free</p>
            <p className="text-[32px] font-semibold">${OFFER.price}<span className="text-[14px] text-muted">/month after the trial</span></p>
            <ul className="prose-sl mt-2 space-y-1 text-[14px]">
              <li>Full slate for 7 sports with fair prices, EV and grades</li>
              <li>Simulation breakdowns, line movement and CLV</li>
              <li>Push and Discord alerts for the strongest new picks</li>
              <li>Cancel any time on Whop</li>
            </ul>
            <p className="mt-2 text-[12px] text-muted">{OFFER.fine} The Results page is public, so you can judge us before you start.</p>
            <div className="mt-4 max-w-md"><JoinButton href={checkout} label={OFFER.cta} sub={`${OFFER.after} · cancel any time on Whop`} /></div>
          </div>
        </Section>

        <Section title="FAQ">
          <div className="divide-y divide-line2 border-y border-line2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group">
                <summary className="tap flex cursor-pointer list-none items-center justify-between py-2 text-[14px]">
                  {q}<span aria-hidden className="ml-2 text-amber group-open:rotate-45">+</span>
                </summary>
                <p className="prose-sl pb-3 text-[14px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </Section>
        <p className="mx-auto mt-4 max-w-3xl px-4 text-[12px] text-muted">Already a member? <Link href="/login" className="tap inline-flex items-center text-amber underline">Sign in with Whop</Link></p>
      </Main>
      <Footer />
    </>
  );
}
