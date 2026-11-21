import { Footer, Header, Main, Section } from '@/components/chrome';
import { demoMode } from '@/lib/db';
import { requireSession } from '@/lib/guard';
import { memberDate, statusLabel } from '@/lib/membership';
import { checkoutUrl, noTrialCheckoutUrl, OFFER } from '@/lib/whop';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const v = await requireSession('/account');
  const m = v.member;
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3"><h1 className="text-[18px] font-semibold">Account</h1></div>
        <Section title="Membership">
          <dl className="panel divide-y divide-line2 text-[13px]">
            <div className="flex justify-between gap-3 px-3 py-2"><dt className="label">Status</dt><dd className={`text-right ${v.active ? 'text-amber' : ''}`}>{v.admin && !m ? 'Admin' : statusLabel(m)}</dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="label">Email</dt><dd>{v.session?.email ?? '—'}</dd></div>
            <div className="flex justify-between px-3 py-2">
              <dt className="label">{m?.status === 'trialing' ? (m.cancel_at_period_end ? 'Trial ends' : 'First charge') : m?.cancel_at_period_end || m?.status === 'canceled' ? 'Access ends' : 'Renews'}</dt>
              <dd>{memberDate(m?.trial_ends_at && m?.status === 'trialing' ? m.trial_ends_at : m?.expires_at) ?? '—'}{m?.status === 'trialing' && !m.cancel_at_period_end ? ` · $${OFFER.price}` : ''}</dd>
            </div>
            <div className="flex justify-between px-3 py-2"><dt className="label">Plan</dt><dd>Founding Member · ${OFFER.price}/mo</dd></div>
          </dl>
          {!v.active && (
            <a href={m?.status === 'trial_used' || m?.first_trial_at ? noTrialCheckoutUrl() : checkoutUrl()} className="tap mr-2 mt-3 inline-flex items-center bg-amber px-4 text-[13px] font-bold uppercase tracking-[0.12em] text-black">
              {m?.status === 'trial_used' || m?.first_trial_at ? `Subscribe · $${OFFER.price}/mo` : OFFER.cta}
            </a>
          )}
          <a href="https://whop.com/@me/settings/memberships/" target="_blank" rel="noopener noreferrer" className="tap mt-3 inline-flex items-center border border-line px-4 text-[13px] uppercase tracking-[0.12em] text-ink">Manage billing on Whop</a>
        </Section>
        {v.admin && (
          <Section title="Admin"><a href="/admin" className="tap inline-flex items-center text-[13px] text-amber underline">Open the admin screen</a></Section>
        )}
        <Section title="Sign out">
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="tap border border-line px-4 text-[13px] uppercase tracking-[0.12em] text-ink">Log out</button>
          </form>
        </Section>
      </Main>
      <Footer />
    </>
  );
}
