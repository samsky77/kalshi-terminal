import { describe, expect, it } from 'vitest';
import { feePerContract, takerFee } from '../src/core/fees';

// Kalshi fee schedule, general markets: fee = round up to the next cent of 0.07 x C x P x (1 - P).
// Rows below are the taker-fee table for 1 and 100 contracts at 5-cent steps. They were written out by
// hand from the published formula: the fee schedule PDF sat behind a bot checkpoint at build time,
// so spot-check a few rows against https://kalshi.com/docs/kalshi-fee-schedule.pdf (see DECISIONS.md).
const TABLE: [number, number, number][] = [
  // price, fee for 1 contract, fee for 100 contracts
  [0.01, 0.01, 0.07],
  [0.05, 0.01, 0.34],
  [0.10, 0.01, 0.63],
  [0.15, 0.01, 0.90],
  [0.20, 0.02, 1.12],
  [0.25, 0.02, 1.32],
  [0.30, 0.02, 1.47],
  [0.35, 0.02, 1.60],
  [0.40, 0.02, 1.68],
  [0.45, 0.02, 1.74],
  [0.50, 0.02, 1.75],
  [0.55, 0.02, 1.74],
  [0.60, 0.02, 1.68],
  [0.65, 0.02, 1.60],
  [0.70, 0.02, 1.47],
  [0.75, 0.02, 1.32],
  [0.80, 0.02, 1.12],
  [0.85, 0.01, 0.90],
  [0.90, 0.01, 0.63],
  [0.95, 0.01, 0.34],
  [0.99, 0.01, 0.07],
];

describe('Kalshi taker fees', () => {
  it.each(TABLE)('price %s -> %s per contract, %s per 100', (p, one, hundred) => {
    expect(takerFee(p, 1)).toBeCloseTo(one, 10);
    expect(takerFee(p, 100)).toBeCloseTo(hundred, 10);
  });
  it('uses the series fee_multiplier (e.g. 0.5 halves the rate before rounding)', () => {
    expect(takerFee(0.5, 100, { feeType: 'quadratic', feeMultiplier: 0.5 })).toBeCloseTo(0.88, 10);
    expect(takerFee(0.5, 1, { feeType: 'quadratic_with_maker_fees', feeMultiplier: 1 })).toBeCloseTo(0.02, 10);
  });
  it('defaults to round-up(0.07 x P x (1-P)) when no fee data is published', () => {
    expect(feePerContract(0.37)).toBeCloseTo(0.02, 10);
    expect(feePerContract(0.37, undefined)).toBe(takerFee(0.37, 1, { feeType: 'quadratic', feeMultiplier: 1 }));
  });
  it('is zero at the bounds', () => {
    expect(takerFee(0, 10)).toBe(0);
    expect(takerFee(1, 10)).toBe(0);
  });
});
