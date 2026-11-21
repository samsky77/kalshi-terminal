/**
 * THE grade rules. The grading code (`gradePick`, the pricer, the worker filters) and the FAQ on the
 * landing page both read this one object, so the two can never disagree. Change a number here and the
 * FAQ text changes with it; `test/grades.test.ts` checks every boundary the FAQ states against the code.
 *
 * Source of truth for the boundaries: the FAQ as published on 2026-11-21 —
 *   "A: expected value of at least 5% and our model and the market consensus both agree the price is
 *    good. B: 2–5% EV. Anything under 2% is shown in grey as “No edge” and never published."
 * The FAQ wins over earlier code: an edge of 5% or more where the model and the consensus do NOT both
 * agree fits neither A nor "B: 2–5%", so it is not graded (earlier code called it B).
 */
export const GRADE_CONFIG = {
  /** A: edge ≥ 5% and the pure model and the pure no-vig consensus both say the price is +EV. */
  A: { minEdge: 0.05, requireAgreement: true },
  /** B: 2% ≤ edge < 5%. */
  B: { minEdge: 0.02, maxEdge: 0.05 },
  /** A graded edge needs this many books pricing both sides of the market. */
  minBooks: { game: 3, prop: 2 },
  /**
   * Alternate lines (any spread/total/prop line other than the market's deepest one) need at least
   * this many books AND this share of the deepest line's books, or they are shown ungraded: thin
   * alternate rungs are where a few high-margin books fake large edges.
   */
  altLine: { minBooks: 5, minShareOfMain: 0.5 },
  /** Above these the price is treated as stale or mis-mapped, not as value: shown ungraded. */
  maxCredibleEdge: { game: 0.10, prop: 0.25 },
  /** |edge| above this is bad data: hidden from the feed and written to `data_anomalies`. */
  sanityCap: 0.25,
  /** Minutes after the book's own last_update before a price is STALE (dimmed, never graded). */
  staleMinutes: 10,
  /** Record-only stake per grade, in units. */
  stake: { A: 2, B: 1 },
} as const;

export type GradeConfig = typeof GRADE_CONFIG;

const p = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** FAQ answer for "What does a grade mean?", rendered from GRADE_CONFIG. */
export function gradeFaqAnswer(c: GradeConfig = GRADE_CONFIG): string {
  return [
    `A: an edge (expected value) of at least ${p(c.A.minEdge)}, and our model and the market consensus both agree the price is good.`,
    `B: an edge of ${p(c.B.minEdge)} up to ${p(c.B.maxEdge)}.`,
    `Anything under ${p(c.B.minEdge)}, or ${p(c.A.minEdge)} and up where the model and the consensus don't both agree, is shown in grey as “No edge” and never published.`,
    `A grade also needs at least ${c.minBooks.game} books pricing the market (${c.minBooks.prop} for player props), and an alternate line (not the main spread, total or prop line) needs at least ${c.altLine.minBooks} books and half as many books as the main line.`,
    `When we have no independent model for a market (the fair price is the market consensus alone), there is nothing to agree with the consensus, so it can be a B but never an A.`,
    `Game-line edges above ${p(c.maxCredibleEdge.game)} and prop edges above ${p(c.maxCredibleEdge.prop)} are almost always a stale or wrong price, so they are not graded.`,
    `Prices more than ${c.staleMinutes} minutes old are marked STALE and get no grade.`,
  ].join(' ');
}

/** The boundaries the FAQ states, for the drift test and the UI legend. */
export function gradeBoundaries(c: GradeConfig = GRADE_CONFIG) {
  return { aMin: c.A.minEdge, bMin: c.B.minEdge, bMax: c.B.maxEdge, staleMinutes: c.staleMinutes };
}
