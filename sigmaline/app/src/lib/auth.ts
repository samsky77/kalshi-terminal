import 'server-only';
import { cookies } from 'next/headers';
import { getMember, type MemberRow } from '@sigmaline/db';
import { demoMode, getDb } from './db';
import { SESSION_COOKIE, verifySession, type Session } from './session';
import { checkAccess } from './whop';

export const MEMBERSHIP_CACHE_MS = 10 * 60 * 1000;

export interface Viewer {
  session: Session | null;
  member: MemberRow | null;
  active: boolean;
  admin: boolean;
}

/**
 * Local preview only: DEMO_OPEN=1 with the demo file database lets you browse paid screens without
 * Whop. Impossible with a real database configured.
 */
export function demoOpen(): boolean {
  return process.env.DEMO_OPEN === '1' && demoMode();
}

/**
 * Membership check with a 10-minute cache in `members.checked_at`. Webhooks update the row
 * immediately; this re-asks Whop when the cached answer is older than 10 minutes.
 */
export async function memberStatus(uid: string, email: string | null, now = Date.now()): Promise<MemberRow | null> {
  const db = await getDb();
  let m = await getMember(db, uid);
  const fresh = m?.checked_at && now - Date.parse(m.checked_at) < MEMBERSHIP_CACHE_MS;
  if (!fresh) {
    let active: boolean | null = null;
    try { active = await checkAccess(uid); } catch { active = null; }
    if (active !== null) {
      const row = {
        whop_user_id: uid, email: email ?? m?.email ?? null, status: active ? 'active' : m?.status === 'active' ? 'expired' : (m?.status ?? 'none'),
        checked_at: new Date(now).toISOString(),
      };
      await db.upsert('members', row, 'whop_user_id');
      m = await getMember(db, uid);
    }
    // If Whop is unreachable, fall back to the last known status (webhooks keep it current).
  }
  return m;
}

export async function viewerFromToken(token: string | undefined): Promise<Viewer> {
  if (demoOpen()) return { session: { uid: 'demo', email: 'demo@example.com', exp: Date.now() + 1e9 }, member: null, active: true, admin: true };
  const session = await verifySession(token);
  if (!session) return { session: null, member: null, active: false, admin: false };
  const member = await memberStatus(session.uid, session.email);
  const admin = !!process.env.ADMIN_EMAIL && !!session.email && session.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
  const active = admin || member?.status === 'active';
  return { session, member, active, admin };
}

export async function getViewer(): Promise<Viewer> {
  const jar = await cookies();
  return viewerFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** For API routes: read the session from the request cookie header. */
export async function viewerFromRequest(req: Request): Promise<Viewer> {
  const c = req.headers.get('cookie') ?? '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(`${SESSION_COOKIE}=`));
  return viewerFromToken(m ? decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)) : undefined);
}

export function unauthorized(reason = 'membership required') {
  return Response.json({ error: reason }, { status: 401, headers: { 'cache-control': 'no-store' } });
}
