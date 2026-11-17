/**
 * Worker entry point (run by GitHub Actions):
 *   npm run worker -- tick        every 15 min: pulls, sims, publish, alerts, closing, grading
 *   npm run worker -- nightly     after grading: calibration + retune + model versions
 *   npm run worker -- history     import licensed historical results (nflverse, openfootball)
 *   npm run worker -- backtest    walk-forward backtests -> backtest_runs ("Backtest (simulated)")
 *   npm run worker -- budget      print quota usage and the projected month
 *   npm run worker -- vapid       generate a VAPID key pair for Web Push
 *   npm run worker -- demo        local only: build a DEMO database from recorded fixtures
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SPORTS, type SportId } from '@sigmaline/core';
import { dbFromEnv, finishJob, getEvents, isDemo, startJob } from '@sigmaline/db';
import { notifyError } from './alerts';
import { makeCtx, type Env } from './context';
import { importNfl, importSoccer } from './history';
import { runBacktest, saveBacktest } from './backtest';
import { nightly } from './nightly';
import { tick } from './tick';
import { budgetReport } from './budget';
import { runDemo } from './demo';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = resolve(here, '../../fixtures/odds');

async function main() {
  const [cmd = 'tick', ...rest] = process.argv.slice(2);
  const env = process.env as Env;
  if (cmd === 'vapid') {
    const wp = (await import('web-push')).default;
    const k = wp.generateVAPIDKeys();
    console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nNEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
    return;
  }
  if (cmd === 'demo') { await runDemo(FIXTURES); return; }
  if (isDemo(env) && env.ALLOW_FILE_DB !== '1') {
    throw new Error('No database configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL). For a local preview run `npm run worker -- demo`.');
  }
  const db = await dbFromEnv(env);
  const ctx = await makeCtx(db, env);
  const jobId = await startJob(db, cmd);
  try {
    let detail: unknown;
    const sports = rest.length ? (rest.filter((s) => (SPORTS as string[]).includes(s)) as SportId[]) : undefined;
    if (cmd === 'tick') detail = await tick(ctx, { sports });
    else if (cmd === 'nightly') detail = await nightly(ctx);
    else if (cmd === 'history') detail = { nfl: await importNfl(ctx), soccer: await importSoccer(ctx, ['2022-23', '2023-24', '2024-25', '2025-26']) };
    else if (cmd === 'backtest') {
      const out: Record<string, unknown> = {};
      for (const s of sports ?? SPORTS) {
        const b = await runBacktest(ctx, s);
        const evs = await getEvents(db, { sport: s, status: ['final'] });
        await saveBacktest(ctx, b, s === 'nfl' ? 'nflverse-data (CC BY 4.0)' : s === 'soccer' ? 'openfootball (CC0)' : 'stored results', evs);
        out[s] = { accuracy: b.accuracy && { games: b.accuracy.games, brier: b.accuracy.brier, logLoss: b.accuracy.logLoss }, price: b.price && { ...b.price, curve: undefined } };
      }
      detail = out;
    } else if (cmd === 'budget') detail = await budgetReport(ctx);
    else throw new Error(`unknown command ${cmd}`);
    await finishJob(db, jobId, 'ok', detail);
    console.log(JSON.stringify(detail, null, 2));
  } catch (e) {
    await finishJob(db, jobId, 'error', { message: (e as Error).message, stack: (e as Error).stack }).catch(() => {});
    await notifyError(env, cmd, e);
    throw e;
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
