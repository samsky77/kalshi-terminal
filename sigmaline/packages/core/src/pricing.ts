import { blendFair, conditionalWin, DEFAULT_THRESHOLDS, expectedValue, fairDecimal, gradePick, type GradeThresholds } from './ev';
import { priceSelection, selectionKey, settleFractions } from './markets';
import { consensus } from './odds';
import type { Grade, MarketType, OutcomeProbs, Selection, SimSamples, Side, SportId } from './types';

/** One book's two-way (or three-way) quote for one market at one line. */
export interface MarketQuote {
  book: string;
  market: MarketType;
  /** Line from the first side's perspective (home spread, total line, prop line). */
  line?: number;
  player?: string;
  stat?: string;
  /** Decimal price per side, keyed by side. */
  prices: Partial<Record<Side, number>>;
  ts: string;
}

export interface PricedSelection {
  selection: Selection;
  key: string;
  books: number;
  bestBook: string | null;
  bestDecimal: number;
  consensusP: number;
  model: OutcomeProbs;
  fair: OutcomeProbs;
  fairDecimal: number;
  ev: number;
  modelEv: number;
  consensusEv: number;
  grade: Grade;
  w: number;
  snapshotTs: string;
}

function sidesFor(market: MarketType, threeWay: boolean): Side[] {
  if (market === 'ml') return threeWay ? ['home', 'away', 'draw'] : ['home', 'away'];
  if (market === 'spread') return ['home', 'away'];
  return ['over', 'under'];
}

function lineForSide(market: MarketType, side: Side, line: number | undefined): number | undefined {
  if (market === 'spread' && line !== undefined) return side === 'home' ? line : -line;
  return line;
}

export interface PriceOptions {
  sport: SportId;
  threeWay: boolean;
  /** Books the user can actually bet (best price is taken only from these). */
  bettable: Set<string>;
  /** Blend weight per market type. */
  w: Partial<Record<MarketType, number>>;
  thresholds?: GradeThresholds;
}

/**
 * Price every market/line quoted for a game against one simulated distribution.
 * Consensus is built from books quoting all sides at the same line.
 */
export function priceMarkets(samples: SimSamples, quotes: MarketQuote[], opt: PriceOptions): PricedSelection[] {
  const groups = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    const k = [q.market, q.line ?? '', q.player ?? '', q.stat ?? ''].join('|');
    const g = groups.get(k);
    if (g) g.push(q); else groups.set(k, [q]);
  }
  const out: PricedSelection[] = [];
  for (const g of groups.values()) {
    const { market, line, player, stat } = g[0];
    const sides = sidesFor(market, opt.threeWay && market === 'ml');
    // Latest quote per book
    const byBook = new Map<string, MarketQuote>();
    for (const q of g) { const prev = byBook.get(q.book); if (!prev || prev.ts < q.ts) byBook.set(q.book, q); }
    const full = [...byBook.values()].filter((q) => sides.every((s) => (q.prices[s] ?? 0) > 1));
    const cons = consensus(full.map((q) => ({ book: q.book, prices: sides.map((s) => q.prices[s]!) })));
    const snapshotTs = [...byBook.values()].reduce((m, q) => (q.ts > m ? q.ts : m), '');
    sides.forEach((side, i) => {
      const sel: Selection = { market, side, line: lineForSide(market, side, line), player, stat };
      const model = priceSelection(samples, sel, opt.sport);
      if (!Number.isFinite(model.win)) return;
      let bestBook: string | null = null, bestDecimal = NaN;
      for (const q of byBook.values()) {
        const d = q.prices[side];
        if (!d || d <= 1 || !opt.bettable.has(q.book)) continue;
        if (!(d <= bestDecimal)) { bestDecimal = d; bestBook = q.book; }
      }
      // Consensus probability on the no-push scale. For 3-way, the draw-inclusive no-vig prob is
      // already the win probability (no push possible).
      const cP = cons ? cons.probs[i] : NaN;
      const w = opt.w[market] ?? 0.35;
      const fair = blendFair(model, cP, w);
      const ev = Number.isFinite(bestDecimal) ? expectedValue(fair, bestDecimal) : NaN;
      const modelEv = Number.isFinite(bestDecimal) ? expectedValue(model, bestDecimal) : NaN;
      const consensusEv = Number.isFinite(bestDecimal) && Number.isFinite(cP)
        ? expectedValue({ win: cP * (1 - model.push), push: model.push, loss: (1 - cP) * (1 - model.push) }, bestDecimal)
        : NaN;
      out.push({
        selection: sel, key: selectionKey(sel), books: full.length, bestBook, bestDecimal,
        consensusP: cP, model, fair, fairDecimal: fairDecimal(fair), ev, modelEv, consensusEv,
        grade: gradePick(ev, modelEv, consensusEv, opt.thresholds ?? DEFAULT_THRESHOLDS), w, snapshotTs,
      });
    });
  }
  return out.sort((a, b) => (b.ev || -9) - (a.ev || -9));
}

/** Compact integer pmf of the simulated margin (home − away) and total, stored in sim_runs. */
export interface DistSummary {
  n: number;
  margin: { min: number; counts: number[] };
  total: { min: number; counts: number[] };
  homeWin: number;
  draw: number;
  meanHome: number;
  meanAway: number;
}

export function summarize(s: SimSamples): DistSummary {
  let minM = Infinity, maxM = -Infinity, minT = Infinity, maxT = -Infinity, hw = 0, dr = 0, sh = 0, sa = 0;
  for (let i = 0; i < s.n; i++) {
    const m = s.home[i] - s.away[i], t = s.home[i] + s.away[i];
    if (m < minM) minM = m; if (m > maxM) maxM = m; if (t < minT) minT = t; if (t > maxT) maxT = t;
    if (s.winner[i] === 1) hw++; else if (s.winner[i] === 0) dr++;
    sh += s.home[i]; sa += s.away[i];
  }
  const mc = new Array(maxM - minM + 1).fill(0), tc = new Array(maxT - minT + 1).fill(0);
  for (let i = 0; i < s.n; i++) { mc[s.home[i] - s.away[i] - minM]++; tc[s.home[i] + s.away[i] - minT]++; }
  return { n: s.n, margin: { min: minM, counts: mc }, total: { min: minT, counts: tc }, homeWin: hw / s.n, draw: dr / s.n, meanHome: sh / s.n, meanAway: sa / s.n };
}

export interface HistBucket { from: number; to: number; count: number; share: number; wins: boolean }

/**
 * 12-bucket histogram of the simulated final margin (or total, for totals picks), with each bucket
 * flagged where the pick wins in the majority of its runs. Built from the stored pmf.
 */
export function pickHistogram(d: DistSummary, sel: Selection | null, sport: SportId, buckets = 12): { axis: 'margin' | 'total'; bins: HistBucket[] } {
  const axis = sel?.market === 'total' ? 'total' : 'margin';
  const pmf = axis === 'total' ? d.total : d.margin;
  const n = pmf.counts.reduce((a, b) => a + b, 0);
  // central 98% range
  let acc = 0, lo = pmf.min, hi = pmf.min + pmf.counts.length - 1;
  for (let i = 0; i < pmf.counts.length; i++) { acc += pmf.counts[i]; if (acc / n >= 0.01) { lo = pmf.min + i; break; } }
  acc = 0;
  for (let i = pmf.counts.length - 1; i >= 0; i--) { acc += pmf.counts[i]; if (acc / n >= 0.01) { hi = pmf.min + i; break; } }
  const width = Math.max(1, Math.ceil((hi - lo + 1) / buckets));
  const bins: HistBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = lo + b * width, to = from + width - 1;
    let c = 0, winW = 0;
    for (let v = from; v <= to; v++) {
      const k = pmf.counts[v - pmf.min] ?? 0;
      c += k;
      if (sel && sel.market !== 'prop' && k) {
        // settle at a representative score with this margin/total
        const o = axis === 'total'
          ? settleFractions(sel, sport, Math.ceil(v / 2), Math.floor(v / 2), 0, undefined)
          : settleFractions(sel, sport, Math.max(v, 0) + 100, Math.max(-v, 0) + 100, Math.sign(v), undefined);
        winW += k * o.win;
      }
    }
    // Edge buckets absorb the tails so shares sum to 1
    bins.push({ from, to, count: c, share: c / n, wins: c > 0 && winW / c > 0.5 });
  }
  const below = pmf.counts.slice(0, Math.max(0, lo - pmf.min)).reduce((a, b) => a + b, 0);
  const above = pmf.counts.slice(Math.max(0, bins[bins.length - 1].to - pmf.min + 1)).reduce((a, b) => a + b, 0);
  bins[0].count += below; bins[0].share = bins[0].count / n;
  bins[bins.length - 1].count += above; bins[bins.length - 1].share = bins[bins.length - 1].count / n;
  return { axis, bins };
}

export { conditionalWin };
