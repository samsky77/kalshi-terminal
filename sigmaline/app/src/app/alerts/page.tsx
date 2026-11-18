import { getSettings } from '@sigmaline/db';
import { Footer, Header, Main, Section } from '@/components/chrome';
import { PushSetup } from '@/components/push-setup';
import { getDb, demoMode } from '@/lib/db';
import { requirePaid } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alerts' };

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'UTC'];

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const v = await requirePaid('/alerts');
  const sp = await searchParams;
  const s = await getSettings(await getDb());
  const m = v.member;
  const discord = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3">
          <h1 className="text-[18px] font-semibold">Alerts</h1>
          <p className="prose-sl mt-1 text-[14px] text-muted">
            You get one alert per new pick with EV of {Math.round(s.alertEv * 1000) / 10}% or more, sent as soon as the pick is logged (up to 12 hours before the start). It looks like: <span className="font-mono text-ink">A · NYK +2.5 (−110) · EV +7.5% · 7:00 PM</span>
          </p>
        </div>
        <Section title="Push on this device"><PushSetup vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''} /></Section>
        <Section title="Discord">
          {discord
            ? <a href={discord} className="tap inline-flex items-center border border-line px-4 text-[13px] uppercase tracking-[0.12em] text-ink" rel="noopener noreferrer" target="_blank">Join the members channel</a>
            : <p className="text-[13px] text-muted">The members Discord invite link will appear here.</p>}
          <p className="mt-2 text-[12px] text-muted">Every alert is also posted to the members-only Discord channel.</p>
        </Section>
        <Section title="Quiet hours">
          {sp.saved && <p role="status" className="mb-2 text-[12px] text-amber">Saved.</p>}
          <form action="/api/me/alerts" method="post" className="grid max-w-md grid-cols-2 gap-3 text-[13px]">
            <label className="flex flex-col gap-1"><span className="label">From</span><input type="time" name="quiet_start" defaultValue={m?.quiet_start ?? ''} className="tap border border-line bg-panel px-2 text-ink" /></label>
            <label className="flex flex-col gap-1"><span className="label">To</span><input type="time" name="quiet_end" defaultValue={m?.quiet_end ?? ''} className="tap border border-line bg-panel px-2 text-ink" /></label>
            <label className="col-span-2 flex flex-col gap-1"><span className="label">Time zone</span>
              <select name="time_zone" defaultValue={m?.time_zone ?? 'America/New_York'} className="tap border border-line bg-panel px-2 text-ink">
                {ZONES.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </select>
            </label>
            <button className="tap col-span-2 border border-amber px-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-amber" type="submit">Save quiet hours</button>
          </form>
          <p className="mt-2 text-[12px] text-muted">Push alerts are held back during quiet hours. Discord posts are not, because the channel is shared.</p>
        </Section>
      </Main>
      <Footer />
    </>
  );
}
