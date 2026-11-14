import { describe, expect, it } from 'vitest';
import { buildPicks, summarize, unsettledTickers, type SnapRecord } from '@/core/backtest';

const start = '2026-11-15T00:00:00Z';
const rec = (savedAt: string, ye: number | null, ya = 0.5): SnapRecord => ({
  sport: 'nba', savedAt,
  games: [{ gameId: 'g', title: 'A @ B', startTime: start, contracts: [{ t: 'KX-1', k: 'winner', tier: 'A', p: 0.6, ya, na: 0.45, ys: 10, ns: 10, ye, ne: 0.01 }] }],
});

describe('backtest', () => {
  it('keeps the last pre-start value snapshot and ignores hindsight and small edges', () => {
    const picks = buildPicks([rec('2026-11-14T15:00:00Z', 0.05), rec('2026-11-14T20:00:00Z', 0.07, 0.52), rec('2026-11-15T00:30:00Z', 0.2, 0.2)]);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ side: 'yes', ask: 0.52, edge: 0.07 });
    expect(picks[0].fee).toBeCloseTo(0.6 - 0.52 - 0.07, 6);
  });
  it('grades at ask plus fee and counts pending', () => {
    const picks = buildPicks([rec('2026-11-14T15:00:00Z', 0.05)]);
    const win = summarize(picks, { 'KX-1': 'yes' });
    expect(win.total.n).toBe(1);
    expect(win.total.pnl).toBeCloseTo(1 - 0.5 - 0.05, 6);
    const loss = summarize(picks, { 'KX-1': 'no' });
    expect(loss.total.pnl).toBeCloseTo(-0.55, 6);
    expect(summarize(picks, {}).pending).toBe(1);
  });
  it('only asks to settle games that should be over', () => {
    const picks = buildPicks([rec('2026-11-14T15:00:00Z', 0.05)]);
    expect(unsettledTickers(picks, {}, Date.parse('2026-11-15T01:00:00Z'))).toEqual([]);
    expect(unsettledTickers(picks, {}, Date.parse('2026-11-15T04:00:00Z'))).toEqual(['KX-1']);
  });
});
