'use client';
// On-device storage (IndexedDB). Holds the last Kalshi snapshot and odds batches per sport (so the app
// loads offline), the last computed results, and an append-only dataset of every refresh for backtests.
import type { OddsBatch, PipelineOutput } from '@/core/pipeline';
import type { Sport } from '@/core/types';
import type { SportSnapshot } from '@/server/kalshi';

const DB = 'kalshi-terminal';
const VERSION = 1;
const STORES = ['kalshi', 'odds', 'results', 'dataset', 'meta'] as const;
type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) {
        if (d.objectStoreNames.contains(s)) continue;
        if (s === 'dataset') d.createObjectStore(s, { keyPath: 'id', autoIncrement: true }).createIndex('sport', 'sport');
        else d.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbPut = (store: StoreName, key: IDBValidKey, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbKeys = (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());

// ---- typed helpers ----
export const saveKalshi = (sport: Sport, snap: SportSnapshot) => idbPut('kalshi', sport, snap);
export const loadKalshi = (sport: Sport) => idbGet<SportSnapshot>('kalshi', sport);

export const saveOddsBatch = (b: OddsBatch) => idbPut('odds', b.sportKey, b);
export async function loadOddsBatches(): Promise<OddsBatch[]> {
  const keys = await idbKeys('odds');
  const out: OddsBatch[] = [];
  for (const k of keys) {
    const b = await idbGet<OddsBatch>('odds', k);
    if (b) out.push(b);
  }
  return out;
}

export const saveResult = (sport: Sport, out: PipelineOutput) => idbPut('results', sport, out);
export const loadResult = (sport: Sport) => idbGet<PipelineOutput>('results', sport);

export interface Meta {
  credits?: { remaining: number | null; used: number | null; checkedAt: string };
  lastOddsRefresh?: Partial<Record<Sport, string>>;
  lastDatasetSave?: Partial<Record<Sport, string>>;
  settled?: Record<string, 'yes' | 'no'>; // Kalshi settlements for backtest picks (ticker -> result)
}
export const loadMeta = async () => (await idbGet<Meta>('meta', 'meta')) ?? {};
export const saveMeta = (m: Meta) => idbPut('meta', 'meta', m);

// ---- backtest dataset ----
export interface DatasetRecord {
  id?: number;
  sport: Sport;
  savedAt: string;
  trigger: 'odds-refresh' | 'kalshi-refresh';
  computedAt: string;
  games: {
    gameId: string;
    title: string;
    startTime: string;
    status: string;
    oddsFetchedAt?: string;
    consensus?: unknown;
    sim?: { model: string; params: Record<string, number>; runs: number; seed: number; pHomeWin: number; pAwayWin: number; pTie: number; pHomeCoverMain?: number; pOverMain?: number };
    contracts: { t: string; k: string; s?: number; tier: string; p: number; ya: number | null; na: number | null; ys: number; ns: number; ye: number | null; ne: number | null }[];
  }[];
}

export function toRecord(out: PipelineOutput, trigger: DatasetRecord['trigger']): DatasetRecord {
  return {
    sport: out.sport,
    savedAt: new Date().toISOString(),
    trigger,
    computedAt: out.computedAt,
    games: out.games
      .filter((g) => g.status === 'priced')
      .map((g) => ({
        gameId: g.game.id,
        title: `${g.awayName} @ ${g.homeName}`,
        startTime: g.game.startTime,
        status: g.status,
        oddsFetchedAt: g.oddsFetchedAt,
        consensus: g.consensus,
        sim: g.sim && {
          model: g.sim.model, params: g.sim.params, runs: g.sim.runs, seed: g.sim.seed,
          pHomeWin: g.sim.pHomeWin, pAwayWin: g.sim.pAwayWin, pTie: g.sim.pTie, pHomeCoverMain: g.sim.pHomeCoverMain, pOverMain: g.sim.pOverMain,
        },
        // Only contracts at or near a value edge are needed to grade picks; storing every strike filled the phone's storage.
        contracts: g.contracts.filter((c) => Math.max(c.yes.edge ?? -1, c.no.edge ?? -1) >= 0.01).map((c) => ({
          t: c.contract.ticker, k: c.contract.kind, s: c.contract.floorStrike ?? c.contract.capStrike, tier: c.tier, p: +c.probYes.toFixed(4),
          ya: c.yes.ask, na: c.no.ask, ys: c.yes.size, ns: c.no.size,
          ye: c.yes.edge === null ? null : +c.yes.edge.toFixed(4), ne: c.no.edge === null ? null : +c.no.edge.toFixed(4),
        })),
      })),
  };
}

export const addRecord = (r: DatasetRecord) => tx('dataset', 'readwrite', (s) => s.add(r));
export const countRecords = () => tx<number>('dataset', 'readonly', (s) => s.count());
export const allRecords = () => tx<DatasetRecord[]>('dataset', 'readonly', (s) => s.getAll());
export const clearRecords = () => tx('dataset', 'readwrite', (s) => s.clear());

/** Delete snapshots saved before the given ISO time. */
export async function pruneRecords(beforeIso: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction('dataset', 'readwrite');
    const req = t.objectStore('dataset').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if ((c.value as DatasetRecord).savedAt < beforeIso) { c.delete(); c.continue(); }
      // records are stored in time order: stop at the first one that is new enough
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
