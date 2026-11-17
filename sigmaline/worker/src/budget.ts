import { budgetMode, estimateMonthly, projectUsage, SPORT_DEFS, type ProviderId, type Quota } from '@sigmaline/core';
import { usageRows } from '@sigmaline/db';
import type { Ctx } from './context';

/**
 * Typical slate: distinct pre-game windows per day per league (game-time clusters), averaged over a
 * season week. Used for the static month projection before there is usage history.
 */
export const TYPICAL_WINDOWS_PER_DAY: Record<string, number> = {
  nba: 2.5, nhl: 2.5, ncaab: 3, nfl: 0.5, ncaaf: 0.9, epl: 0.8, laliga: 0.8, seriea: 0.8, bundesliga: 0.7, ligue1: 0.7, mls: 0.6, ucl: 0.4, tennis: 3,
};

export interface BudgetReport {
  providers: { provider: ProviderId; period: string; limit: number; used: number; mode: string; projected: number; withinQuota: boolean; history: { day: string; used: number }[] }[];
  staticEstimate: { oddsapiCreditsPerMonthIfPrimary: number; proplineRequestsPerDay: number; note: string };
}

export async function budgetReport(ctx: Ctx): Promise<BudgetReport> {
  const now = ctx.now();
  const since = new Date(now.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const rows = await usageRows(ctx.db, since);
  const out: BudgetReport['providers'] = [];
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  for (const p of ['oddsapi', 'propline', 'sharpapi'] as ProviderId[]) {
    const q = ctx.settings.quotas[p];
    const u = ctx.usage.get(p)!;
    const hist = rows.filter((r) => r.provider === p).map((r) => ({ day: String(r.day).slice(0, 10), used: Number(r.used) }));
    const proj = projectUsage(p, { provider: p, period: q.period, limit: q.limit } as Quota, hist.map((h) => h.used), u.used, q.period === 'month' ? dayOfMonth : 1, q.period === 'month' ? daysInMonth : 1);
    out.push({ provider: p, period: q.period, limit: q.limit, used: u.used, mode: budgetMode(u), projected: proj.projectedPeriodTotal, withinQuota: proj.withinQuota, history: hist });
  }
  // Static plan: PropLine carries refreshes; The Odds API only takes pre-game + closing pulls, and the
  // budgeter's 80% rule stops refreshes there. Pre-game+closing for every window at 3 credits each:
  const oddsapi = estimateMonthly(TYPICAL_WINDOWS_PER_DAY, 3, 0);
  const leagues = Object.values(SPORT_DEFS).flatMap((s) => s.leagues).length;
  const proplinePerDay = Math.round(Object.values(TYPICAL_WINDOWS_PER_DAY).reduce((a, w) => a + 2 * w, 0) + leagues * (24 / ctx.settings.refreshHours) + 5 * 3 + 60);
  return {
    providers: out,
    staticEstimate: {
      oddsapiCreditsPerMonthIfPrimary: oddsapi,
      proplineRequestsPerDay: proplinePerDay,
      note: `Pre-game + closing for every window would need ~${oddsapi} Odds API credits/month (quota 500), so the budgeter ranks pulls and stops refreshes at 80%. PropLine (1,000/day) carries refreshes: ~${proplinePerDay}/day projected incl. scores, injuries and ~60 prop/player-log calls.`,
    },
  };
}
