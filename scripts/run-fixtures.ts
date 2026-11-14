import { readFileSync } from 'node:fs';
import { runPipeline, valueRows } from '../src/core/pipeline';
import { SPORTS, type Sport } from '../src/core/types';
import { snapshotFromRaw } from '../src/server/kalshi';
const only = process.argv[2] as Sport | undefined;
for (const sport of SPORTS) {
  if (only && sport !== only) continue;
  const snap = snapshotFromRaw(JSON.parse(readFileSync(`fixtures/kalshi/${sport}.json`, 'utf8')), 'fixture');
  const odds = JSON.parse(readFileSync(`fixtures/odds/${sport}.json`, 'utf8'));
  const t0 = performance.now();
  const out = runPipeline({ sport, games: snap.games, odds: odds.batches, now: new Date(snap.fetchedAt) });
  const ms = performance.now() - t0;
  const priced = out.games.filter((g) => g.status === 'priced').length;
  const rows = valueRows(out.games);
  console.log(`== ${sport}: kalshi=${snap.games.length} matched=${out.report.matches.length} priced=${priced} oddsEvents=${odds.batches.reduce((a: number, b: any) => a + b.events.length, 0)} unmatchedOdds=${out.report.unmatchedOdds.length} value=${rows.length} ms=${ms.toFixed(0)}`);
  for (const u of out.report.unmatchedOdds.slice(0, 12)) {
    // find kalshi games near that time
    const near = snap.games.filter((g) => Math.abs(Date.parse(g.startTime) - Date.parse(u.commence)) < 3 * 3600e3).map((g) => g.competitors.map((c) => c.name).join(' v ')).slice(0, 0);
    console.log('   unmatched odds:', u.title, u.commence, near.join(' | '));
  }
  for (const r of rows.slice(0, 4)) console.log('   value', r.tier, r.description, 'p', r.prob.toFixed(3), 'ask', r.ask, 'fee', r.fee, 'edge', r.edge.toFixed(3), 'size', r.size);
}
