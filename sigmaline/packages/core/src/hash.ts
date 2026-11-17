/**
 * Tamper-evident pick log (spec §8). Each row's hash = SHA-256 of
 *   prev_hash + "\n" + canonical JSON of the row's logged fields.
 * The same code runs in the worker (Node 20+) and in the browser ("Verify the chain"),
 * using Web Crypto, so both sides compute byte-identical hashes.
 */

/** Fields that are hashed, in this exact set. Changing this list breaks old chains — don't. */
export const HASHED_FIELDS = [
  'id', 'created_at', 'sport', 'league', 'event_id', 'event_name', 'commence_time', 'market', 'selection',
  'line', 'book', 'price_decimal', 'fair_decimal', 'ev', 'grade', 'model_version', 'stake_units', 'seq',
] as const;

export type HashedPick = Record<(typeof HASHED_FIELDS)[number], string | number | null>;

export const GENESIS_HASH = '0'.repeat(64);

/** Canonical JSON: keys sorted, numbers as JS prints them, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function pickPayload(row: Record<string, unknown>): string {
  const o: Record<string, unknown> = {};
  for (const f of HASHED_FIELDS) {
    let v = row[f] ?? null;
    // Postgres returns numerics as strings and timestamps in its own format; normalise.
    if (typeof v === 'string' && (f === 'line' || f === 'price_decimal' || f === 'fair_decimal' || f === 'ev' || f === 'stake_units' || f === 'seq')) v = Number(v);
    if ((f === 'created_at' || f === 'commence_time') && typeof v === 'string') v = new Date(v).toISOString();
    o[f] = v;
  }
  return canonicalJson(o);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function pickHash(prevHash: string, row: Record<string, unknown>): Promise<string> {
  return sha256Hex(`${prevHash}\n${pickPayload(row)}`);
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  /** seq of the first row that fails, if any. */
  brokenAt?: number;
  reason?: string;
}

/** Recompute every hash in order (rows must be sorted by seq ascending). */
export async function verifyChain(rows: Record<string, unknown>[]): Promise<ChainCheck> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (Number(r.seq) !== i + 1) return { ok: false, checked: i, brokenAt: Number(r.seq), reason: 'sequence gap (a row is missing)' };
    if (r.prev_hash !== prev) return { ok: false, checked: i, brokenAt: Number(r.seq), reason: 'prev_hash does not match the row before' };
    const h = await pickHash(prev, r);
    if (h !== r.hash) return { ok: false, checked: i, brokenAt: Number(r.seq), reason: 'row contents do not match its hash' };
    prev = h;
  }
  return { ok: true, checked: rows.length };
}
