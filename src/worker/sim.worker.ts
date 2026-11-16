/// <reference lib="webworker" />
// Runs the pure pipeline off the main thread. Keeps simulations cached by game + consensus so that
// Kalshi price updates (every ~30-60 s) only re-price, while an odds refresh re-simulates.
import { runPipeline, type OddsBatch } from '@/core/pipeline';
import type { SimOutput } from '@/core/sim';
import type { KalshiGame, Sport } from '@/core/types';
import { seedCache, pruneCache } from './trackingCache';

export interface WorkerRequest {
  id: number;
  sport: Sport;
  games: KalshiGame[];
  odds: OddsBatch[];
  now?: string;
  horizonHours?: number;
}

/** One sim cache per sport. After each run only the entries that run used are kept, so memory stays bounded. */
const caches = new Map<Sport, Map<string, SimOutput>>();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, sport, games, odds, now, horizonHours } = e.data;
  try {
    const t0 = performance.now();
    const cache = seedCache(caches.get(sport));
    const out = runPipeline({ sport, games, odds, now: now ? new Date(now) : new Date(), simCache: cache, horizonHours });
    caches.set(sport, pruneCache(cache));
    (self as unknown as Worker).postMessage({ id, ok: true, out, ms: performance.now() - t0 });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message });
  }
};
