import { readFileSync } from 'node:fs';
import { runPipeline } from '../src/core/pipeline';
import { SPORTS } from '../src/core/types';
import { snapshotFromRaw } from '../src/server/kalshi';
for (const sport of SPORTS) {
  const snap = snapshotFromRaw(JSON.parse(readFileSync(`fixtures/kalshi/${sport}.json`, 'utf8')), 'fixture');
  const odds = JSON.parse(readFileSync(`fixtures/odds/${sport}.json`, 'utf8'));
  const out = runPipeline({ sport, games: snap.games, odds: odds.batches, now: new Date(0) });
  let n = 0, mlOk = 0, spOk = 0, spN = 0, toOk = 0, toN = 0; const bad: string[] = [];
  for (const g of out.games) {
    if (!g.sim || !g.consensus) continue; n++;
    const c = g.consensus, s = g.sim;
    const simMl = c.pDraw !== undefined ? s.pHomeWin : s.pHomeWin / (s.pHomeWin + s.pAwayWin);
    const tgt = c.pDraw !== undefined ? c.pHome : c.pHome / (c.pHome + c.pAway);
    const e = Math.abs(simMl - tgt); if (e <= 0.01) mlOk++; else bad.push(`${g.awayName}@${g.homeName} ml ${tgt.toFixed(3)} sim ${simMl.toFixed(3)} spr ${c.spreadLine} ${c.pHomeCover?.toFixed(3)} fixed=${s.params.sigmaFixed}`);
    if (s.pHomeCoverMain !== undefined) { spN++; if (Math.abs(s.pHomeCoverMain - 0.5) <= 0.02 || Math.abs(s.pHomeCoverMain - c.pHomeCover!) <= 0.02) spOk++; }
    if (s.pOverMain !== undefined) { toN++; if (Math.abs(s.pOverMain - 0.5) <= 0.02 || Math.abs(s.pOverMain - c.pOver!) <= 0.02) toOk++; }
  }
  console.log(sport, `games=${n} ml<=1pt ${mlOk}/${n} spread ${spOk}/${spN} total ${toOk}/${toN}`);
  for (const b of bad.slice(0, 4)) console.log('   ', b);
}
