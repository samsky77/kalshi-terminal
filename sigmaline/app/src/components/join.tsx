'use client';
import { useState } from 'react';

/** "Join" opens Whop checkout, but only after the 21+ confirmation. */
export function JoinButton({ href, label, sub }: { href: string; label: string; sub?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <label className="tap flex cursor-pointer items-center gap-3 text-[13px]">
        <input type="checkbox" className="h-5 w-5 accent-[#FFB000]" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I am legally allowed to bet where I live.</span>
      </label>
      <a
        href={ok ? href : undefined}
        aria-disabled={!ok}
        onClick={(e) => { if (!ok) e.preventDefault(); }}
        className={`tap mt-2 inline-flex w-full items-center justify-center px-5 text-[14px] font-bold uppercase tracking-[0.14em] sm:w-auto ${ok ? 'bg-amber text-black' : 'cursor-not-allowed border border-line text-muted'}`}
      >
        {label}
      </a>
      {!ok && <p className="mt-1 text-[12px] text-muted" aria-live="polite">Tick the box above to continue (21+ only).</p>}
      {sub && <p className="mt-1 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}
