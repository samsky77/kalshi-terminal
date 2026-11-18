/**
 * Team ratings from results: opponent-adjusted (fit jointly over every game) and
 * recency-weighted (exponential decay with a half-life in days). Two families:
 *  - points sports (NBA, CBB, NFL, CFB): additive offence/defence in points;
 *  - goal sports (NHL, soccer): multiplicative attack/defence (log-linear Poisson).
 * Walk-forward use: pass only games before the date being predicted (no look-ahead).
 */
export interface GameResult {
  date: string; // ISO
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  neutral?: boolean;
}

export interface PointsRatings {
  kind: 'points';
  base: number; // league mean points per team
  hfa: number; // home advantage (margin)
  off: Record<string, number>;
  def: Record<string, number>; // positive = good defence (allows fewer)
  games: Record<string, number>;
}

export interface GoalsRatings {
  kind: 'goals';
  base: number; // log mean goals
  hfa: number; // log home advantage
  att: Record<string, number>;
  def: Record<string, number>; // positive = good defence
  games: Record<string, number>;
}

function weightOf(date: string, asOf: number, halfLifeDays: number): number {
  const age = (asOf - Date.parse(date)) / 86400000;
  return age < 0 ? 0 : Math.pow(0.5, age / halfLifeDays);
}

export function fitPointsRatings(
  games: GameResult[],
  opts: { asOf: string; halfLifeDays: number; ridge: number; hfaPrior: number },
): PointsRatings {
  const asOf = Date.parse(opts.asOf);
  const rows = games
    .filter((g) => Date.parse(g.date) < asOf)
    .map((g) => ({ ...g, w: weightOf(g.date, asOf, opts.halfLifeDays) }))
    .filter((g) => g.w > 1e-4);
  const off: Record<string, number> = {}, def: Record<string, number> = {}, cnt: Record<string, number> = {};
  for (const g of rows) for (const t of [g.home, g.away]) { off[t] = 0; def[t] = 0; cnt[t] = (cnt[t] ?? 0) + 1; }
  let sw = 0, sp = 0;
  for (const g of rows) { sw += 2 * g.w; sp += g.w * (g.homeScore + g.awayScore); }
  let base = sw ? sp / sw : 0;
  let hfa = opts.hfaPrior;
  for (let it = 0; it < 60; it++) {
    // Offence
    const num: Record<string, number> = {}, den: Record<string, number> = {};
    for (const t of Object.keys(off)) { num[t] = 0; den[t] = opts.ridge; }
    for (const g of rows) {
      const h = g.neutral ? 0 : hfa / 2;
      num[g.home] += g.w * (g.homeScore - base - h + def[g.away]); den[g.home] += g.w;
      num[g.away] += g.w * (g.awayScore - base + h + def[g.home]); den[g.away] += g.w;
    }
    for (const t of Object.keys(off)) off[t] = num[t] / den[t];
    // Defence
    for (const t of Object.keys(def)) { num[t] = 0; den[t] = opts.ridge; }
    for (const g of rows) {
      const h = g.neutral ? 0 : hfa / 2;
      num[g.away] += g.w * (base + h + off[g.home] - g.homeScore); den[g.away] += g.w;
      num[g.home] += g.w * (base - h + off[g.away] - g.awayScore); den[g.home] += g.w;
    }
    for (const t of Object.keys(def)) def[t] = num[t] / den[t];
    // Base and HFA (HFA shrunk toward its prior)
    let rb = 0, rh = 0, wh = 0;
    for (const g of rows) {
      const ph = off[g.home] - def[g.away], pa = off[g.away] - def[g.home];
      rb += g.w * (g.homeScore - ph + g.awayScore - pa);
      if (!g.neutral) { rh += g.w * ((g.homeScore - ph) - (g.awayScore - pa)); wh += g.w; }
    }
    base = sw ? rb / sw : base;
    const prior = 20; // pseudo-games for the HFA prior
    hfa = (rh + prior * opts.hfaPrior) / (wh + prior);
  }
  return { kind: 'points', base, hfa, off, def, games: cnt };
}

export function predictPoints(r: PointsRatings, home: string, away: string, neutral = false): { home: number; away: number } {
  const h = neutral ? 0 : r.hfa / 2;
  return {
    home: r.base + h + (r.off[home] ?? 0) - (r.def[away] ?? 0),
    away: r.base - h + (r.off[away] ?? 0) - (r.def[home] ?? 0),
  };
}

export function fitGoalsRatings(
  games: GameResult[],
  opts: { asOf: string; halfLifeDays: number; ridge: number; hfaPrior: number },
): GoalsRatings {
  const asOf = Date.parse(opts.asOf);
  const rows = games
    .filter((g) => Date.parse(g.date) < asOf)
    .map((g) => ({ ...g, w: weightOf(g.date, asOf, opts.halfLifeDays) }))
    .filter((g) => g.w > 1e-4);
  const att: Record<string, number> = {}, def: Record<string, number> = {}, cnt: Record<string, number> = {};
  for (const g of rows) for (const t of [g.home, g.away]) { att[t] = 0; def[t] = 0; cnt[t] = (cnt[t] ?? 0) + 1; }
  let sw = 0, sg = 0;
  for (const g of rows) { sw += 2 * g.w; sg += g.w * (g.homeScore + g.awayScore); }
  let base = Math.log(Math.max(0.1, sw ? sg / sw : 1));
  let hfa = opts.hfaPrior;
  // ridge acts as pseudo-games at the league mean
  for (let it = 0; it < 80; it++) {
    const gn: Record<string, number> = {}, gd: Record<string, number> = {};
    for (const t of Object.keys(att)) { gn[t] = opts.ridge; gd[t] = opts.ridge; }
    for (const g of rows) {
      const hh = g.neutral ? 0 : hfa;
      gn[g.home] += g.w * g.homeScore; gd[g.home] += g.w * Math.exp(base + hh - def[g.away]);
      gn[g.away] += g.w * g.awayScore; gd[g.away] += g.w * Math.exp(base - def[g.home]);
    }
    for (const t of Object.keys(att)) att[t] = Math.log(gn[t] / gd[t]);
    for (const t of Object.keys(def)) { gn[t] = opts.ridge; gd[t] = opts.ridge; }
    for (const g of rows) {
      const hh = g.neutral ? 0 : hfa;
      // goals conceded vs expected-before-defence
      gn[g.away] += g.w * Math.exp(base + hh + att[g.home]); gd[g.away] += g.w * g.homeScore;
      gn[g.home] += g.w * Math.exp(base + att[g.away]); gd[g.home] += g.w * g.awayScore;
    }
    for (const t of Object.keys(def)) def[t] = Math.log(gn[t] / gd[t]);
    // centre attack so base carries the league mean
    const ks = Object.keys(att);
    if (ks.length) {
      const ma = ks.reduce((s, t) => s + att[t], 0) / ks.length;
      const md = ks.reduce((s, t) => s + def[t], 0) / ks.length;
      for (const t of ks) { att[t] -= ma; def[t] -= md; }
    }
    let on = 0, od = 0, hn = 0, hd = 0;
    for (const g of rows) {
      const lh = Math.exp(base + att[g.home] - def[g.away]);
      const la = Math.exp(base + att[g.away] - def[g.home]);
      on += g.w * (g.homeScore + g.awayScore);
      od += g.w * (lh * (g.neutral ? 1 : Math.exp(hfa)) + la);
      if (!g.neutral) { hn += g.w * g.homeScore; hd += g.w * lh; }
    }
    if (od > 0) base += Math.log(on / od);
    const prior = 30;
    if (hd > 0) hfa = (Math.log(Math.max(1e-6, hn / hd)) * hd + opts.hfaPrior * prior) / (hd + prior);
  }
  return { kind: 'goals', base, hfa, att, def, games: cnt };
}

export function predictGoals(r: GoalsRatings, home: string, away: string, neutral = false): { home: number; away: number } {
  return {
    home: Math.exp(r.base + (neutral ? 0 : r.hfa) + (r.att[home] ?? 0) - (r.def[away] ?? 0)),
    away: Math.exp(r.base + (r.att[away] ?? 0) - (r.def[home] ?? 0)),
  };
}

/** Simple Elo for tennis players (surface-specific ratings are kept under "name|surface"). */
export function eloUpdate(ra: number, rb: number, aWon: boolean, k = 32): [number, number] {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const s = aWon ? 1 : 0;
  return [ra + k * (s - ea), rb - k * (s - ea)];
}
export function eloWinProb(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}
