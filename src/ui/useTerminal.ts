'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OddsBatch, PipelineOutput } from '@/core/pipeline';
import { SPORTS, type Sport } from '@/core/types';
import type { SportSnapshot } from '@/server/kalshi';
import { buildPicks, summarize, unsettledTickers, type BacktestSummary } from '@/core/backtest';
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
const AUTO_HORIZON_H = 24; // auto refresh covers games starting within this window
const AUTO_RETRY_MS = 3600_000; // after any automatic attempt, wait an hour before trying that sport again
const AUTO_MIN_GAP_MS = 10 * 3600_000; // at most about one paid refresh per sport per day

const FETCH_TIMEOUT_MS = 45_000;
/** Sports in loading order: quickest to price first, so something useful shows early. */
const LOAD_ORDER: Sport[] = ['tennis', 'nba', 'nhl', 'nfl', 'ncaab', 'soccer', 'ncaaf'];
/** Only games starting within a week are simulated; later ones are listed as "priced closer to game time". */
export const SIM_HORIZON_H = 7 * 24;

/** Turn a failed request into words a person can act on. */
function friendly(status: number, serverMsg?: string): string {
  if (serverMsg && !/^fetch failed$/i.test(serverMsg) && serverMsg.length < 160) return serverMsg;
  if (status === 0) return 'no connection';
  if (status === 504 || status === 408) return 'the data server timed out';
  if (status === 502 || status === 503 || serverMsg) return 'could not reach the data source';
  if (status === 429) return 'too many requests, slow down';
  return `server error ${status}`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
    throw Object.assign(new Error(timedOut ? 'timed out' : 'no connection'), { status: 0 });
  }
  let body: unknown = null;
  try { body = await r.json(); } catch { /* not JSON (e.g. a gateway error page) */ }
  if (!r.ok) throw Object.assign(new Error(friendly(r.status, (body as { error?: string } | null)?.error)), { status: r.status, body });
  if (body === null || typeof body !== 'object') throw Object.assign(new Error('unexpected reply from the server'), { status: r.status });
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
  const [backtest, setBacktest] = useState<BacktestSummary | null>(null);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  /** Bumped on every mode switch; work started under an older generation must not touch state. */
  const genRef = useRef(0);
  const loadingAll = useRef(false);
  const refreshing = useRef(new Set<Sport>());

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
      // A dead worker (killed in the background on iOS, failed to load) must not leave spinners running forever.
      const fail = () => {
        workerRef.current?.terminate();
        workerRef.current = null;
        const waiting = [...pending.current.values()];
        pending.current.clear();
        for (const cb of waiting) cb({ ok: false, error: 'simulation worker stopped' });
      };
      workerRef.current.onerror = fail;
      workerRef.current.onmessageerror = fail;
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
        try {
          worker().postMessage({ id, sport, games: snap.games, odds, now, horizonHours: SIM_HORIZON_H });
        } catch {
          pending.current.delete(id);
          resolve(null);
        }
      }),
    [worker],
  );

  /** Recompute one sport and persist (live mode only). */
  const recompute = useCallback(
    async (sport: Sport, trigger: store.DatasetRecord['trigger'] | null) => {
      const snap = snapsRef.current[sport];
      if (!snap) return;
      const gen = genRef.current;
      const demo = modeRef.current === 'demo';
      setBusyFor(sport, 'simulating');
      const out = await compute(sport, snap, demo ? demoOdds.current[sport] ?? [] : oddsRef.current, demo ? snap.fetchedAt : undefined);
      if (gen !== genRef.current) return;
      setBusyFor(sport);
      if (!out) { setErrFor(sport, 'could not run the simulation; it will retry'); return; }
      setResults((r) => ({ ...r, [sport]: out }));
      if (demo) return;
      await store.saveResult(sport, out).catch(() => {});
      // Dataset: every odds refresh, plus Kalshi price snapshots at most every 30 minutes per sport.
      if (trigger && out.games.some((g) => g.status !== 'unpriced')) {
        const m = await store.loadMeta();
        const last = m.lastDatasetSave?.[sport];
        if (trigger === 'odds-refresh' || !last || Date.now() - Date.parse(last) > 30 * 60_000) {
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
      const gen = genRef.current;
      setBusyFor(sport, 'kalshi');
      try {
        const demo = modeRef.current === 'demo';
        const snap = await getJson<SportSnapshot>(`/api/kalshi?sport=${sport}${demo ? '&source=fixture' : ''}`);
        if (gen !== genRef.current) return;
        if (!Array.isArray(snap.games)) throw new Error('unexpected reply from the server');
        snapsRef.current = { ...snapsRef.current, [sport]: snap };
        setSnaps(snapsRef.current);
        setErrFor(sport);
        if (!demo) await store.saveKalshi(sport, snap).catch(() => {});
        await recompute(sport, demo ? null : 'kalshi-refresh');
      } catch (e) {
        if (gen === genRef.current) setErrFor(sport, `Kalshi: ${(e as Error).message}`);
      } finally {
        if (gen === genRef.current) setBusy((b) => (b[sport] === 'kalshi' ? { ...b, [sport]: undefined } : b));
      }
    },
    [recompute],
  );

  const loadStatus = useCallback(async () => {
    try {
      const s = await getJson<Status>('/api/odds/status');
      setStatus(s);
      setStatusError(null);
      if (s.credits && s.credits.remaining !== null) {
        const m = await store.loadMeta();
        m.credits = s.credits;
        await store.saveMeta(m);
        setMeta(m);
      }
    } catch (e) { setStatusError((e as Error).message); }
  }, []);

  const loadPlan = useCallback(async (sport: Sport) => {
    try {
      const p = await getJson<Plan>(`/api/odds/plan?sport=${sport}`);
      if (!Array.isArray(p.keys)) return; // not a plan (bad reply): keep the previous one
      setPlans((x) => ({ ...x, [sport]: { keys: p.keys, unmapped: Array.isArray(p.unmapped) ? p.unmapped : [], cost: Number(p.cost) || 0 } }));
    } catch { /* offline */ }
  }, []);

  /** Credit-spending refresh. Manual from Data, or automatic once a day (auto = only games starting within 24 h). */
  const refreshOdds = useCallback(
    async (sport: Sport, auto = false): Promise<boolean> => {
      if (refreshing.current.has(sport)) return false; // never two paid refreshes of one sport at once
      refreshing.current.add(sport);
      const label = sport.toUpperCase();
      setBusyFor(sport, 'odds');
      setNotice(null);
      let gotEvents = false;
      try {
        const r = await getJson<{ mode: string; batches: OddsBatch[]; credits: Status['credits']; cost: number; creditsBefore: number | null; errors: string[] }>(
          '/api/odds/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(auto ? { sport, horizonHours: AUTO_HORIZON_H } : { sport }) });
        if (!Array.isArray(r.batches)) throw new Error('unexpected reply from the server');
        const errs = Array.isArray(r.errors) ? r.errors : [];
        const nEvents = r.batches.reduce((a, b) => a + (b.events?.length ?? 0), 0);
        gotEvents = nEvents > 0;
        for (const b of r.batches) await store.saveOddsBatch(b);
        const keys = new Set(r.batches.map((b) => b.sportKey));
        oddsRef.current = [...oddsRef.current.filter((b) => !keys.has(b.sportKey)), ...r.batches];
        const m = await store.loadMeta();
        if (r.credits && r.credits.remaining !== null) m.credits = r.credits;
        // Only a refresh that actually returned lines counts; an empty or failed one may be retried within the hour.
        if (gotEvents) m.lastOddsRefresh = { ...m.lastOddsRefresh, [sport]: new Date().toISOString() };
        await store.saveMeta(m);
        setMeta(m);
        setStatus((s) => (s && r.credits ? { ...s, credits: r.credits } : s));
        const spent = r.creditsBefore !== null && r.credits && r.credits.remaining !== null ? r.creditsBefore - r.credits.remaining : null;
        const cost = r.mode === 'fixture' ? 'recorded odds, no credits used'
          : r.cost === 0 ? 'free feed, no credits used'
          : `${spent ?? r.cost} credit${(spent ?? r.cost) === 1 ? '' : 's'} used`;
        setNotice(`${label}${auto ? ' (automatic)' : ''}: odds for ${nEvents} game${nEvents === 1 ? '' : 's'} loaded (${cost}).` +
          (errs.length ? ` Notes: ${errs.join('; ')}` : ''));
        if (!snapsRef.current[sport]) await loadKalshi(sport);
        else await recompute(sport, 'odds-refresh');
      } catch (e) {
        setNotice(`${label}: odds refresh failed (${(e as Error).message}).`);
      } finally {
        refreshing.current.delete(sport);
        setBusy((b) => (b[sport] === 'odds' ? { ...b, [sport]: undefined } : b));
      }
      return gotEvents;
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
        // Failed attempts must not retry on every 90 s poll (that would burn credits): wait an hour after any attempt.
        const attemptKey = `kt-auto-attempt-${s}`;
        let attempt = 0;
        try { attempt = Number(localStorage.getItem(attemptKey)) || 0; } catch { /* private mode */ }
        if (Date.now() - attempt < AUTO_RETRY_MS) continue;
        try { localStorage.setItem(attemptKey, String(Date.now())); } catch { /* private mode */ }
        if (document.hidden) break; // never spend credits while the app is in the background
        await refreshOdds(s, true);
      }
    } finally {
      autoRefreshing.current = false;
    }
  }, [refreshOdds]);

  /** Load every sport, two at a time, quickest first. One slow or failed sport never blocks the others. */
  const loadAll = useCallback(async () => {
    if (loadingAll.current) return;
    loadingAll.current = true;
    const gen = genRef.current;
    try {
      const queue = [...LOAD_ORDER];
      const lane = async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          if (gen !== genRef.current) return;
          await loadKalshi(s);
        }
      };
      await Promise.all([lane(), lane()]);
    } finally {
      if (gen === genRef.current) loadingAll.current = false;
    }
  }, [loadKalshi]);

  const setMode = useCallback(
    async (m: Mode) => {
      if (m === modeRef.current && genRef.current > 0) return; // already in this mode
      const gen = ++genRef.current;
      loadingAll.current = false;
      modeRef.current = m;
      setModeState(m);
      try { localStorage.setItem('kt-mode', m); } catch { /* private mode */ }
      setResults({});
      setErrors({});
      setBusy({});
      setNotice(null);
      snapsRef.current = {};
      setSnaps({});
      if (m === 'demo') {
        demoOdds.current = {};
        const failed: string[] = [];
        const got = await Promise.all(SPORTS.map(async (s) => {
          try { return [s, (await getJson<{ batches: OddsBatch[] }>(`/api/odds/fixture?sport=${s}`)).batches ?? []] as const; }
          catch { failed.push(s.toUpperCase()); return [s, [] as OddsBatch[]] as const; }
        }));
        if (gen !== genRef.current) return;
        for (const [s, b] of got) demoOdds.current[s] = b;
        if (failed.length) setNotice(`Demo odds could not be loaded for ${failed.join(', ')}. Those sports will show as unpriced. Check your connection and switch Demo off and on.`);
      } else {
        await hydrate();
        if (gen !== genRef.current) return;
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

  /** Automatic backtest: rebuild picks from the saved snapshots, fetch settlements for finished games, grade. At most every 20 min. */
  const lastBacktest = useRef(0);
  const runBacktest = useCallback(async (force = false) => {
    if (!force && Date.now() - lastBacktest.current < 20 * 60_000) return;
    lastBacktest.current = Date.now();
    try {
      // Keep storage bounded: snapshots older than 30 days are dropped (their games settled long ago).
      await store.pruneRecords(new Date(Date.now() - 30 * 86400e3).toISOString()).catch(() => {});
      setDatasetCount(await store.countRecords());
      const picks = buildPicks(await store.allRecords());
      const m = await store.loadMeta();
      const settled = { ...(m.settled ?? {}) };
      if (navigator.onLine) {
        const todo = unsettledTickers(picks, settled).slice(0, 120);
        for (let i = 0; i < todo.length; i += 40) {
          const r = await fetch(`/api/settle?tickers=${encodeURIComponent(todo.slice(i, i + 40).join(','))}`).then((x) => x.json()).catch(() => null);
          if (r?.settled) Object.assign(settled, r.settled);
        }
        if (Object.keys(settled).length !== Object.keys(m.settled ?? {}).length) {
          const m2 = await store.loadMeta();
          await store.saveMeta({ ...m2, settled });
        }
      }
      setBacktest(summarize(picks, settled));
    } catch { /* IndexedDB unavailable */ }
  }, []);

  useEffect(() => {
    let saved: Mode = 'live';
    try { saved = (localStorage.getItem('kt-mode') as Mode) || 'live'; } catch { /* ignore */ }
    setOnline(navigator.onLine);
    // Coming back online or back to the app: refresh prices right away rather than waiting for the next poll.
    const on = () => { setOnline(true); if (modeRef.current === 'live') { loadStatus(); loadAll(); } };
    const off = () => setOnline(false);
    const vis = () => { if (!document.hidden && navigator.onLine && modeRef.current === 'live') loadAll().then(() => autoRefresh()); };
    document.addEventListener('visibilitychange', vis);
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    (async () => {
      if (navigator.onLine) loadStatus();
      if (saved === 'demo') await setMode('demo');
      else {
        await hydrate();
        if (navigator.onLine) { await loadAll(); await autoRefresh(); }
      }
      runBacktest(true);
    })();
    const t = setInterval(() => {
      if (!navigator.onLine || document.hidden || modeRef.current !== 'live') return;
      // Kalshi prices every poll (free); odds at most once per sport per day (see autoRefresh).
      // Every sport is polled, including ones whose first load failed and ones with no odds yet.
      loadAll().then(() => autoRefresh());
      runBacktest();
    }, KALSHI_POLL_MS);
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportDataset = useCallback(async () => {
    const all = await store.allRecords();
    const blob = new Blob([JSON.stringify(all)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `kx-terminal-history-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setNotice(`Saved ${all.length} snapshot${all.length === 1 ? '' : 's'} to your downloads as ${a.download}.`);
  }, []);

  const clearDataset = useCallback(async () => {
    await store.clearRecords();
    setDatasetCount(0);
    setBacktest(null);
    lastBacktest.current = 0;
  }, []);

  return {
    mode, setMode, snaps, results, busy, errors, status, meta, plans, datasetCount, backtest, runBacktest, online, notice, statusError,
    setNotice, loadKalshi, loadAll, refreshOdds, loadPlan, loadStatus, exportDataset, clearDataset,
  };
}

export type Terminal = ReturnType<typeof useTerminal>;
