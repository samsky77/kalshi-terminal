import { propLabel } from './sports';
import type { BetResult, FinalScore, OutcomeProbs, Selection, SimSamples, SportId } from './types';

/** Asian quarter lines (x.25 / x.75) settle as two half-bets on the neighbouring lines. */
export function isQuarterLine(line: number): boolean {
  const f = Math.abs(Math.round(line * 4)) % 2;
  return f === 1;
}

/** Signed "score" for a single (non-quarter) line: >0 win, 0 push, <0 loss. */
function lineMargin(sel: Selection, line: number, home: number, away: number, winner: number, propVal?: number): number {
  switch (sel.market) {
    case 'ml':
      if (sel.side === 'home') return winner;
      if (sel.side === 'away') return -winner;
      return winner === 0 ? 1 : -1; // draw
    case 'spread': {
      const m = home - away;
      return sel.side === 'home' ? m + line : -m + line;
    }
    case 'total': {
      const t = home + away;
      return sel.side === 'over' ? t - line : line - t;
    }
    case 'prop': {
      if (propVal === undefined) return NaN;
      return sel.side === 'over' ? propVal - line : line - propVal;
    }
  }
}

/**
 * 2-way moneylines in sports with ties (NFL) are graded as a push on a tie by US books;
 * soccer is 3-way so a draw loses home/away.
 */
function mlTieIsPush(sport: SportId): boolean {
  return sport === 'nfl';
}

function single(sel: Selection, sport: SportId, line: number, h: number, a: number, w: number, pv?: number): OutcomeProbs {
  const m = lineMargin(sel, line, h, a, w, pv);
  if (Number.isNaN(m)) return { win: 0, push: 1, loss: 0 };
  if (sel.market === 'ml' && sel.side !== 'draw' && w === 0) {
    return mlTieIsPush(sport) ? { win: 0, push: 1, loss: 0 } : { win: 0, push: 0, loss: 1 };
  }
  if (m > 1e-9) return { win: 1, push: 0, loss: 0 };
  if (m < -1e-9) return { win: 0, push: 0, loss: 1 };
  return { win: 0, push: 1, loss: 0 };
}

/** Outcome of `sel` for one final score, as win/push/loss fractions (halves on quarter lines). */
export function settleFractions(sel: Selection, sport: SportId, h: number, a: number, w: number, pv?: number): OutcomeProbs {
  const line = sel.line ?? 0;
  if (sel.market !== 'ml' && isQuarterLine(line)) {
    const lo = single(sel, sport, line - 0.25, h, a, w, pv);
    const hi = single(sel, sport, line + 0.25, h, a, w, pv);
    return { win: (lo.win + hi.win) / 2, push: (lo.push + hi.push) / 2, loss: (lo.loss + hi.loss) / 2 };
  }
  return single(sel, sport, line, h, a, w, pv);
}

export function propKey(player: string, stat: string): string {
  return `${player}|${stat}`;
}

/**
 * Read a selection's probabilities off the joint simulated distribution. Because every market for a
 * game is read from the same samples, moneyline, spread and total are consistent by construction.
 */
export function priceSelection(s: SimSamples, sel: Selection, sport: SportId): OutcomeProbs {
  let win = 0, push = 0, loss = 0;
  const pv = sel.market === 'prop' && sel.player && sel.stat ? s.props?.[propKey(sel.player, sel.stat)] : undefined;
  if (sel.market === 'prop' && !pv) return { win: NaN, push: NaN, loss: NaN };
  for (let i = 0; i < s.n; i++) {
    const o = settleFractions(sel, sport, s.home[i], s.away[i], s.winner[i], pv ? pv[i] : undefined);
    win += o.win; push += o.push; loss += o.loss;
  }
  return { win: win / s.n, push: push / s.n, loss: loss / s.n };
}

/** Grade a logged bet from the official final. */
export function gradeBet(sel: Selection, sport: SportId, final: FinalScore): BetResult {
  const w = final.winner ?? Math.sign(final.home - final.away);
  let pv: number | undefined;
  if (sel.market === 'prop') {
    pv = sel.player && sel.stat ? final.props?.[propKey(sel.player, sel.stat)] : undefined;
    if (pv === undefined) return 'void';
  }
  const o = settleFractions(sel, sport, final.home, final.away, w, pv);
  if (o.win === 1) return 'win';
  if (o.loss === 1) return 'loss';
  if (o.push === 1) return 'push';
  if (o.win === 0.5) return 'half_win';
  if (o.loss === 0.5) return 'half_loss';
  return 'push';
}

/** Profit in units for a stake at decimal odds. */
export function profitUnits(result: BetResult, stake: number, decimal: number): number {
  switch (result) {
    case 'win': return stake * (decimal - 1);
    case 'half_win': return (stake * (decimal - 1)) / 2;
    case 'loss': return -stake;
    case 'half_loss': return -stake / 2;
    default: return 0;
  }
}

export function selectionLabel(sel: Selection, home: string, away: string): string {
  const team = sel.side === 'home' ? home : sel.side === 'away' ? away : '';
  const ln = (x: number) => (x > 0 ? `+${x}` : x === 0 ? 'PK' : `−${Math.abs(x)}`);
  switch (sel.market) {
    case 'ml': return sel.side === 'draw' ? 'Draw' : `${team} ML`;
    case 'spread': return `${team} ${ln(sel.line ?? 0)}`;
    case 'total': return `${sel.side === 'over' ? 'Over' : 'Under'} ${sel.line}`;
    case 'prop': {
      // "1 or more" markets (anytime scorer / TD) read as Yes / No.
      if (sel.line === 0.5 && /anytime|goals$|_td$/.test(sel.stat ?? '')) return `${sel.player} ${propLabel(sel.stat)}${/anytime/.test(sel.stat ?? '') ? '' : ' 1+'}: ${sel.side === 'over' ? 'Yes' : 'No'}`;
      return `${sel.player} ${sel.side === 'over' ? 'Over' : 'Under'} ${sel.line} ${propLabel(sel.stat)}`;
    }
  }
}

/** Stable identifier for a selection, used as a DB key. */
export function selectionKey(sel: Selection): string {
  return [sel.market, sel.side, sel.line ?? '', sel.player ?? '', sel.stat ?? ''].join(':');
}
