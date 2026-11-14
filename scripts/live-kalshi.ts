// Acceptance check 2: live run against Kalshi. For each sport with games in the next 48 hours, list open
// game-winner, spread and total markets, and assert zero parlays / excluded scopes.
import { SPORTS } from '../src/core/types';
import { loadSport } from '../src/server/kalshi';

const PARLAY = /MVE|PARLAY|COMBO|,/;
(async () => {
  let failed = false;
  const now = Date.now(), horizon = now + 48 * 3600e3;
  for (const sport of SPORTS) {
    const snap = await loadSport(sport);
    const games = snap.games.filter((g) => Date.parse(g.startTime) >= now - 3 * 3600e3 && Date.parse(g.startTime) <= horizon);
    const count = { winner: 0, spread: 0, total: 0, tie: 0 } as Record<string, number>;
    let parlays = 0;
    for (const g of games) for (const c of g.contracts) {
      count[c.kind]++;
      if (PARLAY.test(c.ticker) || PARLAY.test(c.seriesTicker)) parlays++;
    }
    const withAll = games.filter((g) => ['winner', 'spread', 'total'].every((k) => g.contracts.some((c) => c.kind === k))).length;
    console.log(`${sport.padEnd(7)} games(48h)=${String(games.length).padStart(3)}  with ML+spread+total=${String(withAll).padStart(3)}  markets: ML ${count.winner}, spread ${count.spread}, total ${count.total}, tie ${count.tie}  parlays=${parlays}  series=${snap.series.map((s) => s.ticker).join(',')}`);
    for (const g of games.slice(0, 2)) console.log(`         e.g. ${g.title} @ ${g.startTime}: ${g.eventTickers.join(' ')}`);
    if (parlays) failed = true;
    if (games.length && !games.some((g) => g.contracts.some((c) => c.kind === 'winner'))) failed = true;
  }
  console.log(failed ? 'FAIL' : 'PASS: zero parlays; every sport with games in 48h lists open markets');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
