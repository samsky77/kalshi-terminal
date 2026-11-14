export const pct = (p: number | undefined | null, d = 1) => (p === undefined || p === null || !Number.isFinite(p) ? '—' : (p * 100).toFixed(d));
export const cents = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}`);
export const edgeC = (e: number | null | undefined) => (e === null || e === undefined ? '—' : `${e >= 0 ? '+' : ''}${(e * 100).toFixed(1)}`);
export const size = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

export function when(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  return `${day} ${t}`;
}

export function ago(iso?: string): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return `${Math.max(0, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${(s / 86400).toFixed(1)}d ago`;
}

export const signClass = (e: number | null | undefined) => (e === null || e === undefined ? 'mute' : e >= 0.02 ? 'pos' : e >= 0 ? 'pos-weak' : 'neg');
