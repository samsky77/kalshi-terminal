import { Footer, Header, Main, Section } from '@/components/chrome';
import { demoMode } from '@/lib/db';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const v = await requirePaid('/account');
  const m = v.member;
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3"><h1 className="text-[18px] font-semibold">Account</h1></div>
        <Section title="Membership">
          <dl className="panel divide-y divide-line2 text-[13px]">
            <div className="flex justify-between px-3 py-2"><dt className="label">Status</dt><dd className={v.active ? 'text-amber' : ''}>{v.admin && m?.status !== 'active' ? 'Admin' : (m?.status ?? 'unknown')}</dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="label">Email</dt><dd>{v.session?.email ?? '—'}</dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="label">Renews / ends</dt><dd>{m?.expires_at ? new Date(m.expires_at).toLocaleDateString('en-US') : '—'}</dd></div>
            <div className="flex justify-between px-3 py-2"><dt className="label">Plan</dt><dd>Founding Member · $25/mo</dd></div>
          </dl>
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
