'use client';
import { useEffect, useState } from 'react';

/** Relative label for a provider timestamp: "updated 3 min ago". */
export function agoText(ts: string | null | undefined, nowMs: number): string {
  if (!ts) return 'update time unknown';
  const m = Math.max(0, Math.floor((nowMs - Date.parse(ts)) / 60000));
  if (m < 1) return 'updated just now';
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `updated ${h} h ${m % 60} min ago`;
  return `updated ${Math.floor(h / 24)} d ago`;
}

function useNow(intervalMs = 15000): number {
  // Server render and first client render share `initial` (no hydration mismatch); then it ticks.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now ?? 0;
}

/**
 * "updated X min ago" from the book's own last_update, ticking without a refresh. Past the stale
 * threshold it shows a STALE tag. Server-rendered with `serverNow` so it is right before JS loads.
 */
export function Ago({ ts, staleMin, serverNow, className = '' }: { ts: string | null; staleMin: number; serverNow: number; className?: string }) {
  const live = useNow();
  const now = live || serverNow;
  const stale = !ts || now - Date.parse(ts) > staleMin * 60000;
  return (
    <span className={`whitespace-nowrap text-[10px] ${className}`} title={ts ? new Date(ts).toISOString() : undefined}>
      {stale && <span className="mr-1 border border-muted px-1 font-semibold uppercase tracking-[0.1em] text-ink">Stale</span>}
      <time dateTime={ts ?? undefined}>{agoText(ts, now)}</time>
    </span>
  );
}

/**
 * Row wrapper that dims itself once its price passes the stale threshold, client-side, so a row that
 * goes stale while the page is open is dimmed without a reload. Inside it, `.edge-only` elements
 * (grade, edge %) are hidden and `.stale-only` elements shown when stale (globals.css): stale prices
 * are never graded.
 */
export function FreshRow({ ts, staleMin, serverNow, as = 'li', className = '', children }: {
  ts: string | null; staleMin: number; serverNow: number; as?: 'li' | 'tr' | 'div'; className?: string; children: React.ReactNode;
}) {
  const live = useNow();
  const now = live || serverNow;
  const stale = !ts || now - Date.parse(ts) > staleMin * 60000;
  const Tag = as;
  return <Tag className={`${className} ${stale ? 'is-stale' : ''}`} data-stale={stale ? 'true' : undefined}>{children}</Tag>;
}
