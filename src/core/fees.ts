import type { FeeInfo } from './types';

/** Kalshi general taker fee rate (fee schedule): fee = roundup(0.07 x C x P x (1-P)). */
export const TAKER_RATE = 0.07;
/** Maker rate on `quadratic_with_maker_fees` series. Not used for edge (we price taking the ask). */
export const MAKER_RATE = 0.0175;

/** Round up to the next whole cent, tolerant of floating-point noise. */
export function ceilCents(dollars: number): number {
  return Math.ceil(dollars * 100 - 1e-9) / 100;
}

/**
 * Taker fee in dollars for `contracts` contracts bought at `price` dollars.
 * Uses the series' fee_type/fee_multiplier from GET /series. Unknown or missing fee data
 * falls back to the default round-up(0.07 x C x P x (1-P)).
 */
export function takerFee(price: number, contracts = 1, fee?: FeeInfo): number {
  if (price <= 0 || price >= 1 || contracts <= 0) return 0;
  const mult = fee && Number.isFinite(fee.feeMultiplier) ? fee.feeMultiplier : 1;
  const type = fee?.feeType ?? 'quadratic';
  if (type === 'flat') return ceilCents(mult * contracts); // not seen on sports series; kept conservative
  if (type === 'none' || mult === 0) return 0;
  // 'quadratic' and 'quadratic_with_maker_fees' share the taker formula.
  return ceilCents(TAKER_RATE * mult * contracts * price * (1 - price));
}

/** Per-contract taker fee as charged on a 1-lot order (the most conservative per-contract cost). */
export function feePerContract(price: number, fee?: FeeInfo): number {
  return takerFee(price, 1, fee);
}
