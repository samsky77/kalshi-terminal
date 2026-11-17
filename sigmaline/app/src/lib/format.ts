import { decimalToAmerican, selectionLabel, type Selection } from '@sigmaline/core';

export const TZ = 'America/New_York';

export function american(dec: number | null | undefined): string {
  if (!dec || !(dec > 1)) return '—';
  const a = decimalToAmerican(dec);
  return a > 0 ? `+${a}` : `−${Math.abs(a)}`;
}

export function pct(x: number | null | undefined, digits = 1, sign = true): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const v = (x * 100).toFixed(digits);
  return `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${v.replace('-', '')}%`;
}

export function units(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}u`;
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function dayTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function dateLong(d = new Date()): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ }).toUpperCase();
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

export function selLabel(sel: Selection, home: string, away: string): string {
  return selectionLabel(sel, home, away);
}

export { bookName } from '@sigmaline/core/books';

export const DISCLAIMER = '21+ · For information and entertainment only. Not a guarantee of results. Gambling problem? Call 1-800-GAMBLER.';
