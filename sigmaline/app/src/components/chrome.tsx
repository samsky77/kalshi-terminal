import Link from 'next/link';
import { dateLong, DISCLAIMER } from '@/lib/format';

export function Header({ nav = 'member', demo = false }: { nav?: 'member' | 'public' | 'none'; demo?: boolean }) {
  return (
    <header className="border-b border-line">
      {demo && (
        <div className="bg-amber px-4 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-black" role="status">
          Demo data — recorded odds and model-sampled results. Not a live record.
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2">
        <Link href={nav === 'member' ? '/slate' : '/'} className="tap flex items-center gap-2" aria-label="Sigmaline home">
          <span aria-hidden className="inline-block h-3.5 w-3.5 bg-amber" />
          <span className="text-[15px] font-semibold tracking-[0.18em] text-amber">SIGMALINE</span>
        </Link>
        <span className="label text-right">{dateLong()}</span>
      </div>
      {nav !== 'none' && (
        <nav aria-label="Main" className="mx-auto flex max-w-3xl overflow-x-auto px-1 text-[12px] uppercase tracking-[0.06em] sm:gap-1 sm:tracking-[0.12em]">
          {(nav === 'member'
            ? [['/slate', 'Slate'], ['/edges', 'Edges'], ['/results', 'Results'], ['/alerts', 'Alerts'], ['/account', 'Account']]
            : [['/', 'Home'], ['/results', 'Results'], ['/login', 'Sign in']]
          ).map(([href, label]) => (
            <Link key={href} href={href} prefetch={false} className="tap flex shrink-0 items-center px-[9px] text-muted hover:text-ink sm:px-3">{label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer({ sharpApi = false }: { sharpApi?: boolean }) {
  return (
    <footer className="mx-auto mt-8 max-w-3xl border-t border-line px-4 py-5 text-[11px] leading-relaxed text-muted">
      <p>{DISCLAIMER}</p>
      {sharpApi && <p className="mt-1">Data provided by SharpAPI</p>}
      <p className="mt-2 flex flex-wrap gap-x-4">
        <Link className="tap inline-flex items-center underline" href="/legal/terms">Terms</Link>
        <Link className="tap inline-flex items-center underline" href="/legal/privacy">Privacy</Link>
        <Link className="tap inline-flex items-center underline" href="/legal/responsible-gambling">Responsible gambling</Link>
        <Link className="tap inline-flex items-center underline" href="/results">Track record</Link>
      </p>
      <p className="mt-1">Sigmaline never places, holds or brokers bets and never connects to sportsbook accounts.</p>
    </footer>
  );
}

export function GradeBadge({ grade, size = 'sm' }: { grade: 'A' | 'B' | 'none'; size?: 'sm' | 'lg' }) {
  if (grade === 'none') return <span className="text-[11px] uppercase tracking-[0.1em] text-muted">No edge</span>;
  const cls = size === 'lg' ? 'h-16 w-16 text-[34px]' : 'h-6 w-6 text-[13px]';
  return (
    <span className={`inline-flex items-center justify-center bg-amber font-bold text-black ${cls}`} role="img" aria-label={`Grade ${grade}`} title={`Grade ${grade}`}>
      {grade}
    </span>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mx-auto mt-4 max-w-3xl px-4" aria-label={title}>
      <div className="mb-2 flex items-end justify-between border-b border-line pb-1">
        <h2 className="label">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Main({ children }: { children: React.ReactNode }) {
  return <main id="main" tabIndex={-1} className="pb-4 focus:outline-none">{children}</main>;
}
