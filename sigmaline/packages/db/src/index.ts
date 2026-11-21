export * from './db';
export * from './backends';
export * from './repo';
export * from './stats';

import { fileMemoryDb, type Db } from './db';
import { PgDb, SupabaseDb } from './backends';

/**
 * Pick the backend from the environment:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY -> Supabase (production)
 *   DATABASE_URL                              -> Postgres
 *   otherwise                                  -> local JSON file (DEMO only, never a live record)
 */
export async function dbFromEnv(env: Record<string, string | undefined> = process.env): Promise<Db> {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (env.DATABASE_URL) return PgDb.connect(env.DATABASE_URL);
  return fileMemoryDb(env.SIGMALINE_DEMO_DB ?? `${process.cwd()}/.data/demo-db.json`);
}

export function isDemo(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) && !env.DATABASE_URL;
}
export * from './feed';
