// Pure numeric helpers. No UI or I/O imports anywhere in src/core.

/** Deterministic 32-bit PRNG (mulberry32). Same seed -> same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash -> uint32, used to derive per-game seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform in the open interval (0,1) so inverse CDFs never see 0 or 1. */
export function openUniform(rng: () => number): number {
  let u = rng();
  while (u <= 1e-12 || u >= 1 - 1e-12) u = rng();
  return u;
}

/** Standard normal CDF (Zelen & Severo 26.2.17 via erf approximation, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's algorithm, rel. err ~1e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Inverse Poisson CDF: smallest k with P(X<=k) >= u. Monotone non-decreasing in lambda for fixed u. */
export function poissonInv(u: number, lambda: number): number {
  if (lambda <= 0) return 0;
  let k = 0;
  let p = Math.exp(-lambda);
  let cdf = p;
  while (cdf < u && k < 60) {
    k++;
    p *= lambda / k;
    cdf += p;
  }
  return k;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Bisection for a monotone function f on [lo, hi] solving f(x) = target.
 * Direction is detected automatically. Returns the clamped endpoint if target is out of range.
 */
export function bisect(f: (x: number) => number, target: number, lo: number, hi: number, iters = 40): number {
  const flo = f(lo);
  const fhi = f(hi);
  const increasing = fhi >= flo;
  if (increasing ? target <= flo : target >= flo) return lo;
  if (increasing ? target >= fhi : target <= fhi) return hi;
  let a = lo, b = hi;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if ((fm < target) === increasing) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Histogram of integer values as sorted [value, probability] pairs. */
export function histogram(values: ArrayLike<number>): [number, number][] {
  const counts = new Map<number, number>();
  for (let i = 0; i < values.length; i++) counts.set(values[i], (counts.get(values[i]) ?? 0) + 1);
  const n = values.length;
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => [v, c / n]);
}
