import { GRADE_CONFIG, projectUsage, SPORT_DEFS, SPORTS, type ProviderId } from '@sigmaline/core';
import { currentModel, getSettings, usageRows } from '@sigmaline/db';
import { CalibrationChart } from '@/components/charts';
import { Footer, Header, Main, Section } from '@/components/chrome';
import { quotaState } from '@/lib/data';
import { demoMode, getDb } from '@/lib/db';
import { pct } from '@/lib/format';
import { requireAdmin } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false } };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = await getDb();
  const settings = await getSettings(db);
  const quota = await quotaState();
  const now = new Date();
  const hist = await usageRows(db, new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const jobs = await db.select<{ id: number; job: string; status: string; started_at: string; finished_at: string | null; detail: any }>('job_runs', { order: [{ col: 'started_at', asc: false }], limit: 40 });
  const lastByJob = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) if (!lastByJob.has(j.job)) lastByJob.set(j.job, j);
  const failures = jobs.filter((j) => j.status === 'error').slice(0, 5);
  const models = await Promise.all(SPORTS.map((s) => currentModel(db, s)));
  const changes = await db.select<any>('model_changes', { order: [{ col: 'created_at', asc: false }], limit: 30 });
  const cal = await db.select<any>('calibration_reports', { eq: { kind: 'live', market: 'ml', window_days: 90 }, order: [{ col: 'created_at', asc: false }], limit: 50 });
  const latestCal = new Map<string, any>();
  for (const c of cal) if (!latestCal.has(c.sport)) latestCal.set(c.sport, c);
  const counts = { picks: (await db.select('picks')).length, graded: (await db.select('pick_results')).length };
  return (
    <>
      <Header demo={demoMode()} />
      <Main>
        <div className="mx-auto max-w-3xl px-4 pt-3"><h1 className="text-[18px] font-semibold">Admin</h1><p className="text-[12px] text-muted">{counts.picks} picks logged · {counts.graded} graded</p></div>

        <Section title="Job health">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left">{['Job', 'Last run', 'Status'].map((h) => <th scope="col" key={h} className="label py-1 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {[...lastByJob.values()].map((j) => (
                <tr key={j.id} className="border-t border-line2"><td className="py-2">{j.job}</td><td>{new Date(j.started_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td><td className={j.status === 'ok' ? '' : 'text-amber'}>{j.status}</td></tr>
              ))}
            </tbody>
          </table>
          {!lastByJob.size && <p className="text-[12px] text-muted">No job runs yet. The GitHub Actions schedule writes here.</p>}
          {failures.map((f) => <p key={f.id} className="mt-1 text-[11px] text-amber">✗ {f.job} {new Date(f.started_at).toISOString()}: {String(f.detail?.message ?? '').slice(0, 160)}</p>)}
        </Section>

        <Section title="Provider quotas (budgeter)">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left">{['Provider', 'Used', 'Quota', 'Mode', 'Projected'].map((h) => <th scope="col" key={h} className="label py-1 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {(Object.entries(quota) as [ProviderId, (typeof quota)[string]][]).map(([p, q]) => {
                const h = hist.filter((r) => r.provider === p).map((r) => Number(r.used));
                const pr = projectUsage(p, { provider: p, period: q.period as 'day' | 'month', limit: q.limit }, h, q.used, q.period === 'month' ? now.getUTCDate() : 1, q.period === 'month' ? daysInMonth : 1);
                return (
                  <tr key={p} className="border-t border-line2">
                    <td className="py-2">{p}</td><td>{q.used}</td><td>{q.limit}/{q.period}</td>
                    <td className={q.mode === 'normal' ? '' : 'text-amber'}>{q.mode}</td>
                    <td className={pr.withinQuota ? '' : 'text-amber'}>{pr.projectedPeriodTotal} {pr.withinQuota ? '✓' : '✗ over'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-muted">At 80% only pre-game and closing pulls run; at 100% pulls stop and the slate shows &ldquo;Prices as of&rdquo;. The Odds API is paced to a daily share of the month. Run <code>npm run worker -- budget</code> for the full projection.</p>
        </Section>

        <Section title="Grades and alerts">
          {sp.saved && <p role="status" className="mb-2 text-[12px] text-amber">Saved. New alerts use this immediately.</p>}
          <p className="mb-2 text-[12px] text-muted">Grade boundaries are fixed in <code>packages/core/src/grades.ts</code>, the same file the FAQ renders from, so they can&apos;t drift: A ≥ {pct(GRADE_CONFIG.A.minEdge, 1, false)} with model and consensus agreeing, B {pct(GRADE_CONFIG.B.minEdge, 1, false)}–{pct(GRADE_CONFIG.B.maxEdge, 1, false)}, stale after {GRADE_CONFIG.staleMinutes} min.</p>
          <form action="/api/admin/settings" method="post" className="grid max-w-md grid-cols-3 gap-3 text-[13px]">
            <label className="flex flex-col gap-1"><span className="label">Alert EV</span><input name="alert" type="number" step="0.005" min="0.01" max="0.4" defaultValue={settings.alertEv} className="tap border border-line bg-panel px-2" /></label>
            <button type="submit" className="tap col-span-3 border border-amber px-4 font-semibold uppercase tracking-[0.12em] text-amber">Save</button>
          </form>
        </Section>

        <Section title="Model settings (current versions)">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left">{['Sport', 'Version', 'w ML/SP/TOT', 'Half-life'].map((h) => <th scope="col" key={h} className="label py-1 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-t border-line2"><td className="py-2">{SPORT_DEFS[m.sport_id].tab}</td><td>{m.id}</td><td>{m.params.w.ml.toFixed(2)} / {m.params.w.spread.toFixed(2)} / {m.params.w.total.toFixed(2)}</td><td>{m.params.halfLifeDays}d</td></tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Calibration (live, moneyline, last 90 days)">
          <div className="grid gap-4 sm:grid-cols-2">
            {[...latestCal.values()].map((c) => (
              <div key={c.sport}>
                <p className="label mb-1">{SPORT_DEFS[c.sport as keyof typeof SPORT_DEFS]?.tab} · n={c.n} · Brier {c.brier ? Number(c.brier).toFixed(3) : '—'} · CLV {c.avg_clv === null ? '—' : pct(Number(c.avg_clv))}</p>
                {c.buckets && <CalibrationChart buckets={c.buckets} label={`${c.sport} live calibration`} />}
              </div>
            ))}
          </div>
          {!latestCal.size && <p className="text-[12px] text-muted">No live calibration reports yet. The nightly job writes them once games have been graded.</p>}
        </Section>

        <Section title="Model change history">
          {changes.length ? (
            <ul className="text-[12px]">
              {changes.map((c) => (
                <li key={c.id} className="border-t border-line2 py-2">{new Date(c.created_at).toLocaleDateString('en-US')} · {c.sport} · {c.param}: {Number(c.old_value)} → {Number(c.new_value)} <span className="text-muted">(hold-out log loss {c.holdout_before ? Number(c.holdout_before).toFixed(4) : '—'} → {c.holdout_after ? Number(c.holdout_after).toFixed(4) : '—'}, n={c.n}) · {c.model_version}</span></li>
              ))}
            </ul>
          ) : <p className="text-[12px] text-muted">No changes yet. Each change is capped at ±0.05 per night and kept only if hold-out log loss improves.</p>}
        </Section>
      </Main>
      <Footer />
    </>
  );
}
