import { PROP_MARKETS, quotesFromEvent, priceMarkets, filterFeed, selectionLabel, buildWriteup, simulateProps, propLabel, createRng, gradeBet, settleFractions, type SimSamples } from '/home/user/kalshi-terminal/sigmaline/packages/core/src';
const NOW = Date.parse('2026-11-21T18:00:00Z');
const iso = (m: number) => new Date(NOW - m * 60000).toISOString();
const books = ['draftkings', 'fanduel', 'betmgm', 'caesars'];
const bettable = new Set(books);
const n = 4000, rng = createRng(7);
const game: SimSamples = { n, home: new Int16Array(n), away: new Int16Array(n), winner: new Int8Array(n) };
for (let i = 0; i < n; i++) { const h = Math.max(0, Math.round(24 + 10 * rng.normal())), a = Math.max(0, Math.round(21 + 10 * rng.normal())); game.home[i] = h; game.away[i] = a; game.winner[i] = Math.sign(h - a) as any; }
const mk = (stat: string, player: string, line: number | null, rows: [string, number, number, number?][], yesno = false) => ({
  key: stat, outcomes: [] as any[], rows, player, line, yesno,
});
function ev(markets: { stat: string; player: string; line: number | null; rows: [string, number, number, (number | string)?][]; yesno?: boolean; supp?: boolean }[]) {
  const bk: Record<string, any> = {};
  for (const m of markets) for (const [b, o, u, ts] of m.rows) {
    bk[b] ??= { key: b, markets: [] };
    const t = typeof ts === 'number' ? iso(ts) : iso(1);
    const outs: any[] = m.yesno
      ? [{ name: 'Yes', price: o, description: m.player }, { name: 'No', price: u, description: m.player }]
      : [{ name: 'Over', price: o, point: m.line, description: m.player }, { name: 'Under', price: u, point: m.line, description: m.player }];
    if (m.supp && b === 'betmgm') outs[0].suspended = true;
    bk[b].markets.push({ key: m.stat, last_update: t, outcomes: outs });
  }
  return { id: 'FAKE-1', sport_key: 'americanfootball_nfl', commence_time: new Date(NOW + 3600000).toISOString(), home_team: 'Fake Home', away_team: 'Fake Away', bookmakers: Object.values(bk) };
}
const sets: any[] = [];
const std = (stat: string, player: string, line: number) => ({ stat, player, line, rows: [['draftkings', 2.2, 1.7], ['fanduel', 1.95, 1.87], ['betmgm', 1.9, 1.9], ['caesars', 1.91, 1.9]] as any });
for (const [s, p, l] of [['player_pass_yds', 'Fake QB', 249.5], ['player_pass_tds', 'Fake QB', 1.5], ['player_pass_completions', 'Fake QB', 21.5], ['player_pass_attempts', 'Fake QB', 33.5], ['player_pass_interceptions', 'Fake QB', 0.5], ['player_rush_yds', 'Fake RB', 64.5], ['player_rush_attempts', 'Fake RB', 15.5], ['player_receptions', 'Fake WR', 5.5], ['player_reception_yds', 'Fake WR', 68.5]] as const) sets.push(std(s, p, l));
sets.push({ stat: 'player_anytime_td', player: 'Fake RB', line: null, yesno: true, rows: [['draftkings', 2.5, 1.5], ['fanduel', 2.3, 1.6], ['betmgm', 2.4, 1.55]] });
// alternate rungs
sets.push({ stat: 'player_pass_yds', player: 'Fake QB', line: 274.5, rows: [['draftkings', 3.0, 1.35], ['fanduel', 2.8, 1.4]] });
sets.push({ stat: 'player_pass_yds', player: 'Fake QB', line: 299.5, rows: [['draftkings', 5.0, 1.15]] });
// one book only
sets.push({ stat: 'player_receptions', player: 'Fake TE', line: 4.5, rows: [['draftkings', 2.6, 1.5]] });
// stale best
sets.push({ stat: 'player_rush_yds', player: 'Stale RB', line: 50.5, rows: [['draftkings', 2.6, 1.5, 60], ['fanduel', 1.9, 1.9, 1], ['betmgm', 1.9, 1.9, 1]] });
// stale book only in consensus (best is fresh)
sets.push({ stat: 'player_receptions', player: 'Stale Consensus WR', line: 6.5, rows: [['draftkings', 2.1, 1.75, 1], ['fanduel', 1.5, 2.6, 90], ['betmgm', 1.5, 2.6, 90]] });
// suspended
sets.push({ stat: 'player_pass_tds', player: 'Susp QB', line: 2.5, supp: true, rows: [['draftkings', 2.2, 1.7], ['fanduel', 1.95, 1.87], ['betmgm', 1.9, 1.9]] });
// big edge
sets.push({ stat: 'player_rush_yds', player: 'Big Edge RB', line: 80.5, rows: [['draftkings', 3.5, 1.3], ['fanduel', 1.9, 1.9], ['betmgm', 1.9, 1.9]] });
// anytime TD yes-only (typical real feed)
const yesOnly = { stat: 'player_anytime_td', player: 'YesOnly WR', line: null, yesno: false, rows: [] as any };
const e = ev(sets);
// add Yes-only anytime TD
for (const b of ['draftkings', 'fanduel', 'betmgm']) e.bookmakers!.find((x: any) => x.key === b)!.markets.push({ key: 'player_anytime_td', last_update: iso(1), outcomes: [{ name: 'Yes', price: b === 'draftkings' ? 4 : 3.6, description: 'YesOnly WR' }] } as any);
// american price format check and a nonexistent-key
const stats = { suspended: 0 };
const quotes = quotesFromEvent(e as any, 'decimal', iso(0), stats);
console.log('quotes', quotes.length, 'suspended', stats.suspended);
const run = (withSim: boolean) => {
  const s = { ...game };
  if (withSim) simulateProps(s, [
    { player: 'Fake QB', stat: 'player_pass_yds', team: 'home', mean: 262, dispersion: 20, beta: 0.8 },
    { player: 'Fake RB', stat: 'player_anytime_td', team: 'home', mean: 0.45, dispersion: 60, beta: 0.7 },
    { player: 'Fake WR', stat: 'player_receptions', team: 'away', mean: 6.6, dispersion: 10, beta: 0.6 },
  ], 24, 21, 5);
  const priced = priceMarkets(s, quotes, { sport: 'nfl', threeWay: false, bettable, w: {} });
  const f = filterFeed(priced, { nowMs: NOW, commenceMs: NOW + 3600000 });
  return { priced, f };
};
for (const sim of [false, true]) {
  const { priced, f } = run(sim);
  console.log('\n=== sim', sim, 'priced', priced.length, 'keep', f.keep.length, 'stale', f.stale.length, 'anom', f.anomalies.length, JSON.stringify(f.counts));
  for (const p of priced) {
    const st = f.stale.includes(p) ? 'STALE' : f.anomalies.includes(p) ? 'ANOM' : f.keep.includes(p) ? 'keep' : 'DROP';
    const chk = p.bestDecimal * p.fair.win + p.fair.push - 1;
    console.log(st.padEnd(5), selectionLabel(p.selection, 'H', 'A').padEnd(42), 'bk', p.books, p.bestBook, p.bestDecimal.toFixed(2), 'cP', p.consensusP.toFixed(3), 'fair', p.fairDecimal.toFixed(2), 'ev', p.ev.toFixed(3), 'chk', chk.toFixed(3), p.fairSource, 'g=' + p.grade, 'mEv', p.modelEv.toFixed(3), 'cEv', p.consensusEv.toFixed(3));
  }
}
// writeup for an NFL prop
const { f } = run(true);
const pick = f.keep.find((p) => p.selection.player === 'Fake QB' && p.selection.stat === 'player_pass_yds')!;
for (const src of ['blend', 'consensus'] as const) {
  const w = buildWriteup({ sport: 'nfl', home: 'Fake Home', away: 'Fake Away', selection: pick.selection, selectionLabel: selectionLabel(pick.selection, 'Fake Home', 'Fake Away'), bestDecimal: pick.bestDecimal, book: pick.bestBook!, modelP: pick.model.win, consensusP: pick.consensusP, fairP: pick.fair.win, ev: pick.ev, booksChecked: pick.books, fairSource: src, propMean: src === 'blend' ? 262 : undefined, modelIndependent: true });
  console.log('\nWRITEUP', src, JSON.stringify(w, null, 1));
}
// anytime TD writeup w/ no propMean, sim
const td = f.keep.find((p) => p.selection.stat === 'player_anytime_td' && p.selection.player === 'Fake RB')!;
console.log(JSON.stringify(buildWriteup({ sport: 'nfl', home: 'H', away: 'A', selection: td.selection, selectionLabel: selectionLabel(td.selection, 'H', 'A'), bestDecimal: td.bestDecimal, book: td.bestBook!, modelP: td.model.win, consensusP: td.consensusP, fairP: td.fair.win, ev: td.ev, booksChecked: td.books, fairSource: td.fairSource, propMean: 0.45 }), null, 1));
for (const s of PROP_MARKETS.nfl) console.log(s, '=>', propLabel(s));
// grading with box score values
for (const [stat, line, v] of [['player_pass_tds', 1.5, 2], ['player_anytime_td', 0.5, 1], ['player_pass_yds', 249, 249], ['player_pass_yds', 249.5, 250]] as const) console.log('grade', stat, line, v, gradeBet({ market: 'prop', side: 'over', line, player: 'P', stat }, 'nfl', { home: 20, away: 10, props: { [`P|${stat}`]: v } }));
