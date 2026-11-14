import { describe, expect, it } from 'vitest';
import { americanStrToDecimal, eventFromEspn } from '@/server/espn';

const ev = {
  id: '401909298', date: '2026-11-14T00:00Z', status: { type: { state: 'pre' } },
  competitions: [{
    competitors: [{ homeAway: 'home', team: { displayName: 'Miami Heat' } }, { homeAway: 'away', team: { displayName: 'Cleveland Cavaliers' } }],
    odds: [{ provider: { displayName: 'DraftKings' },
      moneyline: { home: { close: { odds: '-142' } }, away: { close: { odds: '+120' } } },
      pointSpread: { home: { close: { line: '-2.5', odds: '-108' } }, away: { close: { line: '+2.5', odds: '-112' } } },
      total: { over: { close: { line: 'o234.5', odds: '-114' } }, under: { close: { line: 'u234.5', odds: '-106' } } } }],
  }],
};

describe('espn odds mapping', () => {
  it('converts american odds', () => {
    expect(americanStrToDecimal('+120')).toBeCloseTo(2.2);
    expect(americanStrToDecimal('-142')).toBeCloseTo(1.704, 3);
    expect(americanStrToDecimal('EVEN')).toBe(2);
    expect(americanStrToDecimal(undefined)).toBeNaN();
  });
  it('maps a pregame event to the Odds API shape', () => {
    const o = eventFromEspn(ev, 'basketball_nba', '2026-11-14T12:00:00Z')!;
    expect(o.home_team).toBe('Miami Heat');
    expect(o.commence_time).toBe('2026-11-14T00:00:00Z');
    const m = Object.fromEntries(o.bookmakers[0].markets.map((x) => [x.key, x]));
    expect(m.spreads.outcomes.find((x) => x.name === 'Miami Heat')!.point).toBe(-2.5);
    expect(m.totals.outcomes[0].point).toBe(234.5);
    expect(m.h2h.outcomes).toHaveLength(2);
  });
  it('skips started games and games without odds', () => {
    expect(eventFromEspn({ ...ev, status: { type: { state: 'in' } } }, 'basketball_nba', 'x')).toBeNull();
    expect(eventFromEspn({ ...ev, competitions: [{ ...ev.competitions[0], odds: [] }] }, 'basketball_nba', 'x')).toBeNull();
  });
});
