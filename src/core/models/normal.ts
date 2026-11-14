import { NFL_OT_TIE_RATE, NORMAL_CONSTANTS } from '../sports';
import { bisect, mulberry32, normCdf, normInv, openUniform } from '../stats';
import { pCover, pOver, pWin2, rot, type ScoreRuns, type Targets } from './common';

export type NormalSport = 'nba' | 'ncaab' | 'nfl' | 'ncaaf';

export interface NormalParams {
  mu: number; // mean home margin
  sigma: number; // margin SD (solved)
  tau: number; // mean total (solved)
  sigmaT: number; // total SD (constant)
  rho: number; // margin-total correlation (constant)
  sigmaFixed?: number; // 1 when sigma was held at the constant (ill-conditioned or at a bound)
}

/** Pre-drawn random numbers so calibration and the final run share common random numbers. */
export interface NormalDraws {
  z1: Float64Array;
  z2: Float64Array;
  u3: Float64Array;
  u4: Float64Array;
}

export function drawNormal(n: number, seed: number): NormalDraws {
  const rng = mulberry32(seed);
  const d: NormalDraws = { z1: new Float64Array(n), z2: new Float64Array(n), u3: new Float64Array(n), u4: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    d.z1[i] = normInv(openUniform(rng));
    d.z2[i] = normInv(openUniform(rng));
    d.u3[i] = openUniform(rng);
    d.u4[i] = openUniform(rng);
  }
  return d;
}

/**
 * Score generator. Latent (margin, total) is bivariate normal; the margin is rounded to a whole
 * number (football: snapped onto the key numbers 3 and 7 at documented rates), then
 * home = round((T+m)/2), away = home - m. Regulation ties are resolved by the sport's overtime rule:
 *  - NBA/NCAAB: 5-minute OT periods drawn from the same model scaled by time, repeated until untied.
 *  - NFL: P(tie stands) = NFL_OT_TIE_RATE; otherwise the OT winner adds 3 (60%) or 6 (40%).
 *  - NCAAF: OT always resolves; winner margin 3/6/7/8, loser OT points 0/3/7/14 (see MODEL.md).
 * OT winner probability = Phi(0.5 * mu / sigma) for football (shrunk toward 50%).
 */
export function simulateNormal(sport: NormalSport, p: NormalParams, d: NormalDraws, n = d.z1.length, out?: ScoreRuns): ScoreRuns {
  const r = out ?? { home: new Int16Array(n), away: new Int16Array(n) };
  const k = NORMAL_CONSTANTS[sport];
  const s2 = Math.sqrt(1 - p.rho * p.rho);
  const pOtHome = normCdf((0.5 * p.mu) / Math.max(p.sigma, 1e-6));
  const frac = k.regMinutes ? k.otMinutes! / k.regMinutes : 0;
  const otM = p.mu * frac, otT = p.tau * frac, otSd = p.sigma * Math.sqrt(frac);
  const snap = k.keySnap;
  for (let i = 0; i < n; i++) {
    const M = p.mu + p.sigma * d.z1[i];
    const T = p.tau + p.sigmaT * (p.rho * d.z1[i] + s2 * d.z2[i]);
    let m = Math.round(M);
    if (snap) {
      // Football key numbers: a latent margin near 3 or 7 lands exactly on it with probability s3/s7.
      const am = Math.abs(M), sg = M < 0 ? -1 : 1;
      if (am >= 1.5 && am < 4.5 && rot(d.u3[i], 5) < snap.s3) m = 3 * sg;
      else if (am >= 5.5 && am < 8.5 && rot(d.u3[i], 7) < snap.s7) m = 7 * sg;
    }
    let h = Math.round((T + m) / 2);
    let a = h - m;
    if (a < 0) { h -= a; a = 0; }
    if (h < 0) { a -= h; h = 0; }
    if (h === a) {
      const u3 = d.u3[i], u4 = d.u4[i];
      if (sport === 'nba' || sport === 'ncaab') {
        for (let ot = 0; ot < 8 && h === a; ot++) {
          const m = otM + otSd * normInv(rot(u3, ot));
          const t = otT + 2.5 * normInv(rot(u4, ot));
          h += Math.max(0, Math.round((t + m) / 2));
          a += Math.max(0, Math.round((t - m) / 2));
        }
        if (h === a) {
          if (u4 < pOtHome) h += 2;
          else a += 2;
        }
      } else if (sport === 'nfl') {
        if (u3 >= NFL_OT_TIE_RATE) {
          const v = (u3 - NFL_OT_TIE_RATE) / (1 - NFL_OT_TIE_RATE);
          const m = v < 0.6 ? 3 : 6;
          if (u4 < pOtHome) h += m;
          else a += m;
        }
      } else {
        const m = u3 < 0.3 ? 3 : u3 < 0.45 ? 6 : u3 < 0.85 ? 7 : 8;
        const w = rot(u3, 3);
        const lose = w < 0.4 ? 0 : w < 0.55 ? 3 : w < 0.9 ? 7 : 14;
        if (u4 < pOtHome) { h += lose + m; a += lose; }
        else { a += lose + m; h += lose; }
      }
    }
    r.home[i] = h;
    r.away[i] = a;
  }
  return r;
}

const DEFAULT_TOTAL: Record<NormalSport, number> = { nba: 225, ncaab: 145, nfl: 44, ncaaf: 52 };

interface Stage { n: number; iters: number; muHalf: number; sigLo: number; sigHi: number; tauHalf: number; passes: number }

/**
 * Calibrate (mu, sigma, tau) so that on the SAME draws used for the final run:
 *   P(home wins) = consensus no-vig moneyline,
 *   P(home covers main spread) = consensus, P(over main total) = consensus.
 * sigma is solved from the moneyline given the spread (the spec's "solve margin SD");
 * total SD and correlation are documented constants.
 * Two stages for speed: a coarse solve on the first 5,000 draws, then a narrow refinement on all
 * draws (common random numbers, so the stage-1 answer is already close).
 */
export function calibrateNormal(sport: NormalSport, t: Targets, d: NormalDraws): NormalParams {
  const k = NORMAL_CONSTANTS[sport];
  const N = d.z1.length;
  const buf: ScoreRuns = { home: new Int16Array(N), away: new Int16Array(N) };
  const clampP = (x: number) => Math.min(Math.max(x, 0.001), 0.999);
  const zw = normInv(clampP(t.pHome));
  const hasSpread = t.spreadLine !== undefined && t.pHomeCover !== undefined;
  const hasTotal = t.totalLine !== undefined && t.pOver !== undefined;

  // Continuous-normal initial guesses.
  const tau0 = hasTotal ? t.totalLine! + k.totalSd * normInv(clampP(t.pOver!)) : DEFAULT_TOTAL[sport];
  let sigma0 = k.sigmaFallback;
  if (hasSpread) {
    const zc = normInv(clampP(t.pHomeCover!));
    const L = t.spreadLine!;
    const s = -L / (zw - zc);
    if (Number.isFinite(s) && s > k.sigmaRange[0] && s < k.sigmaRange[1] && Math.abs(L) >= 1) sigma0 = s;
  }
  const p: NormalParams = { mu: sigma0 * zw, sigma: sigma0, tau: tau0, sigmaT: k.totalSd, rho: k.rho };

  // When |spread| is small the moneyline barely identifies sigma (sigma = -L/(z_win - z_cover) is
  // ~0/0), so sigma is held at the documented constant and mu splits the residual error 1:2 between
  // the moneyline and the spread (moneyline weighted double). Same fallback if the solve runs into the sigma bounds.
  let fixedSigma = !hasSpread || Math.abs(t.spreadLine!) < k.minSolveSpread;
  if (fixedSigma) p.sigma = k.sigmaFallback;

  const run = (st: Stage) => {
    const n = st.n;
    const sim = () => simulateNormal(sport, p, d, n, buf);
    const muFor = (sig: number, center: number): number => {
      p.sigma = sig;
      return bisect((mu) => { p.mu = mu; return pCover(sim(), t.spreadLine!, n); }, t.pHomeCover!, center - st.muHalf, center + st.muHalf, st.iters);
    };
    for (let pass = 0; pass < st.passes; pass++) {
      const c = p.mu;
      const half = st.muHalf * 1.5;
      if (fixedSigma && hasSpread) {
        p.mu = bisect((mu) => {
          p.mu = mu;
          const r = sim();
          return 2 * (pWin2(r, n) - t.pHome) + (pCover(r, t.spreadLine!, n) - t.pHomeCover!); // ML weighted 2:1
        }, 0, c - half, c + half, st.iters + 2);
      } else if (fixedSigma) {
        p.mu = bisect((mu) => { p.mu = mu; return pWin2(sim(), n); }, t.pHome, c - half, c + half, st.iters + 2);
      } else {
        // Bracket centre for mu moves with sigma: mu ~ -L + sigma * z_cover.
        const zc = normInv(clampP(t.pHomeCover!));
        const muRef = p.mu, sigRef = p.sigma;
        const muCenter = (sig: number) => (st.muHalf > 2 ? -t.spreadLine! + sig * zc : muRef + (sig - sigRef) * zc);
        const lo = Math.max(k.sigmaRange[0], p.sigma * st.sigLo), hi = Math.min(k.sigmaRange[1], p.sigma * st.sigHi);
        const sig = bisect((sg) => { p.mu = muFor(sg, muCenter(sg)); return pWin2(sim(), n); }, t.pHome, lo, hi, st.iters);
        p.mu = muFor(sig, muCenter(sig));
        p.sigma = sig;
        const atBound = sig <= k.sigmaRange[0] * 1.005 || sig >= k.sigmaRange[1] * 0.995;
        if (atBound) { fixedSigma = true; pass--; continue; }
      }
      if (hasTotal) {
        const ct = p.tau;
        p.tau = bisect((x) => { p.tau = x; return pOver(sim(), t.totalLine!, n); }, t.pOver!, ct - st.tauHalf, ct + st.tauHalf, st.iters + 2);
      }
    }
  };
  run({ n: Math.min(3000, N), iters: 10, muHalf: 4, sigLo: 0.6, sigHi: 1.6, tauHalf: 6, passes: 2 });
  if (N > 3000) run({ n: N, iters: 6, muHalf: 0.7, sigLo: 0.93, sigHi: 1.07, tauHalf: 0.9, passes: 1 });
  p.sigmaFixed = fixedSigma ? 1 : 0;
  return p;
}
