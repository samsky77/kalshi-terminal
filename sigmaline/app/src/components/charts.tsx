/**
 * Hand-built SVG charts (no chart library: small bundle, fast on 4G). Each chart has an aria-label
 * summary and a visually hidden data table as its text alternative; marks carry <title> tooltips.
 * Colours: amber = where the pick wins / our numbers, blue = fair, grey = everything else.
 */
const AMBER = '#FFB000', GREY = '#6B675F', BLUE = '#5AB0FF', GRID = '#2A2A2A', MUTED = '#9A968C';

export interface Bin { from: number; to: number; share: number; wins: boolean }

export function MarginHistogram({ bins, axis, pickLabel }: { bins: Bin[]; axis: 'margin' | 'total'; pickLabel: string | null }) {
  const W = 340, H = 150, pad = { l: 30, r: 6, t: 8, b: 30 };
  const max = Math.max(...bins.map((b) => b.share), 0.0001);
  const bw = (W - pad.l - pad.r) / bins.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const lab = (b: Bin) => (b.from === b.to ? `${b.from}` : `${b.from} to ${b.to}`);
  const winShare = bins.filter((b) => b.wins).reduce((s, b) => s + b.share, 0);
  const summary = `Histogram of 12 simulated ${axis === 'total' ? 'total score' : 'final margin'} buckets${pickLabel ? `; amber buckets are where ${pickLabel} wins (${Math.round(winShare * 100)}% of runs)` : ''}.`;
  const ticks = [0, max / 2, max];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill={MUTED}>{Math.round(t * 100)}%</text>
          </g>
        ))}
        {bins.map((b, i) => (
          <rect key={i} x={pad.l + i * bw + 1} width={Math.max(1, bw - 2)} y={y(b.share)} height={H - pad.b - y(b.share)} fill={b.wins ? AMBER : GREY}>
            <title>{`${lab(b)}: ${(b.share * 100).toFixed(1)}% of runs${b.wins ? ' (pick wins)' : ''}`}</title>
          </rect>
        ))}
        {bins.map((b, i) => (i % 2 === 0 ? (
          <text key={`t${i}`} x={pad.l + i * bw + bw / 2} y={H - pad.b + 12} textAnchor="middle" fontSize={9} fill={MUTED}>{b.from > 0 && axis === 'margin' ? `+${b.from}` : b.from}</text>
        ) : null))}
        <text x={(W + pad.l) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill={MUTED}>
          {axis === 'total' ? 'Simulated total' : 'Simulated final margin (home − away)'}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: AMBER }} />Pick wins</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: GREY }} />Pick loses or pushes</span>
      </figcaption>
      <div className="sr-only"><table>
        <caption>{summary}</caption>
        <thead><tr><th>Bucket</th><th>Share of runs</th><th>Pick wins</th></tr></thead>
        <tbody>{bins.map((b, i) => <tr key={i}><td>{lab(b)}</td><td>{(b.share * 100).toFixed(1)}%</td><td>{b.wins ? 'yes' : 'no'}</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}

export function LineChart({ points, label, color = AMBER, format = (v: number) => v.toFixed(1), zero = false, xLabel }: {
  points: { t: string; value: number }[]; label: string; color?: string; format?: (v: number) => string; zero?: boolean; xLabel?: (t: string) => string;
}) {
  const W = 340, H = 140, pad = { l: 40, r: 10, t: 10, b: 22 };
  if (points.length < 2) {
    return <p className="text-[12px] text-muted">{points.length === 1 ? `One snapshot so far: ${format(points[0].value)}.` : 'No snapshots yet.'}</p>;
  }
  const vs = points.map((p) => p.value);
  let lo = Math.min(...vs, zero ? 0 : Infinity), hi = Math.max(...vs, zero ? 0 : -Infinity);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / (points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const fmtX = xLabel ?? ((t: string) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const summary = `${label}: from ${format(points[0].value)} to ${format(points[points.length - 1].value)} over ${points.length} points.`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        {[lo, (lo + hi) / 2, hi].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill={MUTED}>{format(t)}</text>
          </g>
        ))}
        {zero && lo < 0 && hi > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={MUTED} strokeWidth={1} strokeDasharray="3 3" />}
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={points.length > 40 ? 0 : 3} fill={color}>
            <title>{`${fmtX(p.t)}: ${format(p.value)}`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 6} fontSize={9} fill={MUTED}>{fmtX(points[0].t)}</text>
        <text x={W - pad.r} y={H - 6} fontSize={9} fill={MUTED} textAnchor="end">{fmtX(points[points.length - 1].t)}</text>
      </svg>
      <div className="sr-only"><table>
        <caption>{summary}</caption>
        <tbody>{points.map((p, i) => <tr key={i}><td>{fmtX(p.t)}</td><td>{format(p.value)}</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}

export function CalibrationChart({ buckets, label }: { buckets: { lo: number; hi: number; n: number; meanP: number; hitRate: number }[]; label: string }) {
  const W = 300, H = 200, pad = { l: 34, r: 8, t: 8, b: 28 };
  const x = (v: number) => pad.l + (W - pad.l - pad.r) * v;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v);
  const pts = buckets.filter((b) => b.n > 0 && Number.isFinite(b.meanP));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-sm" role="img" aria-label={`${label}: predicted probability vs. observed hit rate in 10 buckets`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={pad.l - 4} y={y(t) + 3} fontSize={9} fill={MUTED} textAnchor="end">{t * 100}%</text>
            <text x={x(t)} y={H - 14} fontSize={9} fill={MUTED} textAnchor="middle">{t * 100}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={MUTED} strokeDasharray="3 3" />
        {pts.map((b, i) => (
          <circle key={i} cx={x(b.meanP)} cy={y(b.hitRate)} r={Math.min(9, 3 + Math.sqrt(b.n) / 3)} fill={BLUE} stroke="#141414" strokeWidth={2}>
            <title>{`Predicted ${(b.meanP * 100).toFixed(0)}% · observed ${(b.hitRate * 100).toFixed(0)}% · n=${b.n}`}</title>
          </circle>
        ))}
        <text x={(W + pad.l) / 2} y={H - 2} fontSize={9} fill={MUTED} textAnchor="middle">Predicted probability (dashed = perfect calibration)</text>
      </svg>
      <div className="sr-only"><table>
        <caption>{label}</caption>
        <thead><tr><th>Bucket</th><th>n</th><th>Predicted</th><th>Observed</th></tr></thead>
        <tbody>{pts.map((b, i) => <tr key={i}><td>{b.lo}–{b.hi}</td><td>{b.n}</td><td>{(b.meanP * 100).toFixed(1)}%</td><td>{(b.hitRate * 100).toFixed(1)}%</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}

/** Edge size against the minimum flag threshold (2%): a bar, a white tick at the threshold, and text for screen readers. */
export function EdgeMeter({ ev, min, max = 0.12 }: { ev: number; min: number; max?: number }) {
  const w = Math.max(2, Math.min(100, (ev / max) * 100)), t = (min / max) * 100;
  return (
    <div role="img" aria-label={`Edge ${(ev * 100).toFixed(1)}%. Minimum flagged edge is ${(min * 100).toFixed(0)}%.`}>
      <div className="relative my-3 h-2.5 rounded-md bg-[#1d1a10]">
        <i className="absolute inset-y-0 left-0 rounded-md bg-amber" style={{ width: `${w}%` }} />
        <u className="absolute -inset-y-1 w-0.5 bg-ink no-underline" style={{ left: `${t}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted"><span>0%</span><span>| {(min * 100).toFixed(0)}% minimum</span><span>{(max * 100).toFixed(0)}%</span></div>
    </div>
  );
}

/** One dot per book at the pick's exact line, the best price highlighted, the fair price as a dashed line. Axis in American odds. */
export function BookDots({ prices, best, fair, label, fmt }: {
  prices: { book: string; decimal: number }[]; best: { book: string; decimal: number }; fair: number; label: string; fmt: (d: number) => string;
}) {
  const W = 350, H = 150, pad = 20;
  const vals = [...prices.map((p) => p.decimal), fair];
  const span = Math.max(...vals) - Math.min(...vals) || 0.2;
  const lo = Math.min(...vals) - span * 0.06, hi = Math.max(...vals) + span * 0.06;
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const bw = (hi - lo) / 26;
  const bins = new Map<number, typeof prices>();
  for (const p of prices) { const k = Math.round(p.decimal / bw); bins.set(k, [...(bins.get(k) ?? []), p]); }
  const others = prices.filter((p) => p.book !== best.book).map((p) => p.decimal);
  const summary = `${label}. Price at each of ${prices.length} books. Best: ${fmt(best.decimal)}. Other books: ${fmt(Math.min(...others))} to ${fmt(Math.max(...others))}. Fair price: ${fmt(fair)}.`;
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        <line x1={pad} x2={W - pad} y1={106} y2={106} stroke={GRID} />
        {[...bins.values()].flatMap((ps) => ps.map((p, i) => {
          const hot = p.book === best.book;
          return <circle key={p.book} cx={x(p.decimal)} cy={96 - i * 13} r={5.5} fill={hot ? AMBER : GREY} stroke={hot ? '#fff' : undefined} strokeWidth={hot ? 1.5 : 0}><title>{`${p.book}: ${fmt(p.decimal)}`}</title></circle>;
        }))}
        {ticks.map((t, i) => <g key={i}><line x1={x(t)} x2={x(t)} y1={106} y2={110} stroke={MUTED} /><text x={x(t)} y={124} textAnchor="middle" fontSize={10.5} fill={MUTED}>{fmt(t)}</text></g>)}
        <line x1={x(fair)} x2={x(fair)} y1={26} y2={106} stroke="#F2EFE6" strokeDasharray="3 3" />
        <text x={x(fair)} y={16} textAnchor="middle" fontSize={10.5} fill="#F2EFE6">fair {fmt(fair)}</text>
        <text x={Math.min(x(best.decimal), W - pad)} y={40} textAnchor="end" fontSize={10.5} fill={AMBER} fontWeight={600}>{best.book} {fmt(best.decimal)}</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span><span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: AMBER }} />Best price</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: GREY }} />Other books</span>
        <span><span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: '#F2EFE6' }} />Fair price</span>
      </figcaption>
      <div className="sr-only"><table><caption>{summary}</caption><tbody>{[...prices].sort((a, b) => b.decimal - a.decimal).map((p) => <tr key={p.book}><td>{p.book}</td><td>{fmt(p.decimal)}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

export { AMBER, BLUE, GREY };
