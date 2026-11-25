import { describe, expect, it } from 'vitest';
import { isQuotaError, noteProviderError, type Ctx } from '../src/context';

describe('provider quota exhaustion', () => {
  it('recognises The Odds API out-of-credits error and ignores others', () => {
    expect(isQuotaError(new Error('HTTP 401: {"error_code":"OUT_OF_USAGE_CREDITS"}'))).toBe(true);
    expect(isQuotaError(new Error('HTTP 500: boom'))).toBe(false);
  });
  it('marks the provider exhausted for the rest of the run', () => {
    const usage = new Map([['oddsapi', { provider: 'oddsapi', used: 120, limit: 500, period: 'month', periodStart: '' }]]);
    const ctx = { usage, log: () => {} } as unknown as Ctx;
    expect(noteProviderError(ctx, 'oddsapi', new Error('Usage quota has been reached'))).toBe(true);
    expect((usage.get('oddsapi') as { used: number }).used).toBe(500);
    expect(noteProviderError(ctx, 'oddsapi', new Error('HTTP 500'))).toBe(false);
  });
});
