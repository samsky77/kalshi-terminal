import type { SimOutput } from '@/core/sim';

/** A Map that remembers which keys a run touched, so the next run can drop everything else. */
export class TrackingCache extends Map<string, SimOutput> {
  used = new Set<string>();
  get(k: string) { const v = super.get(k); if (v) this.used.add(k); return v; }
  set(k: string, v: SimOutput) { this.used.add(k); return super.set(k, v); }
}

/** Seed a fresh tracking cache from the previous run's entries without marking them used. */
export function seedCache(prev: Map<string, SimOutput> | undefined): TrackingCache {
  const cache = new TrackingCache();
  // Map.prototype.set bypasses the tracking override on purpose.
  for (const [k, v] of prev ?? []) Map.prototype.set.call(cache, k, v);
  return cache;
}

/** Keep only entries the finished run actually used. */
export function pruneCache(cache: TrackingCache): Map<string, SimOutput> {
  return new Map([...cache].filter(([k]) => cache.used.has(k)));
}
