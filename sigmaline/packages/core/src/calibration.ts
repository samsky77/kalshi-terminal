/** Scoring and the nightly self-improvement loop (spec §6). */

export interface Forecast { p: number; y: 0 | 1 }

export function brier(xs: Forecast[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / xs.length;
}

export function logLoss(xs: Forecast[]): number {
  if (!xs.length) return NaN;
  const e = 1e-6;
  return -xs.reduce((s, x) => { const p = Math.min(1 - e, Math.max(e, x.p)); return s + (x.y ? Math.log(p) : Math.log(1 - p)); }, 0) / xs.length;
}

export interface CalBucket { lo: number; hi: number; n: number; meanP: number; hitRate: number }

export function calibrationBuckets(xs: Forecast[], k = 10): CalBucket[] {
  const out: CalBucket[] = [];
  for (let i = 0; i < k; i++) {
    const lo = i / k, hi = (i + 1) / k;
    const b = xs.filter((x) => x.p >= lo && (i === k - 1 ? x.p <= hi : x.p < hi));
    out.push({ lo, hi, n: b.length, meanP: b.length ? b.reduce((s, x) => s + x.p, 0) / b.length : NaN, hitRate: b.length ? b.reduce((s, x) => s + x.y, 0) / b.length : NaN });
  }
  return out;
}

export interface BlendObs { pModel: number; pConsensus: number; y: 0 | 1; date: string }

/**
 * Retune the blend weight w: try w ± step (capped at ±0.05 per night and kept in [0.15, 0.6]),
 * fit on the training split, keep a change only if it improves out-of-sample log loss on the
 * held-out split (the most recent `holdoutFrac` of games by date).
 */
export function retuneW(obs: BlendObs[], current: number, opts: { step?: number; min?: number; max?: number; holdoutFrac?: number; minObs?: number } = {}): { w: number; changed: boolean; trainLoss: number; holdoutBefore: number; holdoutAfter: number; n: number } {
  const step = Math.min(0.05, opts.step ?? 0.05), min = opts.min ?? 0.15, max = opts.max ?? 0.6;
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const ho = Math.max(1, Math.floor(n * (opts.holdoutFrac ?? 0.3)));
  const train = sorted.slice(0, n - ho), hold = sorted.slice(n - ho);
  const loss = (xs: BlendObs[], w: number) => logLoss(xs.map((x) => ({ p: w * x.pModel + (1 - w) * x.pConsensus, y: x.y })));
  const base = { w: current, changed: false, trainLoss: loss(train, current), holdoutBefore: loss(hold, current), holdoutAfter: loss(hold, current), n };
  if (n < (opts.minObs ?? 50)) return base;
  const cands = [current - step, current, current + step].map((w) => Math.min(max, Math.max(min, w)));
  let best = current, bestL = loss(train, current);
  for (const w of cands) { const l = loss(train, w); if (l < bestL - 1e-9) { best = w; bestL = l; } }
  const after = loss(hold, best);
  if (best !== current && after < base.holdoutBefore) return { w: best, changed: true, trainLoss: bestL, holdoutBefore: base.holdoutBefore, holdoutAfter: after, n };
  return base;
}

/**
 * Retune a sport's recency half-life by ±step (relative ±0.05 per night, i.e. 5%), keeping it only
 * if held-out log loss improves. `evalLoss` replays the held-out games with the given half-life.
 */
export function retuneHalfLife(current: number, evalLoss: (halfLife: number) => number, rel = 0.05): { halfLife: number; changed: boolean; before: number; after: number } {
  const before = evalLoss(current);
  let best = current, bestL = before;
  for (const h of [current * (1 - rel), current * (1 + rel)]) { const l = evalLoss(h); if (l < bestL - 1e-6) { best = h; bestL = l; } }
  return { halfLife: Math.round(best * 10) / 10, changed: best !== current, before, after: bestL };
}
