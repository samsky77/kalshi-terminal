import { viewerFromRequest } from '@/lib/auth';
import { publicChain } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** The full hash chain. Rows for games that haven't started are sealed for non-members. */
export async function GET(req: Request) {
  const v = await viewerFromRequest(req);
  return Response.json({ rows: await publicChain(v.active) }, { headers: { 'cache-control': 'no-store' } });
}
