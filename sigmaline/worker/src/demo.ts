/**
 * LOCAL DEMO ONLY. Builds `app/.data/demo-db.json` from the recorded fixture odds so the app can
 * be previewed without any keys. It replays the pipeline on a fake clock: yesterday's copy of the
 * slate is published 80 minutes before each start, closing lines are captured, and final scores
 * are SAMPLED FROM THE MODEL (not real results) so the Results page has something to show.
 * The app shows a "DEMO DATA" banner whenever it runs on this file database; this data can never
 * reach Supabase (the worker refuses file databases outside this command).
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SportId } from '@sigmaline/core';
import { fileMemoryDb, getEvents, MemoryDb } from '@sigmaline/db';
import { makeCtx } from './context';
import { captureClosing, gradePicks } from './grade';
import { simulateEvent } from './simulate';
import { tick } from './tick';

const here = dirname(fileURLToPath(import.meta.url));
const RECORDED_AT = Date.parse('2026-11-14T03:08:00Z');
const DEMO_SPORTS: SportId[] = ['nba', 'nhl', 'nfl', 'cbb', 'cfb', 'soccer', 'tennis'];

export async function runDemo(fixtures: string, out = resolve(here, '../../app/.data/demo-db.json')): Promise<void> {
  if (existsSync(out)) rmSync(out);
  // Work in memory (fast), write the file once at the end.
  const db = new MemoryDb();
  const realNow = Date.now();
  const env = { DEMO: '1', PROPS_NBA_ENABLED: 'false', PROPS_NFL_ENABLED: 'false' };
  await db.upsert('settings', { key: 'demo', value: true }, 'key');

  // Phase 1: "yesterday" — the recorded slate shifted to 30 hours ago, replayed hour by hour.
  const pastShift = realNow - RECORDED_AT - 30 * 3600000;
  let clock = new Date(RECORDED_AT + pastShift - 3 * 3600000);
  const ctxPast = await makeCtx(db, env, { now: () => clock, fixturesDir: fixtures, fixtureShiftMs: pastShift });
  await tick(ctxPast, { sports: DEMO_SPORTS });
  const evs = (await getEvents(db, { from: clock.toISOString(), to: new Date(realNow - 4 * 3600000).toISOString() }))
    .filter((e) => e.sport_id !== 'cbb' || Number.parseInt(e.id.slice(-2), 16) % 4 === 0); // thin CBB for speed
  const times = [...new Set(evs.map((e) => e.commence_time))].sort();
  for (const t of times) {
    for (const offset of [80, 10]) {
      clock = new Date(Date.parse(t) - offset * 60000);
      await tick(ctxPast, { sports: [...new Set(evs.filter((e) => e.commence_time === t).map((e) => e.sport_id))] });
    }
    await captureClosing(ctxPast, evs.filter((e) => e.commence_time === t).map((e) => e.id));
  }
  // DEMO results: sample one simulated final per game from the model's own distribution.
  for (const e of await getEvents(db, { to: new Date(realNow - 4 * 3600000).toISOString(), status: ['scheduled'] })) {
    const s = await simulateEvent(ctxPast, e);
    if (!s) continue;
    const i = (Number.parseInt(e.id.slice(-6), 16) * 7919) % s.samples.n;
    const hs = s.samples.home[i], as = s.samples.away[i];
    await db.update('events', { id: e.id }, { status: 'final', home_score: hs, away_score: as, winner: s.samples.winner[i], final_at: new Date(Date.parse(e.commence_time) + 3 * 3600000).toISOString(), meta: { ...e.meta, demo_result: true } });
  }
  clock = new Date(realNow);
  await gradePicks(ctxPast);

  // Phase 2: today's slate (the same recording shifted so its games are upcoming now).
  const nowShift = realNow - RECORDED_AT + 2 * 3600000;
  const ctxNow = await makeCtx(db, env, { now: () => new Date(Date.now()), fixturesDir: fixtures, fixtureShiftMs: nowShift });
  await db.upsert('settings', { key: 'last_refresh', value: {} }, 'key');
  await tick(ctxNow, { sports: DEMO_SPORTS });

  const file = await fileMemoryDb(out);
  file.tables = db.tables;
  await file.upsert('settings', { key: 'demo', value: true }, 'key');
  const picks = (db.tables.picks ?? []).length, results = (db.tables.pick_results ?? []).length;
  console.log(`DEMO database written to ${out}: ${(db.tables.events ?? []).length} events, ${picks} picks, ${results} graded (results sampled from the model — not real).`);
}
