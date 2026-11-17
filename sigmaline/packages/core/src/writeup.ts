/**
 * "Why we like it" (spec §9): template write-ups from stored, structured facts only.
 * A rules engine scores each available driver and keeps the strongest; a missing fact simply
 * means that driver is skipped — nothing is guessed. WRITEUP_PROVIDER=llm can be swapped in
 * later, and must receive exactly this facts object with an instruction to add no facts.
 */
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
}

export interface Writeup {
  edge: string;
  reasons: string[];
  risk: string;
  drivers: string[];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
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
    return `The price on ${who} (${price}) implies ${pct(1 / f.bestDecimal)}; we make it ${pct(f.fairP)}. That ${Math.round(gap * 1000) / 10}-point gap is the edge.`;
  }
  return `${f.selectionLabel} at ${price}: we make it ${pct(f.fairP)} against ${pct(1 / f.bestDecimal)} implied by the price.`;
}

interface Candidate { score: number; text: string; id: string }

function candidates(f: WriteupFacts): Candidate[] {
  const c: Candidate[] = [];
  const side = f.selection.side;
  const us: 'home' | 'away' | undefined = side === 'home' || side === 'away' ? side : undefined;
  const them = us === 'home' ? 'away' : us === 'away' ? 'home' : undefined;
  if (Number.isFinite(f.modelP) && Number.isFinite(f.consensusP)) {
    const d = f.modelP - f.consensusP;
    if (Math.abs(d) >= 0.01) {
      c.push({
        id: 'model_vs_market', score: Math.abs(d) * 10,
        text: d > 0
          ? `Our ratings alone have this at ${pct(f.modelP)}, the market at ${pct(f.consensusP)}. We blend the two, so the fair number still leans on the market.`
          : `The market (${pct(f.consensusP)}) is actually a bit higher than our ratings (${pct(f.modelP)}); the value here comes from ${f.book} being slow to move.`,
      });
    }
  }
  if (f.booksChecked >= 3 && Number.isFinite(f.consensusP) && f.consensusP * f.bestDecimal > 1) {
    c.push({ id: 'line_shop', score: (f.consensusP * f.bestDecimal - 1) * 30, text: `${f.book} is out of line with the other ${f.booksChecked - 1} books we checked; even the market's own fair price says this number is generous.` });
  }
  if (us && them && f.restDays && f.restDays[us] !== undefined && f.restDays[them] !== undefined) {
    const a = f.restDays[us]!, b = f.restDays[them]!;
    if (b <= 0 && a >= 1) c.push({ id: 'rest', score: 0.9, text: `${f.opponent} are on the second night of a back-to-back (tired legs usually show up late); ${f.team} had ${a} day${a === 1 ? '' : 's'} off.` });
    else if (a - b >= 2) c.push({ id: 'rest', score: 0.6, text: `${f.team} come in with ${a - b} more days of rest.` });
  }
  if (f.injuries?.length && us && them) {
    const out = f.injuries.filter((i) => i.team === them && /out|doubtful/i.test(i.status));
    if (out.length) c.push({ id: 'injuries', score: 0.8 + 0.2 * out.length, text: `${f.opponent} are listed without ${out.slice(0, 2).map((i) => i.player).join(' and ')}.` });
  }
  if (f.paceVsAvg !== undefined && f.selection.market === 'total') {
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

function riskSentence(f: WriteupFacts): string {
  const s = f.selection;
  if (s.market === 'spread' && s.line !== undefined) {
    return Math.abs(s.line) <= 3.5
      ? `Risk: it's a small number, so a late field goal or a garbage-time score can swing it either way.`
      : `Risk: if ${f.opponent ?? 'the other side'} jump out early, the game script turns against us fast.`;
  }
  if (s.market === 'total') return s.side === 'over' ? `Risk: a slow start or a blowout where starters sit kills an over.` : `Risk: overtime, or a high-scoring first half, would bury the under.`;
  if (s.market === 'prop') return `Risk: minutes. If the game gets lopsided or the rotation changes, the volume dries up.`;
  if (f.injuries?.length) return `Risk: late injury news. If the status of a listed player changes, the edge can disappear.`;
  return `Risk: the market is usually right; if this line moves against us before kick-off, the edge was probably noise.`;
}

export function buildWriteup(f: WriteupFacts): Writeup {
  const picked = candidates(f).slice(0, 3);
  if (!picked.length) {
    picked.push({ id: 'books', score: 0, text: `${f.book} has the best price of the ${f.booksChecked} book${f.booksChecked === 1 ? '' : 's'} we checked for this market.` });
  }
  return { edge: edgeSentence(f), reasons: picked.map((p) => p.text), risk: riskSentence(f), drivers: picked.map((p) => p.id) };
}
