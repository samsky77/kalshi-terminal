import { getDb, demoMode } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    const jobs = await db.select<{ job: string; status: string; started_at: string }>('job_runs', { order: [{ col: 'started_at', asc: false }], limit: 1 });
    return Response.json({ ok: true, demo: demoMode(), db: db.kind, lastJob: jobs[0] ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
