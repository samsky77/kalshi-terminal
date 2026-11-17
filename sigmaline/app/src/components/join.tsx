'use client';
import { useState } from 'react';

/** "Join" opens Whop checkout, but only after the 21+ confirmation. */
export function JoinButton({ href, label = 'Join — $25/mo' }: { href: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <label className="tap flex cursor-pointer items-center gap-3 text-[13px]">
        <input type="checkbox" className="h-5 w-5 accent-[#FFB000]" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I am 21 or older and betting is legal where I live.</span>
      </label>
      <a
        href={ok ? href : undefined}
        aria-disabled={!ok}
        onClick={(e) => { if (!ok) e.preventDefault(); }}
        className={`tap mt-2 inline-flex w-full items-center justify-center px-5 text-[14px] font-bold uppercase tracking-[0.14em] sm:w-auto ${ok ? 'bg-amber text-black' : 'cursor-not-allowed border border-line text-muted'}`}
      >
        {label}
      </a>
    </div>
  );
}
