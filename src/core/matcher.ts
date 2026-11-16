import { ALIASES } from './aliases';
import { MATCH_WINDOW_HOURS } from './sports';
import type { KalshiGame, OddsEvent, Sport } from './types';

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'cd', 'ac', 'the', 'club', 'university', 'univ', 'de', 'ssc', 'as', 'us', 'calcio', 'sv', 'vfb', 'vfl', 'tsg', 'rc', 'stade', 'sl', 'fk', 'sk', 'cp']);

/** Lowercase, strip accents and punctuation, '&' -> 'and', 'saint' -> 'st', drop filler words. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.´`]/g, '')
    .replace(/[^a-z0-9()]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): { req: string[]; opt: string[]; raw: string[] } {
  const n = normalizeName(s);
  const opt: string[] = [];
  const base = n.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    opt.push(...inner.split(' ').filter(Boolean));
    return ' ';
  });
  const raw = base.split(' ').filter(Boolean);
  const req = raw.filter((t) => !STOP.has(t) && !/^\d+$/.test(t));
  return { req, opt, raw };
}

const prefixEq = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

/** Tokens that distinguish different teams; a partial match may not leave one of these unmatched. */
const DIFFERENTIATORS = new Set(['st', 'state', 'tech', 'a', 'm', 'and', 'southern', 'northern', 'eastern', 'western', 'central',
  'north', 'south', 'east', 'west', 'city', 'united', 'utd', 'ii', 'b', 'women', 'w', 'u21', 'u23', 'atletico', 'real', 'inter', 'sporting']);

/**
 * Tokens that mark a DIFFERENT team when the sportsbook name carries them and the Kalshi name does not:
 * "Texas" must not pair with "Texas A&M", "Michigan" with "Michigan State", "Arsenal" with "Arsenal Women",
 * "Real Madrid" with "Real Madrid Castilla". (Not "united"/"city": Kalshi often drops those.)
 */
const ODDS_ONLY_REJECT = new Set(['state', 'tech', 'a', 'm', 'ii', 'b', 'women', 'w', 'u19', 'u21', 'u23', 'castilla', 'reserves',
  'christian', 'cc', 'commerce', 'southern', 'northern', 'eastern', 'western', 'central', 'valley', 'atlantic']);

/**
 * Similarity of a Kalshi display name to an Odds API name, 0 (no match) up to 2 (exact / alias).
 * Tokens match by prefix ("st"~"state", "r"~"rangers"), each Odds token used once, in any order.
 * score = (matched/|kalshi tokens|) * (matched/|odds tokens|), so the tightest name wins
 * ("Florida" prefers "Florida Gators" over "Florida State Seminoles"). A partial match must include
 * a token of 4+ letters ("Strasbourg Alsace" ~ "Strasbourg", but never on "st" alone).
 * Parenthesized qualifiers like (FL) are optional: a hit adds 0.25, a miss subtracts 0.3.
 * Tennis falls back to surname equality.
 */
export function nameScore(kalshiName: string, oddsName: string, sport?: Sport): number {
  const flat = (x: string) => normalizeName(x).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  const nk = flat(kalshiName);
  const alias = sport ? ALIASES[sport]?.[nk] : undefined;
  if (alias && normalizeName(alias) === normalizeName(oddsName)) return 2;
  if (nk === flat(oddsName)) return 2;
  const K = tokens(kalshiName), O = tokens(oddsName);
  const oAll = [...O.req, ...O.opt];
  if (!K.req.length || !O.req.length) return 0;
  const used = new Array(O.req.length).fill(false);
  let matched = 0, strong = false, missedKey = false;
  for (const t of K.req) {
    let hit = O.req.findIndex((o, j) => !used[j] && o === t);
    if (hit < 0) hit = O.req.findIndex((o, j) => !used[j] && prefixEq(o, t));
    if (hit < 0) {
      // Single letters ("New York R", "Los Angeles F") are deliberate disambiguators: they must match,
      // possibly against a filler word the odds name carries ("Los Angeles FC").
      if (t.length === 1) { if (O.raw.some((o) => o.startsWith(t) && !O.req.includes(o))) { matched++; continue; } missedKey = true; }
      if (DIFFERENTIATORS.has(t)) missedKey = true;
      continue;
    }
    used[hit] = true;
    matched++;
    // Generic words shared by many clubs ("real", "inter", "sporting", "state") never carry a partial match alone.
    if (Math.min(t.length, O.req[hit].length) >= 4 && !DIFFERENTIATORS.has(t)) strong = true;
  }
  // Symmetric guard: a differentiator left over on the sportsbook side means a different team.
  if (matched > 0 && O.req.some((o, j) => !used[j] && ODDS_ONLY_REJECT.has(o))) return 0;
  // Both names carry a qualifier, e.g. (MD) vs (CA), and they share nothing: different schools.
  if (K.opt.length && O.opt.length && !K.opt.some((t) => O.opt.includes(t))) return 0;
  // Tennis: the surname must agree; a shared first name is not a match.
  if (sport === 'tennis' && matched > 0 && matched < Math.max(K.req.length, O.req.length)) {
    const lk = K.req[K.req.length - 1], lo = O.req[O.req.length - 1];
    if (lk !== lo) return 0;
    // Same surname, both first names given and different ("Alexander Zverev" vs "Mischa Zverev").
    if (K.req.length > 1 && O.req.length > 1 && !prefixEq(K.req[0], O.req[0])) return 0;
  }
  if (matched === 0 || missedKey || (matched < K.req.length && !strong)) {
    if (sport === 'tennis') {
      const lk = K.req[K.req.length - 1], lo = O.req[O.req.length - 1];
      return lk && lk === lo ? 0.5 : 0;
    }
    return 0;
  }
  let score = (matched / K.req.length) * (matched / O.req.length);
  for (const t of K.opt) score += oAll.includes(t) ? 0.25 : -0.3;
  return Math.max(score, 0.01);
}

export interface MatchResult {
  game: KalshiGame;
  event: OddsEvent;
  /** Kalshi competitor code -> 'home' | 'away' in the Odds event */
  homeCode: string;
  awayCode: string;
  score: number;
}

export interface UnmatchedKalshi {
  gameId: string;
  title: string;
  startTime: string;
  reason: string;
}

export interface MatchReport {
  matches: MatchResult[];
  unmatchedKalshi: UnmatchedKalshi[];
  unmatchedOdds: { id: string; sportKey: string; title: string; commence: string }[];
}

/**
 * Match Kalshi games to odds events: same league (caller passes only the events fetched for the
 * league's odds key), start time within MATCH_WINDOW_HOURS, both names matching in either
 * orientation. Each odds event is used at most once (best score wins).
 */
export function matchGames(sport: Sport, games: KalshiGame[], events: OddsEvent[]): MatchReport {
  type Cand = { gi: number; ei: number; score: number; homeCode: string; awayCode: string };
  const cands: Cand[] = [];
  const reasons = new Map<number, string>();
  games.forEach((g, gi) => {
    const t = Date.parse(g.startTime);
    const near = events.map((e, ei) => ({ e, ei })).filter(({ e }) => Math.abs(Date.parse(e.commence_time) - t) <= MATCH_WINDOW_HOURS * 3600e3);
    if (!near.length) { reasons.set(gi, events.length ? 'no odds event within 3h of start' : 'no odds events loaded for league'); return; }
    const [c0, c1] = g.competitors;
    let best = 0;
    for (const { e, ei } of near) {
      const a = Math.min(nameScore(c0.name, e.home_team, sport), nameScore(c1.name, e.away_team, sport));
      const b = Math.min(nameScore(c1.name, e.home_team, sport), nameScore(c0.name, e.away_team, sport));
      if (a > 0 && a >= b) cands.push({ gi, ei, score: a, homeCode: c0.code, awayCode: c1.code });
      else if (b > 0) cands.push({ gi, ei, score: b, homeCode: c1.code, awayCode: c0.code });
      best = Math.max(best, a, b);
    }
    if (best === 0) reasons.set(gi, `names did not match: ${c0.name} / ${c1.name}`);
  });
  cands.sort((x, y) => y.score - x.score);
  const usedG = new Set<number>(), usedE = new Set<number>();
  const matches: MatchResult[] = [];
  for (const c of cands) {
    if (usedG.has(c.gi) || usedE.has(c.ei)) continue;
    usedG.add(c.gi); usedE.add(c.ei);
    matches.push({ game: games[c.gi], event: events[c.ei], homeCode: c.homeCode, awayCode: c.awayCode, score: c.score });
  }
  const unmatchedKalshi = games
    .map((g, gi) => ({ g, gi }))
    .filter(({ gi }) => !usedG.has(gi))
    .map(({ g, gi }) => ({ gameId: g.id, title: g.title, startTime: g.startTime, reason: reasons.get(gi) ?? 'odds event claimed by a better match' }));
  const unmatchedOdds = events
    .map((e, ei) => ({ e, ei }))
    .filter(({ ei }) => !usedE.has(ei))
    .map(({ e }) => ({ id: e.id, sportKey: e.sport_key, title: `${e.away_team} @ ${e.home_team}`, commence: e.commence_time }));
  return { matches, unmatchedKalshi, unmatchedOdds };
}
