'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OddsBatch, PipelineOutput } from '@/core/pipeline';
import { SPORTS, type Sport } from '@/core/types';
import type { SportSnapshot } from '@/server/kalshi';
import * as store from './store';

export type Mode = 'live' | 'demo';

export interface Status {
  mode: 'live' | 'fixture';
  credits: { remaining: number | null; used: number | null; checkedAt: string } | null;
  reserve: number;
  costPerKey: number;
  error?: string;
}

export interface Plan { keys: string[]; unmapped: string[]; cost: number }

type PerSport<T> = Partial<Record<Sport, T>>;

const KALSHI_POLL_MS = 90_000;
const AUTO_HORIZON_H = 36; // auto refresh covers games starting within this window
const AUTO_MIN_GAP_MS = 10 * 3600_000; // at most about one paid refresh per sport per day

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${r.status}`), { status: r.status, body });
  return body as T;
}

export function useTerminal() {
  const [mode, setModeState] = useState<Mode>('live');
  const [snaps, setSnaps] = useState<PerSport<SportSnapshot>>({});
  const [results, setResults] = useState<PerSport<PipelineOutput>>({});
  const [busy, setBusy] = useState<PerSport<string>>({});
  const [errors, setErrors] = useState<PerSport<string>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [meta, setMeta] = useState<store.Meta>({});
  const [plans, setPlans] = useState<PerSport<Plan>>({});
  const [datasetCount, setDatasetCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const oddsRef = useRef<OddsBatch[]>([]);
  const demoOdds = useRef<PerSport<OddsBatch[]>>({});
  const snapsRef = useRef<PerSport<SportSnapshot>>({});
  const modeRef = useRef<Mode>('live');
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const pending = useRef(new Map<number, (v: { ok: boolean; out?: PipelineOutput; error?: string }) => void>());

  const worker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../worker/sim.worker.ts', import.meta.url));
      workerRef.current.onmessage = (e) => {
        const cb = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        cb?.(e.data);
      };
    }
    return workerRef.current;
  }, []);

  const setBusyFor = (s: Sport, v?: string) => setBusy((b) => ({ ...b, [s]: v }));
  const setErrFor = (s: Sport, v?: string) => setErrors((b) => ({ ...b, [s]: v }));

  const compute = useCallback(
    (sport: Sport, snap: SportSnapshot, odds: OddsBatch[], now?: string): Promise<PipelineOutput | null> =>
      new Promise((resolve) => {
        const id = ++reqId.current;
        pending.current.set(id, (r) => resolve(r.ok ? r.out! : null));
        worker().postMessage({ id, sport, games: snap.games, odds, now });
      }),
    [worker],
  );

  /** Recompute one sport and persist (live mode only). */
  const recompute = useCallback(
    async (sport: Sport, trigger: store.DatasetRecord['trigger'] | null) => {
      const snap = snapsRef.current[sport];
      if (!snap) return;
      const demo = modeRef.current === 'demo';
      setBusyFor(sport, 'simulating');
      const out = await compute(sport, snap, demo ? demoOdds.current[sport] ?? [] : oddsRef.current, demo ? snap.fetchedAt : undefined);
      setBusyFor(sport);
      if (!out || modeRef.current !== (demo ? 'demo' : 'live')) return;
      setResults((r) => ({ ...r, [sport]: out }));
      if (demo) return;
      await store.saveResult(sport, out).catch(() => {});
      // Dataset: every odds refresh, plus Kalshi price snapshots at most every 15 minutes per sport.
      if (trigger && out.games.some((g) => g.status !== 'unpriced')) {
        const m = await store.loadMeta();
        const last = m.lastDatasetSave?.[sport];
        if (trigger === 'odds-refresh' || !last || Date.now() - Date.parse(last) > 15 * 60_000) {
          await store.addRecord(store.toRecord(out, trigger)).catch(() => {});
          m.lastDatasetSave = { ...m.lastDatasetSave, [sport]: new Date().toISOString() };
          await store.saveMeta(m);
          setMeta(m);
          setDatasetCount(await store.countRecords());
        }
      }
    },
    [compute],
  );

  const loadKalshi = useCallback(
    async (sport: Sport) => {
      setBusyFor(sport, 'kalshi');
      try {
        const demo = modeRef.current === 'demo';
        const snap = await getJson<SportSnapshot>(`/api/kalshi?sport=${sport}${demo ? '&source=fixture' : ''}`);
        if (modeRef.current !== (demo ? 'demo' : 'live')) return;
        snapsRef.current = { ...snapsRef.current, [sport]: snap };
        setSnaps(snapsRef.current);
        setErrFor(sport);
        if (!demo) await store.saveKalshi(sport, snap).catch(() => {});
        await recompute(sport, demo ? null : 'kalshi-refresh');
      } catch (e) {
        setErrFor(sport, (e as Error).message);
      } finally {
        setBusyFor(sport);
      }
    },
    [recompute],
  );

  const loadStatus = useCallback(async () => {
    try {
      const s = await getJson<Status>('/api/odds/status');
      setStatus(s);
      if (s.credits && s.credits.remaining !== null) {
        const m = await store.loadMeta();
        m.credits = s.credits;
        await store.saveMeta(m);
        setMeta(m);
      }
    } catch { /* offline */ }
  }, []);

  const loadPlan = useCallback(async (sport: Sport) => {
    try {
      const p = await getJson<Plan>(`/api/odds/plan?sport=${sport}`);
      setPlans((x) => ({ ...x, [sport]: p }));
    } catch { /* offline */ }
  }, []);

  /** Credit-spending refresh. Manual from Data, or automatic once a day (auto = only games starting within 36 h). */
  const refreshOdds = useCallback(
    async (sport: Sport, auto = false) => {
      setBusyFor(sport, 'odds');
      setNotice(null);
      try {
        const r = await getJson<{ mode: string; batches: OddsBatch[]; credits: Status['credits']; cost: number; creditsBefore: number | null; errors: string[] }>(
          '/api/odds/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(auto ? { sport, horizonHours: AUTO_HORIZON_H } : { sport }) });
        for (const b of r.batches) await store.saveOddsBatch(b);
        const keys = new Set(r.batches.map((b) => b.sportKey));
        oddsRef.current = [...oddsRef.current.filter((b) => !keys.has(b.sportKey)), ...r.batches];
        const m = await store.loadMeta();
        if (r.credits && r.credits.remaining !== null) m.credits = r.credits;
        m.lastOddsRefresh = { ...m.lastOddsRefresh, [sport]: new Date().toISOString() };
        await store.saveMeta(m);
        setMeta(m);
        setStatus((s) => (s && r.credits ? { ...s, credits: r.credits } : s));
        const spent = r.creditsBefore !== null && r.credits?.remaining !== null && r.credits ? r.creditsBefore - (r.credits.remaining ?? 0) : null;
        setNotice(`${sport.toUpperCase()}: ${r.batches.reduce((a, b) => a + b.events.length, 0)} events from ${r.batches.length} key(s)` +
          (r.mode === 'fixture' ? ' (fixture mode, no credits used)' : `, cost ${r.cost}, counter dropped ${spent ?? '?'}`) +
          (r.errors.length ? `. Errors: ${r.errors.join('; ')}` : ''));
        if (!snapsRef.current[sport]) await loadKalshi(sport);
        else await recompute(sport, 'odds-refresh');
      } catch (e) {
        setNotice(`${sport.toUpperCase()}: ${(e as Error).message}`);
      } finally {
        setBusyFor(sport);
      }
    },
    [loadKalshi, recompute],
  );

  /** Once a day per sport: pull odds for games starting soon, so today's slate is always priced. */
  const autoRefreshing = useRef(false);
  const autoRefresh = useCallback(async () => {
    if (autoRefreshing.current || modeRef.current !== 'live') return;
    autoRefreshing.current = true;
    try {
      const m = await store.loadMeta();
      for (const s of SPORTS) {
        const games = snapsRef.current[s]?.games ?? [];
        const soon = games.some((g) => {
          const t = Date.parse(g.startTime);
          return t > Date.now() - 3 * 3600e3 && t < Date.now() + AUTO_HORIZON_H * 3600e3;
        });
        if (!soon) continue;
        const last = m.lastOddsRefresh?.[s];
        if (last && Date.now() - Date.parse(last) < AUTO_MIN_GAP_MS) continue;
        await refreshOdds(s, true);
        m.lastOddsRefresh = { ...m.lastOddsRefresh, [s]: new Date().toISOString() };
      }
    } finally {
      autoRefreshing.current = false;
    }
  }, [refreshOdds]);

  const loadAll = useCallback(async () => {
    for (const s of SPORTS) await loadKalshi(s);
  }, [loadKalshi]);

  const setMode = useCallback(
    async (m: Mode) => {
      modeRef.current = m;
      setModeState(m);
      try { localStorage.setItem('kt-mode', m); } catch { /* private mode */ }
      setResults({});
      snapsRef.current = {};
      setSnaps({});
      if (m === 'demo') {
        for (const s of SPORTS) {
          try {
            const f = await getJson<{ batches: OddsBatch[] }>(`/api/odds/fixture?sport=${s}`);
            demoOdds.current[s] = f.batches;
          } catch { demoOdds.current[s] = []; }
        }
      } else {
        await hydrate();
      }
      await loadAll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadAll],
  );

  /** Offline-first: show the last stored data immediately. */
  const hydrate = useCallback(async () => {
    try {
      oddsRef.current = await store.loadOddsBatches();
      const m = await store.loadMeta();
      setMeta(m);
      setDatasetCount(await store.countRecords());
      const sn: PerSport<SportSnapshot> = {};
      const rs: PerSport<PipelineOutput> = {};
      for (const s of SPORTS) {
        const k = await store.loadKalshi(s);
        if (k) sn[s] = k;
        const r = await store.loadResult(s);
        if (r) rs[s] = r;
      }
      snapsRef.current = sn;
      setSnaps(sn);
      setResults(rs);
    } catch { /* IndexedDB unavailable */ }
  }, []);

  useEffect(() => {
    let saved: Mode = 'live';
    try { saved = (localStorage.getItem('kt-mode') as Mode) || 'live'; } catch { /* ignore */ }
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    (async () => {
      if (navigator.onLine) loadStatus();
      if (saved === 'demo') await setMode('demo');
      else {
        await hydrate();
        if (navigator.onLine) { await loadAll(); await autoRefresh(); }
      }
    })();
    const t = setInterval(() => {
      if (!navigator.onLine || document.hidden || modeRef.current !== 'live') return;
      // Kalshi prices every poll (free); odds at most once per sport per day (see autoRefresh).
      for (const s of SPORTS) if (oddsRef.current.length && snapsRef.current[s]) loadKalshi(s);
      autoRefresh();
    }, KALSHI_POLL_MS);
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportDataset = useCallback(async () => {
    const all = await store.allRecords();
    const blob = new Blob([JSON.stringify(all)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kalshi-terminal-dataset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, []);

  const clearDataset = useCallback(async () => {
    await store.clearRecords();
    setDatasetCount(0);
  }, []);

  return {
    mode, setMode, snaps, results, busy, errors, status, meta, plans, datasetCount, online, notice,
    setNotice, loadKalshi, loadAll, refreshOdds, loadPlan, loadStatus, exportDataset, clearDataset,
  };
}

export type Terminal = ReturnType<typeof useTerminal>;
