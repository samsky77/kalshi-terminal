import 'server-only';
import { dbFromEnv, isDemo, MemoryDb, type Db } from '@sigmaline/db';

let cached: Promise<Db> | null = null;
let cachedAt = 0;

/** Server-only database handle (service role). In DEMO mode this is the local JSON file. */
export function getDb(): Promise<Db> {
  // The demo file can be rebuilt while the dev server runs; reload it every 30 s.
  if (cached && (!isDemo() || Date.now() - cachedAt < 30000)) return cached;
  cachedAt = Date.now();
  cached = dbFromEnv({ ...process.env, SIGMALINE_DEMO_DB: process.env.SIGMALINE_DEMO_DB ?? `${process.cwd()}/.data/demo-db.json` });
  return cached;
}

export function demoMode(): boolean {
  return isDemo();
}

/** For tests: inject a database. */
export function setDbForTests(db: Db | null) {
  cached = db ? Promise.resolve(db) : null;
  cachedAt = Date.now() + 1e12;
}

export { MemoryDb };
