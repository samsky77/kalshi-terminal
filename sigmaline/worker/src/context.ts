import { budgetMode, canSpend, DROP_REASONS, type DropReason, type ProviderId, type PullKind, type UsageState } from '@sigmaline/core';
import { addUsage, getSettings, periodUsage, type AppSettings, type Db } from '@sigmaline/db';
import { FixtureProvider } from './providers/fixtures';
import { OddsApiProvider } from './providers/oddsapi';
import { PropLineProvider } from './providers/propline';
import { SharpApiProvider } from './providers/sharpapi';
import type { DataProvider } from './providers/types';

export interface Env {
  ODDS_API_KEY?: string;
  PROPLINE_API_KEY?: string;
  SHARPAPI_KEY?: string;
  SHARPAPI_ENABLED?: string;
  PROPS_NBA_ENABLED?: string;
  PROPS_NFL_ENABLED?: string;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_ERROR_WEBHOOK_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APP_URL?: string;
  DEMO?: string;
  WRITEUP_PROVIDER?: string;
  [k: string]: string | undefined;
}

export interface Ctx {
  db: Db;
  env: Env;
  settings: AppSettings;
  providers: Record<ProviderId, DataProvider>;
  now: () => Date;
  log: (msg: string, extra?: unknown) => void;
  /** In-memory usage cache for this run (persisted to provider_usage as calls happen). */
  usage: Map<ProviderId, UsageState>;
  /** Usage so far today (UTC) per provider, for pacing monthly quotas. */
  usedToday: Map<ProviderId, number>;
  demo: boolean;
  /** Feed-filter counts accumulated over this run (item 8), written once to feed_filter_log. */
  feedStats: { rowsIn: number; rowsKept: number; counts: Record<DropReason, number> };
}

export async function makeCtx(db: Db, env: Env, opts: { now?: () => Date; fixturesDir?: string; fixtureShiftMs?: number } = {}): Promise<Ctx> {
  const settings = await getSettings(db);
  const demo = env.DEMO === '1';
  const providers: Record<ProviderId, DataProvider> = demo
    ? {
        oddsapi: new FixtureProvider(opts.fixturesDir!, opts.fixtureShiftMs ?? 0),
        propline: new PropLineProvider(undefined),
        sharpapi: new SharpApiProvider(undefined, false),
      }
    : {
        oddsapi: new OddsApiProvider(env.ODDS_API_KEY),
        propline: new PropLineProvider(env.PROPLINE_API_KEY),
        sharpapi: new SharpApiProvider(env.SHARPAPI_KEY, env.SHARPAPI_ENABLED === 'true'),
      };
  const usage = new Map<ProviderId, UsageState>();
  const usedToday = new Map<ProviderId, number>();
  for (const p of ['oddsapi', 'propline', 'sharpapi'] as ProviderId[]) {
    const q = settings.quotas[p] ?? { period: 'day', limit: 0 };
    usage.set(p, { provider: p, period: q.period, limit: q.limit, used: await periodUsage(db, p, q.period), periodStart: '' });
    usedToday.set(p, await periodUsage(db, p, 'day'));
  }
  return { db, env, settings, providers, now: opts.now ?? (() => new Date()), log: (m, x) => console.log(`[${new Date().toISOString()}] ${m}`, x ?? ''), usage, usedToday, demo,
    feedStats: { rowsIn: 0, rowsKept: 0, counts: Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number> } };
}

/** Ask the budgeter whether `provider` may spend `cost` on a `kind` pull right now. */
export function mayPull(ctx: Ctx, provider: ProviderId, kind: PullKind, cost: number): boolean {
  const p = ctx.providers[provider];
  if (!p.enabled) return false;
  if (ctx.demo) return true;
  const u = ctx.usage.get(provider)!;
  if (!canSpend(u, kind, cost)) return false;
  if (u.period === 'month') {
    // Pace a monthly quota: today may use its fair share of what is left (with 50% slack).
    const now = ctx.now();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeft = daysInMonth - now.getUTCDate() + 1;
    const today = ctx.usedToday.get(provider) ?? 0;
    const share = (u.limit - (u.used - today)) / daysLeft;
    if (today + cost > share * 1.5) return false;
  }
  return true;
}

export async function recordUsage(ctx: Ctx, provider: ProviderId, cost: number, remaining?: number): Promise<void> {
  const u = ctx.usage.get(provider)!;
  u.used += cost;
  ctx.usedToday.set(provider, (ctx.usedToday.get(provider) ?? 0) + cost);
  // Trust the provider's own counter when it reports one (monthly Odds API credits).
  if (remaining !== undefined && u.period === 'month') u.used = Math.max(u.used, u.limit - remaining);
  if (!ctx.demo && cost > 0) await addUsage(ctx.db, provider, cost, remaining);
}

/** True when a provider error means its quota is spent (The Odds API answers 401 OUT_OF_USAGE_CREDITS). */
export function isQuotaError(err: unknown): boolean {
  return /OUT_OF_USAGE_CREDITS|usage quota has been reached|HTTP 429/i.test((err as Error)?.message ?? String(err));
}

/**
 * Call from a provider catch block. If the provider says its quota is gone, mark it exhausted for the rest
 * of this run so the tick stops re-sending doomed requests (and logging a 401 for every league).
 */
export function noteProviderError(ctx: Ctx, provider: ProviderId, err: unknown): boolean {
  if (!isQuotaError(err)) return false;
  const u = ctx.usage.get(provider);
  if (u && u.used < u.limit) {
    u.used = u.limit;
    ctx.log(`${provider} quota exhausted (provider said so): skipping it for the rest of this run`);
  }
  return true;
}

export function modeOf(ctx: Ctx, provider: ProviderId) {
  return budgetMode(ctx.usage.get(provider)!);
}
