/**
 * Edge % — the ONE function every screen, job and test uses.
 *
 *   edge = (fair probability × decimal odds) − 1
 *
 * When the bet can push (integer spreads/totals), the stake comes back on a push, so the push
 * probability is added back: edge = p_win × decimal + p_push − 1. With no push this is exactly the
 * formula above. `fairWin` is the unconditional win probability (win + push + loss = 1).
 */
export function edgePct(fairWin: number, decimal: number, pushProb = 0): number {
  if (!Number.isFinite(fairWin) || !Number.isFinite(decimal) || !(decimal > 1)) return NaN;
  return fairWin * decimal + (Number.isFinite(pushProb) ? pushProb : 0) - 1;
}

/** Decimal price at which the edge is exactly zero (the fair price). */
export function breakEvenDecimal(fairWin: number, pushProb = 0): number {
  return fairWin > 0 ? (1 - pushProb) / fairWin : NaN;
}
