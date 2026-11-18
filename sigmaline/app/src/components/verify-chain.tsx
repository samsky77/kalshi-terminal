'use client';
import { useState } from 'react';
import { verifyChain, type ChainCheck } from '@sigmaline/core/hash';

/** Downloads the pick log and recomputes every SHA-256 hash in this browser. */
export function VerifyChain() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [res, setRes] = useState<ChainCheck | null>(null);
  const [err, setErr] = useState('');
  async function run() {
    setState('running');
    try {
      const r = await fetch('/api/results/chain', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = (await r.json()).rows as Record<string, unknown>[];
      setRes(await verifyChain(rows));
      setState('done');
    } catch (e) {
      setErr((e as Error).message);
      setState('error');
    }
  }
  return (
    <div>
      <button type="button" onClick={run} disabled={state === 'running'} className="tap border border-amber px-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-amber hover:bg-amber hover:text-black disabled:opacity-60">
        {state === 'running' ? 'Verifying…' : 'Verify the chain'}
      </button>
      <div aria-live="polite" className="mt-2 text-[12px]">
        {state === 'done' && res && (res.ok
          ? <p className="text-ink">✓ All {res.checked} rows verified in your browser. Each row's SHA-256 hash matches its contents and the row before it.{res.sealed ? ` ${res.sealed} row(s) for games not yet started are sealed: their hashes are published now, and their contents unlock at kick-off.` : ''}</p>
          : <p className="text-amber">✗ Chain broken at row #{res.brokenAt}: {res.reason}.</p>)}
        {state === 'error' && <p className="text-amber">Couldn't load the log ({err}).</p>}
      </div>
    </div>
  );
}
