'use client';
import { useEffect, useState } from 'react';

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Env = 'loading' | 'ios-browser' | 'unsupported' | 'ready';

/**
 * Web Push setup. On iPhone, push only works from the installed app, so Safari users first see a
 * short "Add to Home Screen" guide instead of the push button.
 */
export function PushSetup({ vapidKey }: { vapidKey: string }) {
  const [env, setEnv] = useState<Env>('loading');
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (ios && !standalone) { setEnv('ios-browser'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setEnv('unsupported'); return; }
    setEnv('ready');
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setOn(!!s)).catch(() => {});
  }, []);

  async function enable() {
    setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setMsg('Notifications are blocked. Allow them in your browser or phone settings, then try again.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapidKey) }));
      const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setOn(true);
      setMsg('Push alerts are on for this device.');
    } catch (e) {
      setMsg(`Couldn't turn on push (${(e as Error).message}).`);
    }
  }
  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub?.endpoint }) });
    await sub?.unsubscribe();
    setOn(false);
    setMsg('Push alerts are off for this device.');
  }

  if (env === 'loading') return <div className="skeleton h-11 w-48" aria-label="Checking this device" />;
  if (env === 'ios-browser') {
    return (
      <div className="panel p-3">
        <p className="text-[13px] font-semibold text-amber">On iPhone: add Sigmaline to your Home Screen first</p>
        <ol className="prose-sl mt-2 list-decimal space-y-1 pl-5 text-[14px]">
          <li>Tap the <span className="font-semibold">Share</span> button (the square with an arrow) in Safari.</li>
          <li>Choose <span className="font-semibold">Add to Home Screen</span>, then tap <span className="font-semibold">Add</span>.</li>
          <li>Open Sigmaline from the new Home Screen icon and come back to this page to turn on alerts.</li>
        </ol>
        <p className="mt-2 text-[12px] text-muted">Apple only allows web push from installed apps (iOS 16.4+).</p>
      </div>
    );
  }
  if (env === 'unsupported') return <p className="text-[13px] text-muted">This browser doesn&apos;t support web push. Use Chrome on Android, or the installed app on iPhone. Discord alerts work everywhere.</p>;
  if (!vapidKey) return <p className="text-[13px] text-muted">Push isn&apos;t configured on the server yet (VAPID key missing).</p>;
  return (
    <div>
      <button type="button" onClick={on ? disable : enable} className={`tap px-4 text-[13px] font-semibold uppercase tracking-[0.12em] ${on ? 'border border-line text-ink' : 'bg-amber text-black'}`}>
        {on ? 'Turn off push on this device' : 'Turn on push alerts'}
      </button>
      <p aria-live="polite" className="mt-2 text-[12px] text-muted">{msg}</p>
    </div>
  );
}
