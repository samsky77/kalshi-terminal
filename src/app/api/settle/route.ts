// GET /api/settle?tickers=A,B,C -> { settled: { ticker: 'yes'|'no' } } for Kalshi markets that have finalized.
// Read-only: one public GET per ticker. Used by the automatic backtest.
import { KALSHI_BASE } from '@/server/kalshi';
import { getJson, Throttle } from '@/server/http';
import { json } from '@/server/params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const throttle = new Throttle(8);

export async function GET(req: Request) {
  const tickers = [...new Set((new URL(req.url).searchParams.get('tickers') ?? '').split(',').map((t) => t.trim()).filter((t) => /^[A-Z0-9.\-]{3,80}$/.test(t)))].slice(0, 40);
  if (!tickers.length) return json({ settled: {} });
  const settled: Record<string, 'yes' | 'no'> = {};
  const errors: string[] = [];
  await Promise.all(tickers.map(async (t) => {
    try {
      const r = await getJson<{ market?: { status?: string; result?: string } }>(`${KALSHI_BASE}/markets/${encodeURIComponent(t)}`, { throttle, retries: 1 });
      const m = r.body?.market;
      if (r.status === 200 && m && (m.status === 'finalized' || m.status === 'settled' || m.status === 'determined') && (m.result === 'yes' || m.result === 'no')) settled[t] = m.result;
      else if (r.status !== 200) errors.push(`${t}: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`${t}: ${(e as Error).message}`);
    }
  }));
  return json({ settled, errors });
}
