// Records a trimmed live Kalshi snapshot per sport into fixtures/kalshi/<sport>.json.
import { writeFileSync } from 'node:fs';
import { SPORTS } from '../src/core/types';
import { fetchRawSport, snapshotFromRaw } from '../src/server/kalshi';

const only = process.argv[2];
(async () => {
  for (const sport of SPORTS) {
    if (only && only !== sport) continue;
    const raw = await fetchRawSport(sport);
    writeFileSync(`fixtures/kalshi/${sport}.json`, JSON.stringify(raw));
    const snap = snapshotFromRaw(raw, 'fixture');
    console.log(sport, 'series', raw.series.map((s) => s.seriesTicker).join(','), 'games', snap.games.length, 'excluded', snap.excluded.length);
  }
})().catch((e) => { console.error(e); process.exit(1); });
