/**
 * Import licensed historical results (docs/licensing.md):
 *  - NFL: nflverse-data `schedules/games.csv` (CC BY 4.0) — results + closing spread/total/moneyline.
 *  - Soccer: openfootball football.json (CC0) — EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL.
 * Rows are stored as events with source='history' (model inputs and backtests only, never shown).
 */
import { americanToDecimal } from '@sigmaline/core';
import { eventId, type EventRow } from '@sigmaline/db';
import type { Ctx } from './context';
import { getJson } from './providers/http';

export const NFLVERSE_GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

/** nflverse abbreviations -> current Odds API franchise names (relocations map to today's team). */
export const NFL_TEAMS: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LA: 'Los Angeles Rams', STL: 'Los Angeles Rams',
  LAC: 'Los Angeles Chargers', SD: 'Los Angeles Chargers', LV: 'Las Vegas Raiders', OAK: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
  NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, v[i] ?? ''])); });
}

export function nflRowsToEvents(rows: Record<string, string>[], minSeason: number): EventRow[] {
  const out: EventRow[] = [];
  for (const r of rows) {
    if (Number(r.season) < minSeason || r.home_score === '' || r.away_score === '') continue;
    const home = NFL_TEAMS[r.home_team], away = NFL_TEAMS[r.away_team];
    if (!home || !away) continue;
    // gametime is US Eastern local; approximate as 17:00 UTC + offset when present
    const [hh, mm] = (r.gametime || '13:00').split(':').map(Number);
    const commence = new Date(`${r.gameday}T${String((hh + 5) % 24).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00Z`).toISOString();
    const hs = Number(r.home_score), as = Number(r.away_score);
    // nflverse spread_line: positive = home favoured by that many points -> home line = −spread_line
    const spread = r.spread_line === '' ? null : -Number(r.spread_line);
    out.push({
      id: eventId('nfl', 'nfl', commence, home, away), sport_id: 'nfl', league_id: 'nfl', home, away, commence_time: commence,
      status: 'final', home_score: hs, away_score: as, winner: hs > as ? 1 : hs < as ? -1 : 0, final_at: commence,
      provider_ids: { nflverse: r.game_id }, source: 'history',
      meta: {
        neutral: r.location === 'Neutral', game_type: r.game_type, season: Number(r.season),
        close: {
          spreadLine: spread,
          homeSpreadDec: r.home_spread_odds ? americanToDecimal(Number(r.home_spread_odds)) : null,
          awaySpreadDec: r.away_spread_odds ? americanToDecimal(Number(r.away_spread_odds)) : null,
          totalLine: r.total_line === '' ? null : Number(r.total_line),
          overDec: r.over_odds ? americanToDecimal(Number(r.over_odds)) : null,
          underDec: r.under_odds ? americanToDecimal(Number(r.under_odds)) : null,
          homeMlDec: r.home_moneyline ? americanToDecimal(Number(r.home_moneyline)) : null,
          awayMlDec: r.away_moneyline ? americanToDecimal(Number(r.away_moneyline)) : null,
        },
      },
    });
  }
  return out;
}

export async function importNfl(ctx: Ctx, minSeason = 2012): Promise<number> {
  const res = await fetch(NFLVERSE_GAMES_URL);
  if (!res.ok) throw new Error(`nflverse HTTP ${res.status}`);
  const events = nflRowsToEvents(parseCsv(await res.text()), minSeason);
  // insertIgnore: never overwrite a live event that happens to share an id
  let n = 0;
  for (let i = 0; i < events.length; i += 500) n += await ctx.db.insertIgnore('events', events.slice(i, i + 500) as unknown as Record<string, unknown>[], 'id');
  return n;
}

export const OPENFOOTBALL_LEAGUES: Record<string, string> = { epl: 'en.1', laliga: 'es.1', seriea: 'it.1', bundesliga: 'de.1', ligue1: 'fr.1', ucl: 'uefa.cl' };

export async function importSoccer(ctx: Ctx, seasons: string[]): Promise<number> {
  let n = 0;
  for (const [league, file] of Object.entries(OPENFOOTBALL_LEAGUES)) {
    for (const season of seasons) {
      type M = { date: string; time?: string; team1: string; team2: string; score?: { ft?: [number, number] }; round?: string };
      let body: { matches?: M[] };
      try { body = (await getJson<{ matches?: M[] }>(`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${file}.json`)).body; }
      catch { continue; }
      const rows: EventRow[] = [];
      for (const m of body.matches ?? []) {
        const ft = m.score?.ft;
        if (!ft) continue;
        const commence = new Date(`${m.date}T${(m.time ?? '15:00').slice(0, 5)}:00Z`).toISOString();
        rows.push({
          id: eventId('soccer', league, commence, m.team1, m.team2), sport_id: 'soccer', league_id: league, home: m.team1, away: m.team2, commence_time: commence,
          status: 'final', home_score: ft[0], away_score: ft[1], winner: ft[0] > ft[1] ? 1 : ft[0] < ft[1] ? -1 : 0, final_at: commence,
          provider_ids: { openfootball: `${season}/${file}` }, source: 'history', meta: { season, neutral: league === 'ucl' && /final/i.test(m.round ?? '') && !/semi|quarter/i.test(m.round ?? '') },
        });
      }
      for (let i = 0; i < rows.length; i += 500) n += await ctx.db.insertIgnore('events', rows.slice(i, i + 500) as unknown as Record<string, unknown>[], 'id');
    }
  }
  return n;
}
