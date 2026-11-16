export const pct = (p: number | undefined | null, d = 1) => (p === undefined || p === null || !Number.isFinite(p) ? '—' : (p * 100).toFixed(d));
export const cents = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}`);
/** Cents with one decimal, e.g. an all-in cost of 39.6. */
export const cents1 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (Math.round(x * 1000) / 10).toFixed(1));

/**
 * Edge in cents, one decimal, truncated toward zero: a row never prints "+2.0" unless the edge really is at
 * least 2.0, and a zero edge prints "0.0", never "-0.0".
 */
export function edgeC(e: number | null | undefined): string {
  if (e === null || e === undefined || !Number.isFinite(e)) return '—';
  const t = Math.trunc(e * 1000 + Math.sign(e) * 1e-6) / 10; // 0.01996 -> 1.9, 0.0199999999 -> 2.0
  if (t === 0) return '0.0';
  return `${t > 0 ? '+' : ''}${t.toFixed(1)}`;
}

export const size = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`;

/** "Sun Nov 15 1:00pm": weekday, date and time, so games a week apart never look alike. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime()) || d.getTime() < 86400e3 * 365) return 'time TBD';
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/[\s  ]/g, '').toLowerCase();
  return `${day} ${t}`;
}

export function ago(iso?: string): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return 'never';
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Colour class for an edge: clear value, small positive, zero, negative. */
export const signClass = (e: number | null | undefined) =>
  e === null || e === undefined ? 'mute' : e >= 0.02 - 1e-9 ? 'pos' : e >= 0.0005 ? 'pos-weak' : e > -0.0005 ? 'mute' : 'neg';

/** Signed dollars, e.g. "+1.24", "-0.38", "0.00". */
export function money(x: number): string {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? '0.00' : `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
}
