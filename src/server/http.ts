// Server-only HTTP helpers: throttling, 429 backoff, short-lived response cache.

type CacheEntry = { at: number; status: number; body: unknown; headers: Record<string, string> };
const cache = new Map<string, CacheEntry>();

export interface FetchResult<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
  cached: boolean;
}

/** A serial throttle: at most `perSecond` request starts per second, process-wide per instance. */
export class Throttle {
  private next = 0;
  constructor(private perSecond: number) {}
  async wait(): Promise<void> {
    const gap = 1000 / this.perSecond;
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(
  url: string,
  opts: { throttle?: Throttle; ttlMs?: number; retries?: number; cacheKey?: string } = {},
): Promise<FetchResult<T>> {
  const key = opts.cacheKey ?? url;
  const ttl = opts.ttlMs ?? 0;
  const hit = cache.get(key);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) {
    return { status: hit.status, body: hit.body as T, headers: hit.headers, cached: true };
  }
  const retries = opts.retries ?? 4;
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    await opts.throttle?.wait();
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'kalshi-terminal/1.0 (read-only)' }, cache: 'no-store' });
    if (res.status === 429 && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : delay);
      delay *= 2;
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (res.ok && ttl > 0) cache.set(key, { at: Date.now(), status: res.status, body, headers });
    return { status: res.status, body: body as T, headers, cached: false };
  }
}

export function clearCache(prefix?: string) {
  for (const k of cache.keys()) if (!prefix || k.startsWith(prefix)) cache.delete(k);
}
