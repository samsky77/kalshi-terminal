import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clv, edgePct, expectedValue, gradeFaqAnswer, gradePick, GRADE_CONFIG, stakeUnits } from '../src';

/** Every percentage the FAQ answer states, in order of appearance, as fractions. */
function faqPercents(): number[] {
  return [...gradeFaqAnswer().matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
}

describe('edge % — one shared function', () => {
  it('is fair probability × decimal odds − 1 (hand-worked cases)', () => {
    expect(edgePct(0.5, 2.1)).toBeCloseTo(0.05, 12); // 50% at +110
    expect(edgePct(0.55, 1.909091)).toBeCloseTo(0.05, 5); // 55% at −110
    expect(edgePct(0.4, 2.5)).toBeCloseTo(0, 12); // 40% at +150 is exactly fair
    expect(edgePct(0.25, 3.5)).toBeCloseTo(-0.125, 12); // 25% at +250
    expect(edgePct(0.6, 1.5)).toBeCloseTo(-0.1, 12);
  });
  it('adds the stake back on a push', () => {
    // win 48%, push 4%, loss 48% at −110: 0.48 × 1.909091 + 0.04 − 1
    expect(edgePct(0.48, 1.909091, 0.04)).toBeCloseTo(0.48 * 1.909091 + 0.04 - 1, 9);
  });
  it('rejects bad prices', () => {
    expect(Number.isNaN(edgePct(0.5, 1))).toBe(true);
    expect(Number.isNaN(edgePct(NaN, 2))).toBe(true);
  });
  it('expectedValue and clv both delegate to it', () => {
    expect(expectedValue({ win: 0.5, push: 0, loss: 0.5 }, 2.1)).toBe(edgePct(0.5, 2.1));
    expect(clv(2.1, 0.5)).toBe(edgePct(0.5, 2.1));
  });
});

describe('grades match the FAQ', () => {
  it('the FAQ states exactly the configured boundaries, in order', () => {
    const c = GRADE_CONFIG;
    expect(faqPercents()).toEqual([
      c.A.minEdge, c.B.minEdge, c.B.maxEdge, c.B.minEdge, c.A.minEdge, c.maxCredibleEdge.game, c.maxCredibleEdge.prop,
    ]);
    expect(gradeFaqAnswer()).toContain(`at least ${c.minBooks.game} books`);
    expect(gradeFaqAnswer()).toContain(`${c.staleMinutes} minutes`);
  });
  it('the published FAQ boundaries are 5% / 2% / 5% (source of truth)', () => {
    expect(GRADE_CONFIG.A.minEdge).toBe(0.05);
    expect(GRADE_CONFIG.B.minEdge).toBe(0.02);
    expect(GRADE_CONFIG.B.maxEdge).toBe(0.05);
  });
  it('code grades every boundary the way the FAQ says', () => {
    const agree = [0.01, 0.01] as const, disagree = [-0.01, 0.01] as const;
    expect(gradePick(0.0199, ...agree)).toBe('none');
    expect(gradePick(0.02, ...agree)).toBe('B');
    expect(gradePick(0.0499, ...agree)).toBe('B');
    expect(gradePick(0.02, ...disagree)).toBe('B');
    expect(gradePick(0.05, ...agree)).toBe('A');
    expect(gradePick(0.09, ...agree)).toBe('A');
    // ≥ 5% without agreement is neither A nor "B: 2–5%"
    expect(gradePick(0.05, ...disagree)).toBe('none');
    expect(gradePick(0.08, 0.01, -0.01)).toBe('none');
    expect(gradePick(NaN, ...agree)).toBe('none');
  });
  it('stakes come from the config', () => {
    expect(stakeUnits('A')).toBe(GRADE_CONFIG.stake.A);
    expect(stakeUnits('B')).toBe(GRADE_CONFIG.stake.B);
  });
  it('the landing page FAQ renders from the config, not a hard-coded string', () => {
    const page = readFileSync(new URL('../../../app/src/app/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('gradeFaqAnswer()');
    expect(page).not.toMatch(/B: 2–5%/);
  });
});
