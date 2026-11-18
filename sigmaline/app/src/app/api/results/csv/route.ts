import { toCsv } from '@sigmaline/db';
import { viewerFromRequest } from '@/lib/auth';
import { results, type Window } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** CSV of our own pick log (no provider feed data beyond the single price we logged). */
export async function GET(req: Request) {
  const v = await viewerFromRequest(req);
  const w = (new URL(req.url).searchParams.get('w') ?? 'all') as Window;
  const d = await results(['7', '30', '90', 'all'].includes(w) ? w : 'all', v.active);
  return new Response(`# Sigmaline live record (not a backtest) - exported ${new Date().toISOString()}\n${toCsv(d.rows)}\n`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sigmaline-record-${w}.csv"`, 'cache-control': 'no-store' },
  });
}
