import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Sport } from '@/core/types';
import { snapshotFromRaw, type RawSportDump, type SportSnapshot } from './kalshi';
import { fixturesDir } from './root';

export function kalshiFixtureSnapshot(sport: Sport): SportSnapshot | null {
  const f = path.join(fixturesDir(), 'kalshi', `${sport}.json`);
  if (!existsSync(f)) return null;
  return snapshotFromRaw(JSON.parse(readFileSync(f, 'utf8')) as RawSportDump, 'fixture');
}

export function oddsFixtureFile(sport: Sport): { recordedAt: string; batches: unknown[] } | null {
  const f = path.join(fixturesDir(), 'odds', `${sport}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
