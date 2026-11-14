import { describe, expect, it } from 'vitest';
import { equivalentLine, probYes, strikeHolds, tierFor } from '../src/core/edge';
import { discoverSeries, parseContract, spreadCompetitor, type RawEvent, type RawMarket } from '../src/core/kalshi';
import type { Consensus, FeeInfo } from '../src/core/types';
import { kalshiFixture } from './helpers';

const fee: FeeInfo = { feeType: 'quadratic', feeMultiplier: 1 };
const ev = (series: string, ticker: string): RawEvent => ({ event_ticker: ticker, series_ticker: series, title: 'New York vs Indiana' });
const comps = [{ code: 'NYK', name: 'New York' }, { code: 'IND', name: 'Indiana' }];

// Shapes copied from the live API (see docs/KALSHI.md).
const spreadMkt: RawMarket = {
  ticker: 'KXNBASPREAD-26NOV13NYKIND-IND19', event_ticker: 'KXNBASPREAD-26NOV13NYKIND', market_type: 'binary', status: 'active',
  strike_type: 'greater', floor_strike: 18.5, yes_sub_title: 'Indiana wins by over 18.5 points',
  yes_ask_dollars: '0.0100', yes_ask_size_fp: '606.00', no_ask_dollars: '1.0000', yes_bid_dollars: '0.0000', yes_bid_size_fp: '0.00',
};
const totalMkt: RawMarket = {
  ticker: 'KXNBATOTAL-26NOV13NYKIND-212', event_ticker: 'KXNBATOTAL-26NOV13NYKIND', market_type: 'binary', status: 'active',
  strike_type: 'greater', floor_strike: 211.5, yes_sub_title: 'Over 211.5 points',
  yes_ask_dollars: '0.5600', yes_ask_size_fp: '10.00', no_ask_dollars: '0.4500', yes_bid_dollars: '0.5500', yes_bid_size_fp: '20.00',
};

describe('strike parsing', () => {
  it('parses a spread strike: team from ticker suffix, strike from floor_strike', () => {
    const c = parseContract(spreadMkt, ev('KXNBASPREAD', 'KXNBASPREAD-26NOV13NYKIND'), 'spread', fee, comps)!;
    expect(c.kind).toBe('spread');
    expect(c.code).toBe('IND');
    expect(c.floorStrike).toBe(18.5);
    expect(c.strikeType).toBe('greater');
    expect(c.yesAsk).toBe(0.01);
    expect(c.noAsk).toBeNull(); // $1.00 asks are not tradeable
  });
  it('parses a total strike and reads No size from the Yes bid', () => {
    const c = parseContract(totalMkt, ev('KXNBATOTAL', 'KXNBATOTAL-26NOV13NYKIND'), 'total', fee, comps)!;
    expect(c.kind).toBe('total');
    expect(c.floorStrike).toBe(211.5);
    expect(c.noAsk).toBe(0.45);
    expect(c.noAskSize).toBe(20);
  });
  it('maps tennis "Taylor Fritz -6.5 games" (suffix FRI7) to the player', () => {
    const m: RawMarket = { ...spreadMkt, ticker: 'KXATPGSPREAD-26NOV14FRITIR-FRI7', floor_strike: 6.5, yes_sub_title: 'Taylor Fritz -6.5 games' };
    expect(spreadCompetitor(m, [{ code: 'FRI', name: 'Taylor Fritz' }, { code: 'TIR', name: 'Thiago Agustin Tirante' }])).toBe('FRI');
  });
  it('treats a winner market with suffix TIE as the tie contract', () => {
    const m: RawMarket = { ...totalMkt, ticker: 'KXEPLGAME-26NOV21MCIFUL-TIE', strike_type: 'structured', floor_strike: null, yes_sub_title: 'Tie' };
    const c = parseContract(m, ev('KXEPLGAME', 'KXEPLGAME-26NOV21MCIFUL'), 'winner', fee, comps)!;
    expect(c.kind).toBe('tie');
    expect(c.code).toBeUndefined();
  });
  it('evaluates strike conditions exactly as Kalshi defines them', () => {
    const g = { strikeType: 'greater' as const, floorStrike: 211.5 };
    expect(strikeHolds(g, 212)).toBe(true);
    expect(strikeHolds(g, 211)).toBe(false);
    expect(strikeHolds({ strikeType: 'greater', floorStrike: 3 }, 3)).toBe(false); // strictly greater
    expect(strikeHolds({ strikeType: 'greater_or_equal', floorStrike: 3 }, 3)).toBe(true);
    expect(strikeHolds({ strikeType: 'between', floorStrike: 3, capStrike: 5 }, 5)).toBe(true);
    expect(strikeHolds({ strikeType: 'less', capStrike: 5 }, 5)).toBe(false);
  });
  it('reads probabilities off simulated runs', () => {
    const runs = { home: Int16Array.from([110, 100, 90]), away: Int16Array.from([100, 100, 100]) };
    const c = parseContract(spreadMkt, ev('KXNBASPREAD', 'KXNBASPREAD-26NOV13NYKIND'), 'spread', fee, comps)!;
    const sideOf = (code?: string) => (code === 'NYK' ? 'home' : code === 'IND' ? 'away' : undefined) as 'home' | 'away' | undefined;
    expect(probYes({ ...c, floorStrike: 5.5 }, runs, sideOf)).toBeCloseTo(1 / 3);
  });
});

describe('confidence tiers', () => {
  const cons: Consensus = { pHome: 0.6, pAway: 0.4, spreadLine: -3.5, pHomeCover: 0.5, totalLine: 220.5, pOver: 0.5, books: [], booksMl: 1, booksSpread: 1, booksTotal: 1, lastUpdate: '' };
  const base = parseContract(totalMkt, ev('KXNBATOTAL', 'x-y'), 'total', fee, comps)!;
  it('A at the main line, B within one score unit, C beyond', () => {
    expect(tierFor('nba', { ...base, floorStrike: 220.5 }, undefined, cons)).toBe('A');
    expect(tierFor('nba', { ...base, floorStrike: 223.5 }, undefined, cons)).toBe('B');
    expect(tierFor('nba', { ...base, floorStrike: 230.5 }, undefined, cons)).toBe('C');
  });
  it('expresses team spreads as the home handicap', () => {
    const sp = { ...base, kind: 'spread' as const, floorStrike: 3.5 };
    expect(equivalentLine(sp, 'home')).toBe(-3.5); // "home wins by over 3.5" == home -3.5
    expect(tierFor('nba', sp, 'home', cons)).toBe('A');
    expect(tierFor('nba', sp, 'away', cons)).toBe('C'); // away wins by >3.5 == home +3.5, 7 points away
  });
  it('downgrades to C when the sim missed that anchor', () => {
    expect(tierFor('nba', { ...base, floorStrike: 220.5 }, undefined, cons, new Set(['total']))).toBe('C');
  });
});

describe('series discovery (seed map only, no keyword search)', () => {
  const S = (ticker: string, extra: object = {}) => ({ ticker, category: 'Sports', fee_type: 'quadratic', fee_multiplier: 1, ...extra });
  const found = discoverSeries([
    S('KXNBAGAME'), S('KXNBASPREAD', { fee_type: 'quadratic_with_maker_fees' }), S('KXNBATOTAL'), S('KXNBA1HSPREAD'), S('KXNBASERIES'),
    S('KXMVENBASINGLEGAME'), S('KXNFLTIE'), S('KXNFLWEEKTIE'), S('KXLALIGA2GAME'), S('KXNCAAFCSGAME'), S('KXATPGTOTAL'), S('KXEPLTIE'),
    S('KXNBAGAME', { category: 'Politics' }), S('KXNHLTEAMTOTAL'), S('KXSERIEATOTAL', { fee_multiplier: 0.5 }),
  ]);
  const t = found.map((f) => f.seriesTicker).sort();
  it('keeps only full-game winner/spread/total(/NFL tie) series', () => {
    expect(t).toEqual(['KXATPGTOTAL', 'KXLALIGA2GAME', 'KXNBAGAME', 'KXNBASPREAD', 'KXNBATOTAL', 'KXNCAAFCSGAME', 'KXNFLTIE', 'KXSERIEATOTAL']);
  });
  it('assigns the longest league prefix and carries fee data', () => {
    expect(found.find((f) => f.seriesTicker === 'KXLALIGA2GAME')!.seed.prefix).toBe('KXLALIGA2');
    expect(found.find((f) => f.seriesTicker === 'KXNCAAFCSGAME')!.seed.prefix).toBe('KXNCAAFCS');
    expect(found.find((f) => f.seriesTicker === 'KXSERIEATOTAL')!.fee.feeMultiplier).toBe(0.5);
    expect(found.find((f) => f.seriesTicker === 'KXNBASPREAD')!.fee.feeType).toBe('quadratic_with_maker_fees');
  });
});

describe('recorded Kalshi fixtures contain no parlays or excluded scopes', () => {
  it.each(['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'tennis', 'soccer'] as const)('%s', (sport) => {
    const snap = kalshiFixture(sport);
    expect(snap.games.length).toBeGreaterThan(0);
    for (const g of snap.games) {
      expect(g.competitors).toHaveLength(2);
      for (const c of g.contracts) {
        expect(c.seriesTicker).toMatch(/^KX[A-Z0-9]+?(GAME|MATCH|SPREAD|GSPREAD|TOTAL|GTOTAL|TIE)$/);
        expect(c.seriesTicker).not.toMatch(/MVE|PARLAY|1H|2H|1Q|2Q|3Q|4Q|TEAMTOTAL|SERIES/);
        expect(c.ticker.split('-')).toHaveLength(3);
        if (c.kind === 'spread' || c.kind === 'total') expect(c.floorStrike ?? c.capStrike).toBeDefined();
      }
    }
  });
});
