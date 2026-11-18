import { viewerFromRequest } from '@/lib/auth';
import { results, type Window } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** Public: the live record. Unstarted picks only for members. */
export async function GET(req: Request) {
  const v = await viewerFromRequest(req);
  const w = (new URL(req.url).searchParams.get('w') ?? 'all') as Window;
  const d = await results(['7', '30', '90', 'all'].includes(w) ? w : 'all', v.active);
  return Response.json({ label: 'Live record', ...d }, { headers: { 'cache-control': v.active ? 'private, no-store' : 'public, max-age=60' } });
}
