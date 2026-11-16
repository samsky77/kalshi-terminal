// Regression tests for the wave 1 QA fixes.
import { describe, expect, it } from 'vitest';
import { markSuspectQuotes } from '../src/core/edge';
import { nameScore } from '../src/core/matcher';
import { unsettledTickers, type Pick } from '../src/core/backtest';
import { runPipeline, valueRows } from '../src/core/pipeline';
import type { PricedContract } from '../src/core/types';
import { eventFromComp, num } from '../src/server/espn';
import { edgeC, signClass, when } from '../src/ui/format';
import { kalshiFixture, oddsFixture } from './helpers';

describe('ESPN blank lines', () => {
  it('reads a missing or blank line as NaN, never 0', () => {
    expect(num(undefined)).toBeNaN();
    expect(num('')).toBeNaN();
    expect(num('  ')).toBeNaN();
    expect(num('o45.5')).toBe(45.5);
    expect(num('-3.5')).toBe(-3.5);
    expect(num('PK')).toBe(0);
  });
  it('drops spread and total markets whose line is blank', () => {
    const comp = {
      competitors: [{ homeAway: 'home', team: { displayName: 'Boston Celtics' } }, { homeAway: 'away', team: { displayName: 'Los Angeles Lakers' } }],
      odds: [{
        moneyline: { home: { close: { odds: '-150' } }, away: { close: { odds: '+130' } } },
        pointSpread: { home: { close: { odds: '-110', line: '' } }, away: { close: { odds: '-110' } } },
        total: { over: { close: { odds: '-110', line: '' } }, under: { close: { odds: '-110' } } },
      }],
    };
    const ev = eventFromComp('1', '2026-11-14T00:00Z', 'pre', comp, 'basketball_nba', '2026-11-13T00:00:00Z')!;
    expect(ev.bookmakers[0].markets.map((m) => m.key)).toEqual(['h2h']);
  });
});

describe('matcher look-alike guards', () => {
  const zero: [string, string, 'ncaab' | 'soccer' | 'tennis'][] = [
    ['Texas', 'Texas A&M Aggies', 'ncaab'], ['Michigan', 'Michigan State Spartans', 'ncaab'], ['Texas A&M', 'Texas A&M-CC Islanders', 'ncaab'],
    ['Real Madrid', 'Real Sociedad', 'soccer'], ['Arsenal', 'Arsenal Women', 'soccer'], ['Real Madrid', 'Real Madrid Castilla', 'soccer'],
    ['Anna Kalinskaya', 'Anna Blinkova', 'tennis'], ['Alexander Zverev', 'Mischa Zverev', 'tennis'],
  ];
  for (const [k, o, s] of zero) it(`${k} is not ${o}`, () => expect(nameScore(k, o, s)).toBe(0));
  it('still matches the real team', () => {
    expect(nameScore('Florida', 'Florida Gators', 'ncaab')).toBeGreaterThan(0);
    expect(nameScore('Ohio St.', 'Ohio State Buckeyes', 'ncaab')).toBeGreaterThan(0);
    expect(nameScore('Leeds', 'Leeds United', 'soccer')).toBeGreaterThan(0);
    expect(nameScore('Sam Houston', 'Sam Houston State Bearkats', 'ncaaf')).toBe(2);
    expect(nameScore('Alcaraz', 'Carlos Alcaraz', 'tennis')).toBeGreaterThan(0);
  });
});

describe('suspect quotes', () => {
  const mk = (strike: number, yesAsk: number | null, noAsk: number | null): PricedContract => ({
    contract: { ticker: `T-${strike}`, eventTicker: 'E', seriesTicker: 'S', kind: 'total', strikeType: 'greater', floorStrike: strike } as PricedContract['contract'],
    description: `Total >${strike}`, strikeDisplay: `O${strike}`, tier: 'B', probYes: 0.5,
    yes: { side: 'yes', prob: 0.5, ask: yesAsk, size: 10, fee: 0.02, edge: 0.05, value: true },
    no: { side: 'no', prob: 0.5, ask: noAsk, size: 10, fee: 0.02, edge: 0.05, value: true },
  });
  it('unflags a No quote that locks against a lower strike (the Air Force @ Pacific case)', () => {
    const rows = [mk(161.5, 0.72, 0.62), mk(163.5, 0.74, 0.28), mk(165.5, 0.5, 0.58)];
    markSuspectQuotes(rows);
    expect(rows[1].no.suspect).toBe(true);
    expect(rows[1].no.value).toBe(false);
    expect(rows[0].yes.suspect).toBe(true);
    expect(rows[2].yes.suspect).toBeUndefined();
    expect(rows[2].yes.value).toBe(true);
  });
  it('leaves a consistent ladder alone', () => {
    const rows = [mk(40.5, 0.6, 0.42), mk(43.5, 0.5, 0.52), mk(46.5, 0.4, 0.62)];
    markSuspectQuotes(rows);
    expect(rows.every((r) => !r.yes.suspect && !r.no.suspect)).toBe(true);
  });
});

describe('pipeline horizon and value rows', () => {
  const snap = kalshiFixture('nfl');
  const odds = oddsFixture('nfl').batches;
  const now = new Date(snap.fetchedAt);
  const out = runPipeline({ sport: 'nfl', games: snap.games, odds, now, runs: 2000, horizonHours: 72 });
  it('does not simulate games beyond the horizon', () => {
    for (const g of out.games) {
      const far = Date.parse(g.game.startTime) - now.getTime() > 72 * 3600e3;
      if (far) { expect(g.status).toBe('unpriced'); expect(g.unpricedReason).toMatch(/priced closer to game time/); }
    }
    expect(out.games.some((g) => g.status === 'priced')).toBe(true);
  });
  it('never lists a game that has started by "now", and gives every row a plain label', () => {
    const rows = valueRows(out.games);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.plain).not.toMatch(/^NOT /);
    const later = Math.max(...out.games.filter((g) => g.status === 'priced').map((g) => Date.parse(g.game.startTime))) + 1;
    expect(valueRows(out.games, later)).toHaveLength(0);
  });
});

describe('backtest ordering', () => {
  it('asks for the newest unsettled games first and gives up after 10 days', () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const p = (ticker: string, startTime: string) => ({ ticker, startTime } as Pick);
    const out = unsettledTickers([p('OLD', '2026-11-01T00:00:00Z'), p('A', '2026-11-15T00:00:00Z'), p('B', '2026-11-18T00:00:00Z'), p('FUTURE', '2026-11-21T00:00:00Z')], {}, now);
    expect(out).toEqual(['B', 'A']);
  });
});

describe('formatting', () => {
  it('never prints +2.0 for an edge under 2 cents, or -0.0', () => {
    expect(edgeC(0.01996)).toBe('+1.9');
    expect(edgeC(0.02)).toBe('+2.0');
    expect(edgeC(-0.0003)).toBe('0.0');
    expect(edgeC(0.0003)).toBe('0.0');
    expect(edgeC(-0.031)).toBe('-3.1');
    expect(signClass(0)).toBe('mute');
  });
  it('shows the date with the weekday', () => {
    expect(when('2026-11-22T18:00:00Z')).toMatch(/Nov 22/);
    expect(when('1970-01-01T00:00:00Z')).toBe('time TBD');
  });
});

describe('worker sim cache (wave 2 blocker)', () => {
  it('survives a second run of the same sport and reuses simulations', async () => {
    const { seedCache, pruneCache } = await import('../src/worker/trackingCache');
    const snap = kalshiFixture('nfl');
    const odds = oddsFixture('nfl').batches;
    const now = new Date(oddsFixture('nfl').recordedAt);
    const run = (prev?: Map<string, any>) => {
      const cache = seedCache(prev);
      const out = runPipeline({ sport: 'nfl', games: snap.games, odds, now, runs: 500, horizonHours: 168, simCache: cache });
      return { out, kept: pruneCache(cache), cache };
    };
    const first = run();
    expect(first.kept.size).toBeGreaterThan(0);
    const second = run(first.kept);
    expect(second.kept.size).toBe(first.kept.size);
    expect(second.out.games.length).toBe(first.out.games.length);
    const third = run(second.kept);
    expect(third.kept.size).toBe(first.kept.size);
  });
  it('drops entries the latest run did not use', async () => {
    const { seedCache, pruneCache } = await import('../src/worker/trackingCache');
    const stale = new Map<string, any>([['gone', { p: 1 }]]);
    const cache = seedCache(stale);
    expect(cache.used.size).toBe(0);
    expect(pruneCache(cache).size).toBe(0);
  });
});

describe('soccer spread labels (wave 2)', () => {
  it('keeps the distinctive club name instead of a bare suffix', async () => {
    const { describe: desc } = await import('../src/core/edge');
    const mk = (code: string) => ({ kind: 'spread', code, floorStrike: 2.5 }) as any;
    const names: Record<string, string> = { A: 'Manchester City FC', B: 'Real Madrid CF', C: 'New England Patriots', D: 'Rosario' };
    const t = (c?: string) => names[c ?? ''] ?? '';
    expect(desc(mk('A'), t).description).toBe('Manchester City by >2.5');
    expect(desc(mk('B'), t).description).toBe('Real Madrid by >2.5');
    expect(desc(mk('C'), t).description).toBe('Patriots by >2.5');
    expect(desc(mk('D'), t).description).toBe('Rosario by >2.5');
  });
});

describe('one-shot fixes (wave 3)', () => {
  it('derives a win probability from the spread when no book lists a moneyline', async () => {
    const { buildConsensus } = await import('../src/core/odds');
    const ev: any = { id: 'x', home_team: 'H', away_team: 'A', bookmakers: [1, 2].map((i) => ({ key: `b${i}`, last_update: '2026-11-14T00:00:00Z', markets: [{ key: 'spreads', outcomes: [{ name: 'H', price: 1.91, point: -6.5 }, { name: 'A', price: 1.91, point: 6.5 }] }] })) };
    expect(buildConsensus(ev, false)).toBeNull();
    const c = buildConsensus(ev, false, 11)!;
    expect(c.mlDerived).toBe(true);
    expect(c.pHome).toBeGreaterThan(0.68);
    expect(c.pHome).toBeLessThan(0.76);
  });
  it('edge and size formatting', () => {
    expect(edgeC(0.0199999999)).toBe('+2.0');
    expect(edgeC(0.01996)).toBe('+1.9');
    expect(edgeC(-0.01996)).toBe('-1.9');
  });
  it('same tennis player with an extra name part still matches; different first names do not', () => {
    expect(nameScore('Felix Auger Aliassime', 'Felix Auger Aliassime Jr', 'tennis')).toBeGreaterThan(0);
    expect(nameScore('Alexander Zverev', 'Mischa Zverev', 'tennis')).toBe(0);
    expect(nameScore('Michigan', 'Michigan State Spartans', 'ncaaf')).toBe(0);
  });
});
