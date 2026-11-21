import { getDb, demoMode } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Public liveness check. Only the last job's name, status and times: no pull plan, providers or counts. */
export async function GET() {
  try {
    const db = await getDb();
    const jobs = await db.select<{ job: string; status: string; started_at: string; finished_at: string | null }>('job_runs', { order: [{ col: 'started_at', asc: false }], limit: 1 });
    const j = jobs[0];
    return Response.json(
      { ok: true, demo: demoMode(), db: db.kind, lastJob: j ? { job: j.job, status: j.status, started_at: j.started_at, finished_at: j.finished_at } : null },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
