/**
 * Seeded random numbers. Every simulation takes a seed so a run can be reproduced exactly
 * from the `sim_runs` row (seed + model version + inputs).
 */
export interface Rng {
  /** Uniform in (0, 1); never exactly 0 or 1. */
  next(): number;
  normal(): number;
  poisson(lambda: number): number;
  gamma(shape: number): number;
  negBin(mean: number, dispersion: number): number;
}

/** sfc32: small, fast, passes PractRand to 2^40+; good enough for Monte Carlo. */
export function createRng(seed: number): Rng {
  let a = 0x9e3779b9 ^ seed, b = 0x243f6a88 ^ (seed * 31), c = 0xb7e15162 ^ (seed >>> 3), d = 1 | seed;
  const raw = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) raw();
  const next = (): number => {
    let u = raw();
    while (u === 0) u = raw();
    return u;
  };
  let spare: number | null = null;
  const normal = (): number => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const u = next(), v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lambda: number): number => {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > L);
      return k - 1;
    }
    // Large lambda: normal approximation with continuity correction (only hit by basketball-sized props).
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
  };
  const gamma = (shape: number): number => {
    // Marsaglia–Tsang
    if (shape < 1) return gamma(shape + 1) * Math.pow(next(), 1 / shape);
    const dd = shape - 1 / 3, cc = 1 / Math.sqrt(9 * dd);
    for (;;) {
      let x: number, v: number;
      do { x = normal(); v = 1 + cc * x; } while (v <= 0);
      v = v * v * v;
      const u = next();
      if (u < 1 - 0.0331 * x * x * x * x) return dd * v;
      if (Math.log(u) < 0.5 * x * x + dd * (1 - v + Math.log(v))) return dd * v;
    }
  };
  /** Negative binomial as a gamma–Poisson mixture. dispersion r: variance = mean + mean²/r. */
  const negBin = (mean: number, dispersion: number): number => {
    if (!(mean > 0)) return 0;
    if (!(dispersion > 0) || dispersion > 1e6) return poisson(mean);
    return poisson((gamma(dispersion) / dispersion) * mean);
  };
  return { next, normal, poisson, gamma, negBin };
}

/** Stable 32-bit seed from a string (FNV-1a), e.g. event id + model version + snapshot time. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
