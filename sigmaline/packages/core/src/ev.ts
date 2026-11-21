import { breakEvenDecimal, edgePct } from './edge';
import { GRADE_CONFIG } from './grades';
import type { Grade, OutcomeProbs } from './types';

export interface GradeThresholds {
  /** EV for an A (default 0.05). */
  a: number;
  /** EV for a B (default 0.02). Below this: no edge. */
  b: number;
}
/** Derived from GRADE_CONFIG (the single source of truth); kept for older call sites. */
export const DEFAULT_THRESHOLDS: GradeThresholds = { a: GRADE_CONFIG.A.minEdge, b: GRADE_CONFIG.B.minEdge };

export const W_MIN = 0.15;
export const W_MAX = 0.6;
export const W_DEFAULT = 0.35;

export function clampW(w: number): number {
  return Math.min(W_MAX, Math.max(W_MIN, w));
}

/** Probability of winning given the bet doesn't push. */
export function conditionalWin(o: OutcomeProbs): number {
  const d = o.win + o.loss;
  return d > 0 ? o.win / d : NaN;
}

/**
 * p_fair = w·p_model + (1−w)·p_consensus (spec §5), applied to the no-push win probability
 * because book prices (and so the no-vig consensus) are conditional on no push. The model's
 * push probability is kept.
 */
export function blendFair(model: OutcomeProbs, pConsensus: number, w: number): OutcomeProbs {
  const ww = clampW(w);
  const m = conditionalWin(model);
  const c = Number.isFinite(pConsensus) ? ww * m + (1 - ww) * pConsensus : m;
  const np = 1 - model.push;
  return { win: c * np, push: model.push, loss: (1 - c) * np };
}

/** EV per unit staked: p_win·decimal + p_push − 1 (= p·decimal − 1 when no push is possible). */
export function expectedValue(fair: OutcomeProbs, decimal: number): number {
  return edgePct(fair.win, decimal, fair.push);
}

/** Decimal price at which EV is exactly zero. */
export function fairDecimal(fair: OutcomeProbs): number {
  return breakEvenDecimal(fair.win, fair.push);
}

/**
 * Grades come only from GRADE_CONFIG (see grades.ts and the FAQ):
 *   A: edge ≥ 5% AND both the pure model and the pure consensus say the price is +EV.
 *   B: 2% ≤ edge < 5%.
 *   Otherwise (including ≥ 5% without agreement): no edge.
 * The `t` argument is ignored for the boundaries; it exists only so old call sites still compile.
 */
export function gradePick(ev: number, modelEv: number, consensusEv: number, _t?: GradeThresholds): Grade {
  void _t;
  const c = GRADE_CONFIG;
  if (!Number.isFinite(ev)) return 'none';
  if (ev >= c.A.minEdge && (!c.A.requireAgreement || (modelEv > 0 && consensusEv > 0))) return 'A';
  if (ev >= c.B.minEdge && ev < c.B.maxEdge) return 'B';
  return 'none';
}

/** Record-only stake (spec §8): A = 2u, B = 1u. */
export function stakeUnits(g: Grade): number {
  return g === 'A' ? GRADE_CONFIG.stake.A : g === 'B' ? GRADE_CONFIG.stake.B : 0;
}

export interface FilterInput {
  snapshotAgeMin: number;
  books: number;
  isProp: boolean;
  /** true if a key player's status is unknown (only when injury data exists). */
  keyPlayerUnknown: boolean;
  /** EV of the candidate; above `maxEv` the price is almost always stale or a data error. */
  ev?: number;
}
export interface FilterResult { ok: boolean; reasons: string[] }

/** Pick filters (spec §5). A pick failing any of these is never published. */
export const MAX_CREDIBLE_EV = GRADE_CONFIG.sanityCap;

export function pickFilters(f: FilterInput, maxAgeMin = 90): FilterResult {
  const reasons: string[] = [];
  if (f.ev !== undefined && f.ev > MAX_CREDIBLE_EV) reasons.push(`EV above ${MAX_CREDIBLE_EV * 100}% (price is probably stale or wrong)`);
  if (!(f.snapshotAgeMin <= maxAgeMin)) reasons.push(`price snapshot older than ${maxAgeMin} min`);
  const minBooks = f.isProp ? GRADE_CONFIG.minBooks.prop : GRADE_CONFIG.minBooks.game;
  if (f.books < minBooks) reasons.push(`only ${f.books} book(s) priced this market (need ${minBooks})`);
  if (f.keyPlayerUnknown) reasons.push('a key player status is unknown');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Closing line value: EV of the price taken measured against the no-vig closing consensus,
 * i.e. p_close × decimal_taken − 1 (push-adjusted). Positive = you beat the close.
 */
export function clv(takenDecimal: number, closeConditionalWin: number, pushProb = 0): number {
  return edgePct(closeConditionalWin * (1 - pushProb), takenDecimal, pushProb);
}
