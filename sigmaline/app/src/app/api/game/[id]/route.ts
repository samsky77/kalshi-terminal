import { unauthorized, viewerFromRequest } from '@/lib/auth';
import { gameDetail } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await viewerFromRequest(req);
  if (!v.active) return unauthorized();
  const g = await gameDetail(decodeURIComponent((await params).id));
  if (!g) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(g, { headers: { 'cache-control': 'private, no-store' } });
}
