import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH, pickHash, verifyChain, planTick, budgetMode, canSpend, retuneW, brier, logLoss, calibrationBuckets,
  buildWriteup, alertText, inQuietHours, fitPointsRatings, predictPoints, fitGoalsRatings, predictGoals,
} from '../src';

async function chain(n: number) {
  const rows: Record<string, unknown>[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const r: Record<string, unknown> = {
      id: `p${i}`, created_at: new Date(Date.UTC(2026, 10, 17, 12, i)).toISOString(), sport: 'nba', league: 'nba', event_id: `e${i}`,
      event_name: 'A @ B', commence_time: '2026-11-18T00:00:00.000Z', market: 'spread', selection: 'spread:home:-2.5::', line: -2.5,
      book: 'draftkings', price_decimal: 1.91, fair_decimal: 1.8, ev: 0.061, grade: 'A', model_version: 'v1', stake_units: 2, seq: i,
    };
    r.prev_hash = prev;
    r.hash = await pickHash(prev, r);
    prev = r.hash as string;
    rows.push(r);
  }
  return rows;
}

describe('hash chain', () => {
  it('verifies an intact chain, including Postgres-style strings', async () => {
    const rows = await chain(5);
    expect((await verifyChain(rows)).ok).toBe(true);
    // Postgres returns numerics as strings and timestamps as "+00:00"
    const pg = rows.map((r) => ({ ...r, price_decimal: String(r.price_decimal), seq: String(r.seq), created_at: (r.created_at as string).replace('.000Z', '+00:00') }));
    expect((await verifyChain(pg)).ok).toBe(true);
  });
  it('detects an edited price', async () => {
    const rows = await chain(5);
    rows[2].price_decimal = 2.05;
    const c = await verifyChain(rows);
    expect(c.ok).toBe(false);
    expect(c.brokenAt).toBe(3);
  });
  it('sealed rows keep the link but hide contents', async () => {
    const rows = await chain(4);
    const pub = rows.map((r, i) => (i === 2 ? { seq: r.seq, prev_hash: r.prev_hash, hash: r.hash, sealed: true } : r));
    const c = await verifyChain(pub);
    expect(c.ok).toBe(true);
    expect(c.sealed).toBe(1);
    // altering a sealed row's hash breaks the next row's link
    pub[2] = { ...pub[2], hash: 'f'.repeat(64) };
    expect((await verifyChain(pub)).ok).toBe(false);
  });
  it('detects a deleted row', async () => {
    const rows = await chain(5);
    rows.splice(1, 1);
    expect((await verifyChain(rows)).ok).toBe(false);
  });
});

describe('budgeter', () => {
  it('modes at 80% and 100%', () => {
    expect(budgetMode({ used: 399, limit: 500 })).toBe('normal');
    expect(budgetMode({ used: 400, limit: 500 })).toBe('conserve');
    expect(budgetMode({ used: 500, limit: 500 })).toBe('exhausted');
    const u = { provider: 'oddsapi' as const, used: 410, limit: 500, period: 'month' as const, periodStart: '' };
    expect(canSpend(u, 'refresh', 3)).toBe(false);
    expect(canSpend(u, 'pregame', 3)).toBe(true);
    expect(canSpend({ ...u, used: 499 }, 'closing', 3)).toBe(false);
    expect(canSpend({ ...u, used: 100 }, 'refresh', 3)).toBe(true);
  });
  it('plans pre-game (60-90 min) and closing pulls per league', () => {
    const now = '2026-11-17T22:00:00Z';
    const at = (m: number) => new Date(Date.parse(now) + m * 60000).toISOString();
    const plan = planTick([
      { id: 'a', league: 'nba', sport: 'nba', commence: at(75), hasPregame: false, hasClosing: false },
      { id: 'b', league: 'nba', sport: 'nba', commence: at(80), hasPregame: false, hasClosing: false },
      { id: 'c', league: 'nba', sport: 'nba', commence: at(10), hasPregame: true, hasClosing: false },
      { id: 'd', league: 'nhl', sport: 'nhl', commence: at(200), hasPregame: false, hasClosing: false },
      { id: 'e', league: 'nhl', sport: 'nhl', commence: at(120), hasPregame: false, hasClosing: false },
    ], now, { lastRefresh: { nhl: at(-30) }, sportWeight: { nba: 3, nhl: 2 }, refreshHours: 6 });
    const pre = plan.find((p) => p.kind === 'pregame')!;
    expect(pre.eventIds.sort()).toEqual(['a', 'b']);
    expect(plan.find((p) => p.kind === 'closing')!.eventIds).toEqual(['c']);
    expect(plan.some((p) => p.kind === 'pregame' && p.league === 'nhl')).toBe(false);
    expect(plan.some((p) => p.kind === 'refresh' && p.league === 'nhl')).toBe(false); // refreshed 30 min ago
  });
});

describe('calibration', () => {
  it('scores', () => {
    const xs = [{ p: 0.7, y: 1 as const }, { p: 0.4, y: 0 as const }];
    expect(brier(xs)).toBeCloseTo((0.09 + 0.16) / 2, 12);
    expect(logLoss(xs)).toBeCloseTo(-(Math.log(0.7) + Math.log(0.6)) / 2, 12);
    expect(calibrationBuckets(xs)).toHaveLength(10);
  });
  it('retunes w by at most 0.05 and only on held-out improvement', () => {
    // outcomes follow the model -> more weight on the model helps
    const obs = Array.from({ length: 400 }, (_, i) => {
      const pModel = (i % 10) / 10 + 0.05;
      return { pModel, pConsensus: 0.5, y: (((i * 7919) % 100) / 100 < pModel ? 1 : 0) as 0 | 1, date: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString() };
    });
    const r = retuneW(obs, 0.35);
    expect(Math.abs(r.w - 0.35)).toBeLessThanOrEqual(0.05 + 1e-12);
    expect(r.w).toBeCloseTo(0.4, 12);
    expect(r.changed).toBe(true);
    expect(retuneW(obs.slice(0, 20), 0.35).changed).toBe(false); // too few observations
  });
});

describe('ratings', () => {
  it('opponent-adjusted points ratings recover a strong team', () => {
    const games = [] as { date: string; home: string; away: string; homeScore: number; awayScore: number }[];
    const teams = ['A', 'B', 'C', 'D'];
    const str: Record<string, number> = { A: 8, B: 0, C: -3, D: -5 };
    let d = 0;
    for (let r = 0; r < 6; r++) for (const h of teams) for (const a of teams) if (h !== a) {
      d++;
      games.push({ date: new Date(Date.UTC(2026, 9, 1) + d * 3600000).toISOString(), home: h, away: a, homeScore: 110 + str[h] / 2 + 1.5, awayScore: 110 + str[a] / 2 - 1.5 - str[h] / 2 + str[a] / 2 - str[a] / 2 });
    }
    const r = fitPointsRatings(games, { asOf: '2026-12-01T00:00:00Z', halfLifeDays: 60, ridge: 0.5, hfaPrior: 2 });
    const ab = predictPoints(r, 'A', 'D'), da = predictPoints(r, 'D', 'A');
    expect(ab.home - ab.away).toBeGreaterThan(da.home - da.away);
    expect(r.hfa).toBeGreaterThan(1);
  });
  it('goals ratings', () => {
    const games = [] as { date: string; home: string; away: string; homeScore: number; awayScore: number }[];
    for (let i = 0; i < 60; i++) {
      games.push({ date: new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString(), home: i % 2 ? 'X' : 'Y', away: i % 2 ? 'Y' : 'X', homeScore: i % 2 ? 3 : 1, awayScore: i % 2 ? 1 : 2 });
    }
    const r = fitGoalsRatings(games, { asOf: '2026-12-01T00:00:00Z', halfLifeDays: 365, ridge: 1, hfaPrior: 0.1 });
    const p = predictGoals(r, 'X', 'Y');
    expect(p.home).toBeGreaterThan(p.away);
  });
});

describe('write-ups and alerts', () => {
  it('uses only provided facts and includes edge, reasons and risk', () => {
    const w = buildWriteup({
      sport: 'nba', home: 'Boston Celtics', away: 'New York Knicks', team: 'New York Knicks', opponent: 'Boston Celtics',
      selection: { market: 'spread', side: 'away', line: 2.5 }, selectionLabel: 'New York Knicks +2.5', bestDecimal: 1.909, book: 'draftkings',
      modelP: 0.58, consensusP: 0.52, fairP: 0.55, ev: 0.05, booksChecked: 6, modelMargin: 0.6, restDays: { home: 0, away: 2 },
    });
    expect(w.edge).toMatch(/coin flip/);
    expect(w.reasons.length).toBeGreaterThanOrEqual(1);
    expect(w.reasons.length).toBeLessThanOrEqual(3);
    expect(w.reasons.join(' ')).toMatch(/back-to-back/);
    expect(w.risk).toMatch(/^Risk:/);
    // no injuries were provided -> no injury sentence
    expect(w.reasons.join(' ')).not.toMatch(/without/);
  });
  it('alert text format', () => {
    expect(alertText({ grade: 'A', label: 'NYK +2.5', decimal: 1 + 100 / 110, ev: 0.075, commence: '2026-11-18T00:00:00Z' })).toBe('A · NYK +2.5 (−110) · EV +7.5% · 7:00 PM');
  });
  it('quiet hours wrap midnight', () => {
    expect(inQuietHours('2026-11-18T04:00:00Z', '22:00', '08:00')).toBe(true); // 11pm ET
    expect(inQuietHours('2026-11-17T17:00:00Z', '22:00', '08:00')).toBe(false); // noon ET
  });
});

describe('write-ups never claim a model that did not run', () => {
  it('omits the ratings sentence on market-only games and uses book display names', () => {
    const base = {
      sport: 'nba' as const, home: 'Houston Rockets', away: 'Utah Jazz', team: 'Utah Jazz', opponent: 'Houston Rockets',
      selection: { market: 'ml' as const, side: 'away' as const }, selectionLabel: 'Utah Jazz ML', bestDecimal: 7, book: 'betmgm',
      modelP: 0.26, consensusP: 0.18, fairP: 0.18, ev: 0.24, booksChecked: 6,
    };
    const w = buildWriteup(base);
    expect(w.reasons.join(' ')).not.toMatch(/ratings/);
    expect(w.reasons.join(' ')).toMatch(/BetMGM/);
    expect(buildWriteup({ ...base, modelIndependent: true }).reasons.join(' ')).toMatch(/ratings alone/);
  });
});
