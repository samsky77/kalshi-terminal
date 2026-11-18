import { policyFromEnv, verifyWorkerToken, WORKER_KEYS } from '@/lib/oidc';

export const dynamic = 'force-dynamic';

/**
 * POST /api/worker/config with `Authorization: Bearer <GitHub Actions OIDC token>`.
 * Returns the worker's runtime keys only to this repository's own worker workflow on `main`.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headers = { 'cache-control': 'no-store' };
  if (!token) return Response.json({ error: 'missing token' }, { status: 401, headers });
  let result;
  try { result = await verifyWorkerToken(token, policyFromEnv()); } catch { return Response.json({ error: 'verification unavailable' }, { status: 503, headers }); }
  if (!result.ok) return Response.json({ error: 'forbidden', reason: result.reason }, { status: 403, headers });
  const env: Record<string, string> = {};
  for (const k of WORKER_KEYS) { const v = process.env[k]; if (v) env[k] = v; }
  return Response.json({ env }, { headers });
}
