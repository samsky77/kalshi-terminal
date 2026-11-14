/** Simulated final scores (home/away) for N runs. */
export interface ScoreRuns {
  home: Int16Array;
  away: Int16Array;
  /** Explicit result when it is not implied by the score (tennis: games != match). 1 home, -1 away, 0 tie. */
  winner?: Int8Array;
}

/** Result of run i: 1 home win, -1 away win, 0 tie. */
export function resultOf(r: ScoreRuns, i: number): number {
  if (r.winner) return r.winner[i];
  const d = r.home[i] - r.away[i];
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** Calibration targets in HOME orientation. All optional except the moneyline. */
export interface Targets {
  pHome: number; // 2-way: P(home wins | no tie). 3-way (soccer): P(home wins)
  pAway: number;
  pDraw?: number;
  spreadLine?: number; // home handicap
  pHomeCover?: number;
  totalLine?: number;
  pOver?: number;
}

/** P(home wins | game not tied) from runs. */
export function pWin2(r: ScoreRuns, n = r.home.length): number {
  let w = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const d = r.home[i] - r.away[i];
    if (d > 0) w++;
    else if (d < 0) l++;
  }
  return w + l ? w / (w + l) : 0.5;
}

/** P(home covers handicap L), pushes excluded. Home covers when margin + L > 0. */
export function pCover(r: ScoreRuns, L: number, n = r.home.length): number {
  let c = 0, nc = 0;
  for (let i = 0; i < n; i++) {
    const x = r.home[i] - r.away[i] + L;
    if (x > 1e-9) c++;
    else if (x < -1e-9) nc++;
  }
  return c + nc ? c / (c + nc) : 0.5;
}

/** P(total > line), pushes excluded. */
export function pOver(r: ScoreRuns, line: number, n = r.home.length): number {
  let o = 0, u = 0;
  for (let i = 0; i < n; i++) {
    const t = r.home[i] + r.away[i];
    if (t > line + 1e-9) o++;
    else if (t < line - 1e-9) u++;
  }
  return o + u ? o / (o + u) : 0.5;
}

/** Fractional part, used to derive extra uniforms from a stored one (golden-ratio rotation). */
export function rot(u: number, k: number): number {
  const v = u + k * 0.6180339887498949;
  const f = v - Math.floor(v);
  return Math.min(Math.max(f, 1e-9), 1 - 1e-9);
}
