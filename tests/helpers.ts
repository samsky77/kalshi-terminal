import { readFileSync } from 'node:fs';
import type { OddsBatch } from '../src/core/pipeline';
import type { Sport } from '../src/core/types';
import { snapshotFromRaw, type SportSnapshot } from '../src/server/kalshi';

export function kalshiFixture(sport: Sport): SportSnapshot {
  return snapshotFromRaw(JSON.parse(readFileSync(`fixtures/kalshi/${sport}.json`, 'utf8')), 'fixture');
}
export function rawKalshiFixture(sport: Sport): any {
  return JSON.parse(readFileSync(`fixtures/kalshi/${sport}.json`, 'utf8'));
}
export function oddsFixture(sport: Sport): { recordedAt: string; batches: OddsBatch[]; cost: number; creditsBefore: number; creditsAfter: number } {
  return JSON.parse(readFileSync(`fixtures/odds/${sport}.json`, 'utf8'));
}
