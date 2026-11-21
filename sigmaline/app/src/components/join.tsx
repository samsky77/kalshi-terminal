'use client';
import { useId, useState } from 'react';

/** "Join" opens Whop checkout, but only after the 21+ confirmation. */
export function JoinButton({ href, label, sub }: { href: string; label: string; sub?: string }) {
  const [ok, setOk] = useState(false);
  const hintId = useId();
  return (
    <div>
      <label className="tap flex cursor-pointer items-center gap-3 text-[13px]">
        <input type="checkbox" className="h-5 w-5 accent-[#FFB000]" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I am legally allowed to bet where I live.</span>
      </label>
      {ok ? (
        <a href={href} className="tap mt-2 inline-flex w-full items-center justify-center bg-amber px-5 text-[14px] font-bold uppercase tracking-[0.14em] text-black sm:w-auto">{label}</a>
      ) : (
        <button type="button" disabled aria-describedby={hintId} className="tap mt-2 inline-flex w-full cursor-not-allowed items-center justify-center border border-line px-5 text-[14px] font-bold uppercase tracking-[0.14em] text-muted sm:w-auto">{label}</button>
      )}
      <p id={hintId} className="mt-1 text-[12px] text-muted" aria-live="polite">{ok ? '' : 'Tick the box above to continue (21+ only).'}</p>
      {sub && <p className="mt-1 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}
