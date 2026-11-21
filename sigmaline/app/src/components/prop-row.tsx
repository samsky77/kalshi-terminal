import { GRADE_CONFIG, propLabel } from '@sigmaline/core';
import type { FeedPrice } from '@sigmaline/db';
import { Ago, FreshRow } from '@/components/ago';
import { GradeBadge } from '@/components/chrome';
import { american, bookName, pct } from '@/lib/format';

/** One prop price: book, price, fair, edge %, grade, live "updated X ago", consensus-only label. */
export function PropRow({ r, now, sm }: { r: FeedPrice; now: number; sm: number }) {
  const edge = r.grade !== 'none';
  return (
    <FreshRow ts={r.price_ts} staleMin={sm} serverNow={now} className="grid grid-cols-[1fr_auto] gap-2 border-b border-line2 py-2">
      <span className="min-w-0">
        <span className={`block text-[13px] leading-snug ${edge ? 'text-ink' : 'text-muted'}`}>{r.label}</span>
        <span className="block text-[12px]"><span className={edge ? 'text-amber' : 'text-ink'}>{american(r.best_decimal)}</span> <span className="text-muted">{bookName(r.best_book)} · {r.books} books · {propLabel(r.selection.stat)}</span></span>
        <span className="flex flex-wrap items-center gap-2">
          <Ago ts={r.price_ts} staleMin={sm} serverNow={now} />
          {r.fair_source === 'consensus' && <span className="text-[11px] uppercase tracking-[0.1em] text-muted">consensus-only</span>}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1 text-right">
        <span className="text-[12px] text-fair">fair {american(r.fair_decimal)}</span>
        <span className={`edge-only text-[12px] ${edge ? 'text-amber' : 'text-muted'}`}>{pct(r.ev)}</span>
        {edge ? <span className="edge-only"><GradeBadge grade={r.grade} /></span> : <span className="text-[11px] text-muted">{(r.ev ?? 0) >= GRADE_CONFIG.B.minEdge ? 'not graded' : 'no edge'}</span>}
      </span>
    </FreshRow>
  );
}
