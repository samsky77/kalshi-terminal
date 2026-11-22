import { describe, expect, it } from 'vitest';
import { outcomeSides, quotesFromEvent, type OddsApiEvent } from '../src/oddsformat';

describe('team-name matching in odds ingest', () => {
  it('maps spelling variants to the right side', () => {
    const r = outcomeSides([{ name: 'Atalanta BC' }, { name: 'Inter Milan' }, { name: 'Draw' }], 'Atalanta', 'Inter');
    expect(r).toEqual(['home', 'away', 'draw']);
  });
  it('uses elimination when one name is unrecognisable', () => {
    expect(outcomeSides([{ name: 'Internazionale' }, { name: 'Atalanta' }, { name: 'Draw' }], 'Atalanta', 'FC Inter Milano')).toEqual(['away', 'home', 'draw']);
  });
  it('never maps two outcomes to one side', () => {
    const r = outcomeSides([{ name: 'Manchester' }, { name: 'Manchester' }], 'Manchester City', 'Manchester United');
    expect(r.filter((x) => x === 'home').length).toBeLessThanOrEqual(1);
  });
  it('keeps all three sides of a quote whose book spells the away team differently', () => {
    const ev: OddsApiEvent = { id: '1', sport_key: 'soccer_x', commence_time: '2026-11-22T19:45:00Z', home_team: 'Atalanta', away_team: 'Inter',
      bookmakers: [{ key: 'pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'Atalanta', price: 5.74 }, { name: 'Inter Milan', price: 1.55 }, { name: 'Draw', price: 4.74 }] }] }] };
    const q = quotesFromEvent(ev, 'decimal', '2026-11-22T19:00:00Z');
    expect(q).toHaveLength(1);
    expect(q[0].prices).toEqual({ home: 5.74, away: 1.55, draw: 4.74 });
  });
});
