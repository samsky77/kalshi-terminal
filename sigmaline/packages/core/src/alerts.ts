import { formatAmerican } from './odds';
import type { Grade } from './types';

/** "A · NYK +2.5 (−110) · EV +7.5% · 7:00 PM" (spec §10). */
export function alertText(p: { grade: Grade; label: string; decimal: number; ev: number; commence: string; timeZone?: string }): string {
  const t = new Date(p.commence).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: p.timeZone ?? 'America/New_York' });
  return `${p.grade} · ${p.label} (${formatAmerican(p.decimal)}) · EV +${(p.ev * 100).toFixed(1)}% · ${t}`;
}

/** Quiet hours "22:00"–"08:00" in the member's time zone; wraps past midnight. */
export function inQuietHours(nowIso: string, start: string | null | undefined, end: string | null | undefined, timeZone = 'America/New_York'): boolean {
  if (!start || !end || start === end) return false;
  const hm = new Date(nowIso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h % 24) * 60 + m; };
  const n = toMin(hm), a = toMin(start), b = toMin(end);
  return a < b ? n >= a && n < b : n >= a || n < b;
}

/** Short team code for alert text: "New York Knicks" -> "NYK" style fallback from initials. */
export function shortName(team: string): string {
  const words = team.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}
