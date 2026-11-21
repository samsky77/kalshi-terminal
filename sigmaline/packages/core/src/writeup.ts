/**
 * "Why we like it" (spec §9): template write-ups from stored, structured facts only.
 * A rules engine scores each available driver and keeps the strongest; a missing fact simply
 * means that driver is skipped — nothing is guessed. WRITEUP_PROVIDER=llm can be swapped in
 * later, and must receive exactly this facts object with an instruction to add no facts.
 */
import { bookName } from './books';
import { edgePct } from './edge';
import { formatAmerican } from './odds';
import type { Selection, SportId } from './types';

export interface WriteupFacts {
  sport: SportId;
  home: string;
  away: string;
  selection: Selection;
  selectionLabel: string;
  /** Pick side's team name, if a team side. */
  team?: string;
  opponent?: string;
  bestDecimal: number;
  book: string;
  modelP: number; // model win prob (no-push)
  /** True only when an independent model (team ratings / Elo) priced the game, not the market fallback. */
  modelIndependent?: boolean;
  consensusP: number; // market no-vig
  fairP: number;
  ev: number;
  booksChecked: number;
  /** Consensus main line for the market, home perspective for spreads. */
  consensusLine?: number;
  /** Model's expected margin (home − away) and total. */
  modelMargin?: number;
  modelTotal?: number;
  restDays?: { home?: number; away?: number };
  injuries?: { player: string; team: 'home' | 'away'; status: string }[];
  /** Projected pace / scoring vs league average, as a ratio (1.04 = 4% above). */
  paceVsAvg?: number;
  /** Price movement of this selection from first to latest snapshot, in no-vig probability. */
  probMove?: number;
  lineMove?: { from: number; to: number };
  form?: { team: 'home' | 'away'; games: number; avgMargin: number }[];
  ratingGap?: { offence?: number; defence?: number };
  /** Soccer: simulated probability of a draw (from the stored sim summary). */
  drawP?: number;
  /** Tennis: best-of-3 or best-of-5 (stored event meta). */
  bestOf?: number;
  /** 'consensus' = no independent model for this market (props without a player sim, cold start). */
  fairSource?: 'blend' | 'consensus';
  /** Props: the player simulation's projected mean for the stat, when a player model ran. */
  propMean?: number;
}

export interface Writeup {
  edge: string;
  reasons: string[];
  risk: string;
  drivers: string[];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** What each sport calls the start of the game. */
export const START_WORD: Record<SportId, string> = { nba: 'tip-off', cbb: 'tip-off', nhl: 'puck drop', nfl: 'kickoff', cfb: 'kickoff', soccer: 'kickoff', tennis: 'first serve' };
const unitWord: Record<SportId, string> = { nba: 'points', cbb: 'points', nfl: 'points', cfb: 'points', nhl: 'goals', soccer: 'goals', tennis: 'games' };

function edgeSentence(f: WriteupFacts): string {
  const price = formatAmerican(f.bestDecimal);
  const gap = f.fairP - (1 / f.bestDecimal);
  const sel = f.selection;
  if (sel.market === 'spread' && f.team && f.modelMargin !== undefined) {
    const teamMargin = sel.side === 'home' ? f.modelMargin : -f.modelMargin;
    const ln = sel.line ?? 0;
    const bookView = ln < 0 ? `${f.team} by ${Math.abs(ln)}` : `${f.team} getting ${ln}`;
    const ours = Math.abs(teamMargin) < 1.5
      ? 'closer to a coin flip'
      : teamMargin > 0 ? `${f.team} by about ${Math.abs(teamMargin).toFixed(1)}` : `${f.opponent} by about ${Math.abs(teamMargin).toFixed(1)}`;
    return `Books have ${bookView}; our sims have it ${ours}. At ${price} that's worth about ${(f.ev * 100).toFixed(1)}% per bet over the long run.`;
  }
  if (sel.market === 'total' && f.modelTotal !== undefined) {
    return `The total sits at ${sel.line}; our sims land around ${f.modelTotal.toFixed(1)} ${unitWord[f.sport]}. ${sel.side === 'over' ? 'Over' : 'Under'} at ${price} works out to roughly +${(f.ev * 100).toFixed(1)}% EV.`;
  }
  if (sel.market === 'ml') {
    const who = sel.side === 'draw' ? 'the draw' : f.team;
    return `The price on ${who} (${price}) implies ${pct(1 / f.bestDecimal)}; we make it ${pct(f.fairP)}. That ${Math.round(gap * 1000) / 10}-point gap in win probability works out to about +${(f.ev * 100).toFixed(1)}% per bet (the edge).`;
  }
  if (sel.market === 'prop') {
    const yesNo = sel.line === 0.5 && /anytime|goals$|_td$/.test(sel.stat ?? '');
    const side = yesNo ? (sel.side === 'over' ? '“Yes”' : '“No”') : sel.side === 'over' ? 'over' : 'under';
    const basis = f.fairSource === 'consensus' || !ok(f.propMean)
      ? `the market consensus across ${f.booksChecked} books puts the ${side} at ${pct(f.fairP)}`
      : `our player sims project ${f.propMean < 5 ? f.propMean.toFixed(2) : f.propMean.toFixed(1)}, which puts the ${side} at ${pct(f.fairP)}`;
    return `${f.selectionLabel} at ${price}: ${basis}, against ${pct(1 / f.bestDecimal)} implied by the price. That's roughly +${(f.ev * 100).toFixed(1)}% EV.`;
  }
  return `${f.selectionLabel} at ${price}: we make it ${pct(f.fairP)} against ${pct(1 / f.bestDecimal)} implied by the price.`;
}

interface Candidate { score: number; text: string; id: string }

function candidates(f: WriteupFacts): Candidate[] {
  const c: Candidate[] = [];
  const side = f.selection.side;
  const us: 'home' | 'away' | undefined = side === 'home' || side === 'away' ? side : undefined;
  const them = us === 'home' ? 'away' : us === 'away' ? 'home' : undefined;
  const book = bookName(f.book);
  if (f.modelIndependent && Number.isFinite(f.modelP) && Number.isFinite(f.consensusP)) {
    const d = f.modelP - f.consensusP;
    if (Math.abs(d) >= 0.01) {
      c.push({
        id: 'model_vs_market', score: Math.abs(d) * 10,
        text: d > 0
          ? `Our ratings alone have this at ${pct(f.modelP)}, the market at ${pct(f.consensusP)}. We blend the two, so the fair number still leans on the market.`
          : `The market (${pct(f.consensusP)}) is actually a bit higher than our ratings (${pct(f.modelP)}); the value here comes from ${book} being slow to move.`,
      });
    }
  }
  if (f.booksChecked >= 3 && Number.isFinite(f.consensusP) && edgePct(f.consensusP, f.bestDecimal) > 0) {
    c.push({ id: 'line_shop', score: edgePct(f.consensusP, f.bestDecimal) * 30, text: `${book} is out of line with the other ${f.booksChecked - 1} books we checked; even the market's own fair price says this number is generous.` });
  }
  // Back-to-backs only exist in basketball and hockey; football rest edges are 2+ extra days.
  if (us && them && f.restDays && f.restDays[us] !== undefined && f.restDays[them] !== undefined && f.sport !== 'soccer' && f.sport !== 'tennis') {
    const a = f.restDays[us]!, b = f.restDays[them]!;
    if (b <= 0 && a >= 1 && (f.sport === 'nba' || f.sport === 'cbb' || f.sport === 'nhl')) c.push({ id: 'rest', score: 0.9, text: `${f.opponent} are on the second night of a back-to-back (tired legs usually show up late); ${f.team} had ${a} day${a === 1 ? '' : 's'} off.` });
    else if (a - b >= 2) c.push({ id: 'rest', score: 0.6, text: `${f.team} come in with ${a - b} more days of rest.` });
  }
  if (f.injuries?.length && us && them) {
    const out = f.injuries.filter((i) => i.team === them && /out|doubtful/i.test(i.status));
    if (out.length) c.push({ id: 'injuries', score: 0.8 + 0.2 * out.length, text: `${f.opponent} are listed without ${out.slice(0, 2).map((i) => i.player).join(' and ')}.` });
  }
  if (f.paceVsAvg !== undefined && f.selection.market === 'total' && f.sport !== 'tennis') {
    const d = f.paceVsAvg - 1;
    if ((d > 0.02 && side === 'over') || (d < -0.02 && side === 'under')) {
      c.push({ id: 'pace', score: Math.abs(d) * 15, text: `Projected pace is ${Math.abs(d * 100).toFixed(0)}% ${d > 0 ? 'above' : 'below'} league average (pace = how many scoring chances each team gets).` });
    }
  }
  if (f.lineMove && f.selection.market !== 'ml' && f.lineMove.from !== f.lineMove.to) {
    c.push({ id: 'line_move', score: 0.5, text: `The line has moved from ${f.lineMove.from} to ${f.lineMove.to} since it opened.` });
  } else if (f.probMove !== undefined && Math.abs(f.probMove) >= 0.015) {
    c.push({
      id: 'line_move', score: Math.abs(f.probMove) * 20,
      text: f.probMove > 0 ? `Money has been coming in on this side since the open (+${(f.probMove * 100).toFixed(1)} pts of implied probability).` : `The market has drifted the other way since the open, which is why the price is this good — worth knowing.`,
    });
  }
  if (f.form && us) {
    const mine = f.form.find((x) => x.team === us);
    if (mine && mine.games >= 5 && Math.abs(mine.avgMargin) >= 3) {
      c.push({ id: 'form', score: 0.4, text: `${f.team} have ${mine.avgMargin > 0 ? 'won' : 'lost'} their last ${mine.games} by an average of ${Math.abs(mine.avgMargin).toFixed(1)} ${unitWord[f.sport]}.` });
    }
  }
  if (f.ratingGap?.offence !== undefined && Math.abs(f.ratingGap.offence) >= 2 && us) {
    c.push({ id: 'matchup', score: 0.45, text: `Matchup: ${f.team}'s offence rates ${Math.abs(f.ratingGap.offence).toFixed(1)} ${unitWord[f.sport]} ${f.ratingGap.offence > 0 ? 'better' : 'worse'} than ${f.opponent}'s defence allows on average.` });
  }
  return c.sort((a, b) => b.score - a.score);
}

/** Sport-specific context sentences built only from stored facts; a missing fact skips the sentence. */
function sportContext(f: WriteupFacts): Candidate[] {
  const c: Candidate[] = [];
  const s = f.selection;
  if (f.sport === 'soccer' && s.market === 'ml' && s.side !== 'draw' && ok(f.drawP) && f.drawP >= 0.15) {
    c.push({ id: 'draw_risk', score: 0.7, text: `Draw risk is real here: our sims have it at ${pct(f.drawP)}, and a draw loses a ${f.team ?? 'team'} win bet.` });
  }
  if (f.sport === 'soccer' && s.market === 'ml' && s.side === 'draw' && ok(f.drawP)) {
    c.push({ id: 'draw_risk', score: 0.7, text: `Our sims land on a draw ${pct(f.drawP)} of the time.` });
  }
  if (f.sport === 'tennis' && (f.bestOf === 3 || f.bestOf === 5)) {
    c.push({ id: 'format', score: 0.3, text: f.bestOf === 5 ? 'Best-of-five sets gives the stronger player more room to recover from a slow start.' : 'Best-of-three sets leaves less room to recover from a slow start, which helps the underdog.' });
  }
  if ((f.sport === 'nfl' || f.sport === 'cfb') && s.market === 'spread' && ok(s.line) && [3, 7].includes(Math.abs(Math.round(s.line)))) {
    c.push({ id: 'key_number', score: 0.5, text: `${Math.abs(s.line)} is close to a key number in football (games land on 3 and 7 far more than other margins), which is where half a point is worth the most.` });
  }
  return c;
}

const RISK: Record<SportId, { spread: string; smallSpread: string; over: string; under: string; ml: string; prop: string }> = {
  nba: {
    spread: 'Risk: NBA leads swing fast; if the starters sit in a blowout, the bench decides the margin.',
    smallSpread: 'Risk: it\'s a small number, so one late run or intentional-foul sequence can swing it.',
    over: 'Risk: a slow, foul-light game or an early blowout that empties the bench kills an over.',
    under: 'Risk: overtime, or a hot shooting night from three, would bury the under.',
    ml: 'Risk: late scratches. NBA teams rest players on short notice, so check the injury report before tip-off.',
    prop: 'Risk: minutes. If the game gets lopsided or the rotation changes, the volume dries up.',
  },
  cbb: {
    spread: 'Risk: college lines move on thin information, and a late foul-shooting parade can move the margin a lot.',
    smallSpread: 'Risk: it\'s a small number, so free throws at the end of the game can swing it either way.',
    over: 'Risk: college pace varies a lot; a grinding half-court game kills an over.',
    under: 'Risk: late-game fouling adds free points, which is how unders die in college.',
    ml: 'Risk: college rosters change quickly and news travels late, so check for late lineup news before tip-off.',
    prop: 'Risk: foul trouble and blowouts cut college minutes fast.',
  },
  nfl: {
    spread: 'Risk: if the other side jumps out early, the game script turns against us fast.',
    smallSpread: 'Risk: it\'s a small number, so a late field goal can swing it either way.',
    over: 'Risk: a slow start, or a team running the clock with a lead, kills an over.',
    under: 'Risk: a couple of turnovers in short fields can bury the under quickly.',
    ml: 'Risk: the market is usually right; if this line moves against us before kickoff, the edge was probably noise.',
    prop: 'Risk: game script. A blowout changes who gets the ball and how often.',
  },
  cfb: {
    spread: 'Risk: big college spreads invite late backdoor covers once the starters come out.',
    smallSpread: 'Risk: it\'s a small number, so a late field goal can swing it either way.',
    over: 'Risk: a slow start, or a team running the clock with a lead, kills an over.',
    under: 'Risk: college defences give up big plays; a couple of long scores bury an under.',
    ml: 'Risk: college depth charts change late, so check for news before kickoff.',
    prop: 'Risk: game script and snap counts. A blowout means the backups play.',
  },
  nhl: {
    spread: 'Risk: NHL games are low scoring, so one empty-net goal decides a lot of puck lines.',
    smallSpread: 'Risk: NHL games are low scoring, so one empty-net goal decides a lot of puck lines.',
    over: 'Risk: a hot goalie can hold a game under on his own.',
    under: 'Risk: a late empty-net goal or two can push a close game over.',
    ml: 'Risk: about a quarter of NHL games go to overtime or a shootout, which is close to a coin flip.',
    prop: 'Risk: ice time. Shots and points depend on minutes and power-play time, which change with the score.',
  },
  soccer: {
    spread: 'Risk: one goal decides most matches, so a single deflection or penalty swings the handicap.',
    smallSpread: 'Risk: one goal decides most matches, so a single deflection or penalty swings the handicap.',
    over: 'Risk: an early red card or a cagey first half can kill an over.',
    under: 'Risk: one early goal opens a match up and can bury the under.',
    ml: 'Risk: a draw is always on the table in soccer, and it loses a win bet.',
    prop: 'Risk: substitutions and rotation. A player taken off at the hour mark has less time to get there.',
  },
  tennis: {
    spread: 'Risk: one break of serve in a tight set can swing a games handicap.',
    smallSpread: 'Risk: one break of serve in a tight set can swing a games handicap.',
    over: 'Risk: a one-sided match or a retirement ends things early, which kills an over.',
    under: 'Risk: tiebreaks add games quickly and can bury an under.',
    ml: 'Risk: retirements. Books settle them differently, so check your book\'s rule before you bet.',
    prop: 'Risk: a short, one-sided match leaves less time to reach the number.',
  },
};

function riskSentence(f: WriteupFacts): string {
  const s = f.selection;
  const r = RISK[f.sport];
  if (s.market === 'spread' && s.line !== undefined) return Math.abs(s.line) <= 3.5 ? r.smallSpread : r.spread;
  if (s.market === 'total') return s.side === 'over' ? r.over : r.under;
  if (s.market === 'prop') return r.prop;
  if (f.injuries?.length) return `Risk: late injury news. If a listed player's status changes before ${START_WORD[f.sport]}, the edge can disappear.`;
  return r.ml;
}

export function buildWriteup(f: WriteupFacts): Writeup {
  const picked = [...candidates(f), ...sportContext(f)].sort((a, b) => b.score - a.score).slice(0, 3);
  if (!picked.length) {
    picked.push({ id: 'books', score: 0, text: `${bookName(f.book)} has the best price of the ${f.booksChecked} book${f.booksChecked === 1 ? '' : 's'} we checked for this market.` });
  }
  return { edge: edgeSentence(f), reasons: picked.map((p) => p.text), risk: riskSentence(f), drivers: picked.map((p) => p.id) };
}
