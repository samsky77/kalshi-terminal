// The Odds API (v4) client. Server-only: the key never reaches the phone.
// Credits: cost = markets x regions per call = 3 (h2h,spreads,totals x us). /v4/sports is free.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeName } from '@/core/matcher';
import type { OddsBatch } from '@/core/pipeline';
import { LEAGUE_SEEDS, ODDS_CREDITS_PER_KEY, ODDS_RESERVE } from '@/core/sports';
import type { KalshiGame, OddsEvent, Sport } from '@/core/types';
import { espnBatch, espnCovers } from './espn';
import { getJson, Throttle } from './http';
import { fixturesDir } from './root';

export const ODDS_BASE = 'https://api.the-odds-api.com/v4';
const throttle = new Throttle(2);
const STATUS_TTL = 60_000;
const BATCH_TTL = 12 * 3600_000; // "cache results for hours"

export interface OddsSportInfo { key: string; group: string; title: string; active: boolean; has_outrights: boolean }

export interface Credits { remaining: number | null; used: number | null; checkedAt: string }

export function oddsKey(): string | undefined {
  const k = process.env.ODDS_API_KEY?.trim();
  return k ? k : undefined;
}
export function oddsMode(): 'live' | 'fixture' {
  return oddsKey() ? 'live' : 'fixture';
}

const batchCache = new Map<string, OddsBatch>();
let lastCredits: Credits = { remaining: null, used: null, checkedAt: '' };

function readCredits(h: Record<string, string>): Credits {
  const r = Number(h['x-requests-remaining']);
  const u = Number(h['x-requests-used']);
  return { remaining: Number.isFinite(r) ? r : null, used: Number.isFinite(u) ? u : null, checkedAt: new Date().toISOString() };
}

/** Free call: active sports + current credit headers. */
export async function oddsStatus(force = false): Promise<{ credits: Credits; sports: OddsSportInfo[] }> {
  const key = oddsKey();
  if (!key) return { credits: lastCredits, sports: fixtureSports() };
  const r = await getJson<OddsSportInfo[]>(`${ODDS_BASE}/sports?apiKey=${encodeURIComponent(key)}`, {
    throttle, ttlMs: force ? 0 : STATUS_TTL, cacheKey: 'odds:sports',
  });
  if (r.status !== 200) throw new Error(`Odds API /sports failed: HTTP ${r.status}`);
  if (!r.cached) lastCredits = readCredits(r.headers);
  return { credits: lastCredits, sports: Array.isArray(r.body) ? r.body : [] };
}

const TENNIS_STOP = new Set(['atp', 'wta', 'men', 'mens', 'women', 'womens', 'singles', 'doubles', 'tour', 'world', 'tennis', 'the', 'championships', 'open']);
function tennisTokens(s: string): string[] {
  return normalizeName(s).replace(/[()]/g, ' ').split(' ').filter((t) => t && !TENNIS_STOP.has(t));
}

/** Map a Kalshi tennis competition (e.g. "ATP World Tour Finals Men Singles") to an active Odds API key. */
export function tennisKeyFor(competition: string, league: string, sports: OddsSportInfo[]): string | undefined {
  const tour = league === 'KXWTA' ? 'tennis_wta' : 'tennis_atp';
  const ct = tennisTokens(competition);
  let best: { key: string; score: number } | undefined;
  for (const s of sports) {
    if (!s.key.startsWith(tour) || s.has_outrights) continue;
    const kt = tennisTokens(s.title);
    const hit = kt.filter((t) => ct.includes(t)).length;
    if (hit && (!best || hit > best.score)) best = { key: s.key, score: hit };
  }
  return best?.key;
}

/** Odds keys that have at least one matching open Kalshi game for this sport. */
export function keysForGames(sport: Sport, games: KalshiGame[], sports: OddsSportInfo[], horizonHours?: number): { keys: string[]; unmapped: string[] } {
  const keys = new Set<string>();
  const unmapped = new Set<string>();
  const active = new Set(sports.map((s) => s.key));
  for (const g of games) {
    if (Date.parse(g.startTime) < Date.now() - 6 * 3600e3) continue;
    if (horizonHours !== undefined && Date.parse(g.startTime) > Date.now() + horizonHours * 3600e3) continue;
    const seed = LEAGUE_SEEDS.find((s) => s.prefix === g.league);
    if (!seed || seed.sport !== sport) continue;
    const k = seed.sport === 'tennis' ? tennisKeyFor(g.competition, g.league, sports) : seed.oddsKey ?? undefined;
    if (k && (active.has(k) || !sports.length)) keys.add(k);
    else unmapped.add(`${g.league} ${g.competition}`);
  }
  return { keys: [...keys].sort(), unmapped: [...unmapped].sort() };
}

export class ReserveError extends Error {
  constructor(public remaining: number, public cost: number) {
    super(`Refresh refused: costs ${cost} credits and would leave ${remaining - cost}, below the ${ODDS_RESERVE}-credit reserve.`);
  }
}

export interface RefreshResult {
  mode: 'live' | 'fixture';
  sport: Sport;
  keys: string[];
  cost: number;
  creditsBefore: number | null;
  credits: Credits;
  batches: OddsBatch[];
  errors: string[];
}

/**
 * Refresh one sport. Keys ESPN covers (NBA, NFL, NHL, CFB, CBB) come from the free ESPN feed and cost no credits;
 * everything else (soccer, tennis, FCS) and any ESPN failure goes to The Odds API, behind the credit reserve.
 */
export async function refreshOdds(sport: Sport, keys: string[]): Promise<RefreshResult> {
  const key = oddsKey();
  const batches: OddsBatch[] = [];
  const errors: string[] = [];
  const paid: string[] = [];
  for (const k of keys) {
    if (!espnCovers(k)) { paid.push(k); continue; }
    try {
      const b = await espnBatch(k);
      batchCache.set(k, b);
      batches.push(b);
    } catch (e) {
      errors.push(`${(e as Error).message} (free feed)`);
      paid.push(k);
    }
  }
  if (!key) {
    const fx = fixtureBatches(sport).filter((b) => paid.includes(b.sportKey));
    return { mode: batches.length ? 'live' : 'fixture', sport, keys, cost: 0, creditsBefore: null, credits: lastCredits, batches: [...batches, ...fx], errors };
  }
  if (!paid.length) return { mode: 'live', sport, keys, cost: 0, creditsBefore: lastCredits.remaining, credits: lastCredits, batches, errors };
  const cost = paid.length * ODDS_CREDITS_PER_KEY;
  const { credits } = await oddsStatus(true);
  const before = credits.remaining;
  if (before !== null && before - cost < ODDS_RESERVE) {
    if (batches.length) return { mode: 'live', sport, keys, cost: 0, creditsBefore: before, credits, batches, errors: [...errors, new ReserveError(before, cost).message] };
    throw new ReserveError(before, cost);
  }
  for (const k of paid) {
    const q = new URLSearchParams({ apiKey: key, regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'decimal', dateFormat: 'iso' });
    const r = await getJson<OddsEvent[]>(`${ODDS_BASE}/sports/${k}/odds?${q}`, { throttle, retries: 2 });
    if (r.status === 200 && Array.isArray(r.body)) {
      lastCredits = readCredits(r.headers);
      const b: OddsBatch = { sportKey: k, fetchedAt: new Date().toISOString(), events: r.body };
      batchCache.set(k, b);
      batches.push(b);
    } else {
      const body: unknown = r.body;
      errors.push(`${k}: HTTP ${r.status} ${(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 120)}`);
      if (r.headers['x-requests-remaining']) lastCredits = readCredits(r.headers);
    }
  }
  return { mode: 'live', sport, keys, cost, creditsBefore: before, credits: lastCredits, batches, errors };
}

/** Server-side cached batches (no upstream call). */
export function cachedBatches(keys: string[]): OddsBatch[] {
  return keys
    .map((k) => batchCache.get(k))
    .filter((b): b is OddsBatch => !!b && Date.now() - Date.parse(b.fetchedAt) < BATCH_TTL);
}

// ---------------- fixtures ----------------
const fixDir = () => path.join(fixturesDir(), 'odds');

export function fixtureBatches(sport: Sport): OddsBatch[] {
  const f = path.join(fixDir(), `${sport}.json`);
  if (!existsSync(f)) return [];
  return (JSON.parse(readFileSync(f, 'utf8')) as { batches: OddsBatch[] }).batches;
}
export function fixtureSports(): OddsSportInfo[] {
  const f = path.join(fixDir(), 'sports.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
}
