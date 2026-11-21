import { describe, expect, it } from 'vitest';
import { buildWriteup, SPORTS, START_WORD, type Selection, type SportId, type WriteupFacts } from '../src';

const TEAMS: Record<SportId, [string, string]> = {
  nba: ['Boston Celtics', 'Miami Heat'], cbb: ['Duke Blue Devils', 'UNC Tar Heels'], nfl: ['Buffalo Bills', 'Miami Dolphins'], cfb: ['Ohio State Buckeyes', 'Michigan Wolverines'],
  nhl: ['Boston Bruins', 'Toronto Maple Leafs'], soccer: ['Arsenal', 'Chelsea'], tennis: ['Jannik Sinner', 'Carlos Alcaraz'],
};
const PROP: Record<SportId, string> = { nba: 'player_points', cbb: 'player_points', nfl: 'player_pass_yds', cfb: 'player_rush_yds', nhl: 'player_shots_on_goal', soccer: 'player_goals', tennis: 'player_aces' };
const BAD = /undefined|NaN|null|\[object|\$\{|TODO|placeholder|lorem/i;

function facts(sport: SportId, selection: Selection, over: Partial<WriteupFacts> = {}): WriteupFacts {
  const [home, away] = TEAMS[sport];
  return {
    sport, home, away, selection, selectionLabel: 'label', team: selection.side === 'home' ? home : selection.side === 'away' ? away : undefined,
    opponent: selection.side === 'home' ? away : selection.side === 'away' ? home : undefined, bestDecimal: 2.1, book: 'draftkings', modelP: 0.52, consensusP: 0.5, fairP: 0.51,
    ev: 0.071, booksChecked: 7, modelMargin: 2.5, modelTotal: 210, ...over,
  };
}

function text(w: ReturnType<typeof buildWriteup>) { return [w.edge, ...w.reasons, w.risk].join(' '); }

describe('per-sport write-ups', () => {
  for (const sport of SPORTS) {
    it(`${sport}: a game line and a prop render with no placeholder text`, () => {
      const line = buildWriteup(facts(sport, { market: 'spread', side: 'home', line: -2.5 }));
      const ml = buildWriteup(facts(sport, { market: 'ml', side: 'away' }, { drawP: sport === 'soccer' ? 0.27 : undefined, bestOf: sport === 'tennis' ? 5 : undefined }));
      const total = buildWriteup(facts(sport, { market: 'total', side: 'under', line: 6.5 }));
      const prop = buildWriteup(facts(sport, { market: 'prop', side: 'over', line: 24.5, player: 'Test Player', stat: PROP[sport] }, { fairSource: 'consensus', team: undefined, opponent: undefined }));
      for (const w of [line, ml, total, prop]) {
        const t = text(w);
        expect(t).not.toMatch(BAD);
        expect(w.edge.length).toBeGreaterThan(20);
        expect(w.reasons.length).toBeGreaterThan(0);
        expect(w.risk).toMatch(/^Risk: /);
      }
      expect(prop.edge).toMatch(/market consensus across 7 books/);
      // football words only in football
      if (!['nfl', 'cfb'].includes(sport)) for (const w of [line, ml, total, prop]) expect(text(w)).not.toMatch(/field goal|kick-?off/i);
    });
  }
  it('uses each sport’s own start word and context only when the fact exists', () => {
    expect(START_WORD.nba).toBe('tip-off');
    const soccer = text(buildWriteup(facts('soccer', { market: 'ml', side: 'home' }, { drawP: 0.28 })));
    expect(soccer).toMatch(/Draw risk is real here: our sims have it at 28%/);
    const soccerNoDraw = text(buildWriteup(facts('soccer', { market: 'ml', side: 'home' })));
    expect(soccerNoDraw).not.toMatch(/our sims have it at/); // no draw fact → no draw-probability sentence
    expect(text(buildWriteup(facts('tennis', { market: 'ml', side: 'home' }, { bestOf: 5 })))).toMatch(/Best-of-five/);
    expect(text(buildWriteup(facts('nfl', { market: 'spread', side: 'home', line: -3 })))).toMatch(/key number/);
    const nbaInj = buildWriteup(facts('nba', { market: 'ml', side: 'home' }, { injuries: [{ player: 'Star Guard', team: 'away', status: 'Out' }] }));
    expect(text(nbaInj)).toMatch(/without Star Guard/);
    expect(nbaInj.risk).toMatch(/tip-off/);
  });
  it('a prop with a player simulation cites the projection; without one it says consensus', () => {
    const sel: Selection = { market: 'prop', side: 'over', line: 24.5, player: 'P', stat: 'player_points' };
    expect(buildWriteup(facts('nba', sel, { fairSource: 'blend', propMean: 26.3 })).edge).toMatch(/project 26\.3/);
    expect(buildWriteup(facts('nba', sel, { fairSource: 'consensus' })).edge).toMatch(/consensus/);
  });
});
