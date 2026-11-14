// Usage: tsx scripts/record-odds.ts [--spend] [sport]
// Without --spend it only prints the keys and credit cost. With --spend it runs ONE refresh per sport
// through the app's own refresh code path and records the responses as fixtures/odds/<sport>.json.
import './env';
import { readFileSync, writeFileSync } from 'node:fs';
import { SPORTS, type Sport } from '../src/core/types';
import { snapshotFromRaw } from '../src/server/kalshi';
import { keysForGames, oddsStatus, refreshOdds } from '../src/server/odds';

const spend = process.argv.includes('--spend');
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) as Sport | undefined;
(async () => {
  const { credits, sports } = await oddsStatus(true);
  writeFileSync('fixtures/odds/sports.json', JSON.stringify(sports.filter((s) => /^(basketball|americanfootball|icehockey|tennis|soccer)_/.test(s.key)), null, 1));
  console.log('credits before', credits);
  let total = 0;
  for (const sport of SPORTS) {
    if (only && sport !== only) continue;
    const snap = snapshotFromRaw(JSON.parse(readFileSync(`fixtures/kalshi/${sport}.json`, 'utf8')), 'fixture');
    const { keys, unmapped } = keysForGames(sport, snap.games, sports);
    total += keys.length * 3;
    console.log(sport, 'keys', keys.join(','), 'cost', keys.length * 3, unmapped.length ? `unmapped: ${unmapped.join('; ')}` : '');
    if (!spend) continue;
    const r = await refreshOdds(sport, keys);
    console.log(`  ${sport}: before=${r.creditsBefore} after=${r.credits.remaining} expectedCost=${r.cost} events=${r.batches.reduce((a, b) => a + b.events.length, 0)} errors=${r.errors.join('|')}`);
    writeFileSync(`fixtures/odds/${sport}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), kalshiRecordedAt: snap.fetchedAt, keys, cost: r.cost, creditsBefore: r.creditsBefore, creditsAfter: r.credits.remaining, batches: r.batches }));
  }
  console.log('total cost', total);
})().catch((e) => { console.error(e); process.exit(1); });
