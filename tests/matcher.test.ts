import { describe, expect, it } from 'vitest';
import { matchGames, nameScore, normalizeName } from '../src/core/matcher';
import { batchesForLeague } from '../src/core/pipeline';
import { SPORTS, type KalshiGame, type OddsEvent, type Sport } from '../src/core/types';
import { kalshiFixture, oddsFixture } from './helpers';

function matchAll(sport: Sport) {
  const snap = kalshiFixture(sport);
  const odds = oddsFixture(sport).batches;
  const pairs = new Map<string, { home: string; away: string; kh: string; ka: string }>();
  let unmatchedKalshi = 0, unmatchedOdds = 0;
  for (const L of [...new Set(snap.games.map((g) => g.league))]) {
    const r = matchGames(sport, snap.games.filter((g) => g.league === L), batchesForLeague(L, odds).flatMap((b) => b.events));
    unmatchedKalshi += r.unmatchedKalshi.length;
    unmatchedOdds += r.unmatchedOdds.length;
    for (const m of r.matches) {
      const name = (code: string) => m.game.competitors.find((c) => c.code === code)!.name;
      pairs.set(m.game.id, { home: m.event.home_team, away: m.event.away_team, kh: name(m.homeCode), ka: name(m.awayCode) });
    }
  }
  return { pairs, unmatchedKalshi, unmatchedOdds, kalshi: snap.games.length };
}

describe('name normalization', () => {
  it('strips accents, punctuation and filler', () => {
    expect(normalizeName('Atlético Madrid')).toBe('atletico madrid');
    expect(normalizeName("Saint Mary's")).toBe('st marys');
    expect(normalizeName('Texas A&M')).toBe('texas a and m');
    expect(normalizeName('M´gladbach')).toBe('mgladbach');
  });
  it('scores the tightest name highest', () => {
    expect(nameScore('Florida', 'Florida Gators')).toBeGreaterThan(nameScore('Florida', 'Florida State Seminoles'));
    expect(nameScore('Florida St.', 'Florida Gators')).toBe(0);
    expect(nameScore('New York R', 'New York Rangers')).toBeGreaterThan(0);
    expect(nameScore('New York R', 'New York Islanders')).toBe(0);
    expect(nameScore('Los Angeles C', 'Los Angeles Clippers')).toBeGreaterThan(nameScore('Los Angeles C', 'Los Angeles Lakers'));
    expect(nameScore('Miami (FL)', 'Miami Hurricanes', 'ncaab')).toBe(2);
    expect(nameScore('Miami (OH)', 'Miami Hurricanes')).toBeLessThan(nameScore('Miami (OH)', 'Miami (OH) RedHawks'));
  });
  it('never matches on a short token alone', () => {
    expect(nameScore('St. Thomas', 'St. Johns Red Storm')).toBe(0);
  });
});

// Real recorded fixtures for all seven sports: known pairs must match with the right home/away.
const KNOWN: Record<Sport, [string, string, string][]> = {
  nba: [['nba:KXNBA:26NOV13OKCLAC', 'Los Angeles Clippers', 'Oklahoma City Thunder'], ['nba:KXNBA:26NOV13GSWSAS', 'San Antonio Spurs', 'Golden State Warriors']],
  nfl: [['nfl:KXNFL:26NOV15NEDET', 'Detroit Lions', 'New England Patriots'], ['nfl:KXNFL:26NOV22NYJLAC', 'Los Angeles Chargers', 'New York Jets']],
  nhl: [['nhl:KXNHL:26NOV13NYRVAN', 'Vancouver Canucks', 'New York Rangers'], ['nhl:KXNHL:26NOV14SJUTA', 'Utah Mammoth', 'San Jose Sharks']],
  ncaaf: [['ncaaf:KXNCAAF:26NOV14JMUCONN', 'UConn Huskies', 'James Madison Dukes'], ['ncaaf:KXNCAAF:26NOV14NDSUHAW', 'Hawaii Rainbow Warriors', 'North Dakota State Bison']],
  ncaab: [['ncaab:KXNCAAMB:26NOV13GASOUCF', 'UCF Knights', 'Georgia Southern Eagles'], ['ncaab:KXNCAAMB:26NOV13ALCNTARL', 'Tarleton State Texans', 'Alcorn St Braves']],
  tennis: [['tennis:KXATP:26NOV15ZVEJOD', 'Alexander Zverev', 'Rafael Jodar'], ['tennis:KXWTA:26NOV14PEGAND', 'Jessica Pegula', 'Mirra Andreeva']],
  soccer: [['soccer:KXLALIGA2:26NOV14MALCOR', 'Mallorca', 'Córdoba'], ['soccer:KXLIGAMX:26NOV14QUEMON', 'Querétaro', 'Monterrey']],
};
// Lower bounds on matches in the recorded fixtures (regression guard for the alias table).
const MIN_MATCHES: Record<Sport, number> = { nba: 7, nfl: 26, nhl: 16, ncaaf: 72, ncaab: 82, tennis: 4, soccer: 140 };

describe.each(SPORTS)('matcher on recorded %s fixtures', (sport) => {
  const r = matchAll(sport);
  it('matches known games with correct home/away', () => {
    for (const [id, home, away] of KNOWN[sport]) {
      const p = r.pairs.get(id);
      expect(p, id).toBeDefined();
      expect(p!.home).toBe(home);
      expect(p!.away).toBe(away);
    }
  });
  it('keeps the match rate and logs the rest', () => {
    expect(r.pairs.size).toBeGreaterThanOrEqual(MIN_MATCHES[sport]);
    expect(r.pairs.size + r.unmatchedKalshi).toBe(r.kalshi);
  });
});

describe('matcher rules', () => {
  const game = (start: string): KalshiGame => ({
    id: 'g', sport: 'nba', league: 'KXNBA', competition: '', title: '', startTime: start, startSource: 'milestone',
    competitors: [{ code: 'BOS', name: 'Boston' }, { code: 'NYK', name: 'New York' }], eventTickers: [], contracts: [],
  });
  const ev = (start: string, id = 'e'): OddsEvent => ({ id, sport_key: 'basketball_nba', commence_time: start, home_team: 'New York Knicks', away_team: 'Boston Celtics', bookmakers: [] });
  it('requires start within 3 hours', () => {
    expect(matchGames('nba', [game('2026-11-14T00:00:00Z')], [ev('2026-11-14T02:59:00Z')]).matches).toHaveLength(1);
    const far = matchGames('nba', [game('2026-11-14T00:00:00Z')], [ev('2026-11-14T03:01:00Z')]);
    expect(far.matches).toHaveLength(0);
    expect(far.unmatchedKalshi[0].reason).toMatch(/3h/);
  });
  it('orients home/away from the odds event', () => {
    const m = matchGames('nba', [game('2026-11-14T00:00:00Z')], [ev('2026-11-14T00:00:00Z')]).matches[0];
    expect(m.homeCode).toBe('NYK');
    expect(m.awayCode).toBe('BOS');
  });
  it('uses each odds event once', () => {
    const r = matchGames('nba', [game('2026-11-14T00:00:00Z'), { ...game('2026-11-14T00:30:00Z'), id: 'g2' }], [ev('2026-11-14T00:00:00Z')]);
    expect(r.matches).toHaveLength(1);
    expect(r.unmatchedKalshi).toHaveLength(1);
  });
});
