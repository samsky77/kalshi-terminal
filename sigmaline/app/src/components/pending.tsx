'use client';
import { useLinkStatus } from 'next/link';

/**
 * Put inside a <Link>: while that navigation is pending, a thin amber bar shows at the top of the
 * screen, so a tap on a slow connection gets instant feedback (QA tickets SLO-001 / SLO-002).
 */
export function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden className="fixed inset-x-0 top-0 z-50 block h-[3px] animate-pulse bg-amber" /> : null;
}
