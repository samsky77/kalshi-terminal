/**
 * Request budgeter (spec §4.3). Pure planning logic; the worker persists usage in
 * `provider_usage` and asks this module what it may pull.
 *
 *  - < 80% of a quota: normal (pre-game, closing and slate refresh pulls).
 *  - 80–100%: conserve (only pre-game and closing pulls).
 *  - ≥ 100%: exhausted (no pulls; UI shows "Prices as of [time]").
 * Bigger slates get more refresh pulls (sport budget weight × games on the slate).
 */
export type ProviderId = 'oddsapi' | 'propline' | 'sharpapi';
export type PullKind = 'pregame' | 'closing' | 'refresh' | 'scores' | 'props';
export type BudgetMode = 'normal' | 'conserve' | 'exhausted';

export interface Quota {
  provider: ProviderId;
  period: 'day' | 'month';
  limit: number;
}

export const DEFAULT_QUOTAS: Quota[] = [
  { provider: 'oddsapi', period: 'month', limit: 500 },
  { provider: 'propline', period: 'day', limit: 1000 },
  { provider: 'sharpapi', period: 'day', limit: 5000 },
];

export interface UsageState { provider: ProviderId; used: number; limit: number; period: 'day' | 'month'; periodStart: string }

export function budgetMode(u: Pick<UsageState, 'used' | 'limit'>): BudgetMode {
  if (u.used >= u.limit) return 'exhausted';
  if (u.used >= 0.8 * u.limit) return 'conserve';
  return 'normal';
}

export function allowedKinds(mode: BudgetMode): PullKind[] {
  if (mode === 'exhausted') return [];
  if (mode === 'conserve') return ['pregame', 'closing'];
  return ['pregame', 'closing', 'refresh', 'scores', 'props'];
}

/** The Odds API cost: markets × regions; historical endpoints cost 10×. Scores with daysFrom: 2. */
export function oddsApiCost(markets: number, regions: number, historical = false): number {
  return markets * regions * (historical ? 10 : 1);
}

export interface SlateEvent { id: string; league: string; sport: string; commence: string; hasPregame: boolean; hasClosing: boolean }

export interface PlannedPull { kind: PullKind; league: string; sport: string; eventIds: string[]; priority: number }

/** Window (minutes before start) for the pre-game snapshot picks are logged against. */
export const PREGAME_WINDOW = { from: 60, to: 90 };
/** Closing snapshot: from 25 min before start up to 10 min after (cron jitter). */
export const CLOSING_WINDOW = { from: -10, to: 25 };

/**
 * Decide this tick's pulls. One provider call covers every event in a league, so events in the
 * same window are grouped per league.
 */
export function planTick(
  events: SlateEvent[],
  nowIso: string,
  opts: { lastRefresh: Record<string, string | undefined>; sportWeight: Record<string, number>; refreshHours: number },
): PlannedPull[] {
  const now = Date.parse(nowIso);
  const byLeague = new Map<string, SlateEvent[]>();
  for (const e of events) { const l = byLeague.get(e.league); if (l) l.push(e); else byLeague.set(e.league, [e]); }
  const out: PlannedPull[] = [];
  for (const [league, evs] of byLeague) {
    const mins = (e: SlateEvent) => (Date.parse(e.commence) - now) / 60000;
    const sport = evs[0].sport;
    // A pre-game pull is due if an event is inside the window, or has slipped past its window start
    // without a snapshot (cron was late) but hasn't started yet.
    const pre = evs.filter((e) => !e.hasPregame && mins(e) <= PREGAME_WINDOW.to && mins(e) > CLOSING_WINDOW.to);
    if (pre.length) out.push({ kind: 'pregame', league, sport, eventIds: pre.map((e) => e.id), priority: 100 + pre.length });
    const close = evs.filter((e) => !e.hasClosing && mins(e) <= CLOSING_WINDOW.to && mins(e) >= CLOSING_WINDOW.from);
    if (close.length) out.push({ kind: 'closing', league, sport, eventIds: close.map((e) => e.id), priority: 90 + close.length });
    const upcoming = evs.filter((e) => mins(e) > PREGAME_WINDOW.to && mins(e) < 36 * 60);
    const last = opts.lastRefresh[league];
    const w = opts.sportWeight[sport] ?? 1;
    // Bigger slates refresh more often: interval shrinks with weight × games.
    const interval = opts.refreshHours / Math.max(1, Math.sqrt(w * upcoming.length / 4));
    if (upcoming.length && (!last || now - Date.parse(last) > interval * 3600000)) {
      out.push({ kind: 'refresh', league, sport, eventIds: upcoming.map((e) => e.id), priority: w * upcoming.length });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** Whether a pull of `cost` units of `kind` fits the provider's remaining quota. */
export function canSpend(u: UsageState, kind: PullKind, cost: number): boolean {
  const mode = budgetMode(u);
  if (!allowedKinds(mode).includes(kind)) return false;
  // Never let a refresh push usage into the conserve band; keep the last 20% for pre-game/closing.
  if (kind === 'refresh' || kind === 'props') return u.used + cost <= 0.8 * u.limit;
  return u.used + cost <= u.limit;
}

export interface Projection {
  provider: ProviderId;
  period: 'day' | 'month';
  limit: number;
  usedSoFar: number;
  projectedPeriodTotal: number;
  /** Projected monthly use (for daily quotas: max day × 30 is not meaningful, so this is per day). */
  withinQuota: boolean;
}

/**
 * Project end-of-period usage from history: average per-day usage over the recent days, times the
 * days in the period. For a monthly quota, adds today's run-rate to what's already spent.
 */
export function projectUsage(provider: ProviderId, quota: Quota, dailyHistory: number[], usedSoFar: number, dayOfPeriod: number, daysInPeriod: number): Projection {
  const recent = dailyHistory.slice(-14);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const projected = quota.period === 'day' ? Math.max(avg, usedSoFar) : usedSoFar + avg * Math.max(0, daysInPeriod - dayOfPeriod);
  return { provider, period: quota.period, limit: quota.limit, usedSoFar, projectedPeriodTotal: Math.round(projected), withinQuota: projected <= quota.limit };
}

/**
 * Static estimate of a typical month (used before there is history): pulls per day per sport.
 * `slates` = average distinct start-time windows per day per league.
 */
export function estimateMonthly(perLeagueWindowsPerDay: Record<string, number>, costPerPull: number, refreshPerDay: number): number {
  let perDay = 0;
  for (const w of Object.values(perLeagueWindowsPerDay)) perDay += (2 * w + refreshPerDay) * costPerPull;
  return Math.round(perDay * 30);
}
