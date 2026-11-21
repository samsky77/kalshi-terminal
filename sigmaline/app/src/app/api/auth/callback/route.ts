import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { memberStatus } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { cookieOptions, SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from '@/lib/session';
import { hasAccess, type MemberState } from '@/lib/membership';
import { exchangeCode, userInfo } from '@/lib/whop';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const tx = await verifySession(jar.get('sl_oauth')?.value);
  const fail = (e: string) => NextResponse.redirect(new URL(`/login?error=${e}`, req.url));
  if (!tx) return fail('expired');
  const { state, verifier, next, age } = JSON.parse(tx.uid) as { state: string; verifier: string; next: string; age: number };
  if (url.searchParams.get('state') !== state) return fail('state');
  const code = url.searchParams.get('code');
  if (!code) return fail('denied');
  try {
    const tok = await exchangeCode(code, verifier);
    const u = await userInfo(tok.access_token);
    const db = await getDb();
    await db.upsert('members', { whop_user_id: u.sub, email: u.email ?? null, username: u.preferred_username ?? null, age_confirmed_at: new Date(age).toISOString() }, 'whop_user_id');
    // force a fresh access check at sign-in
    await db.update('members', { whop_user_id: u.sub }, { checked_at: null });
    const m = await memberStatus(u.sub, u.email ?? null);
    const session = await signSession({ uid: u.sub, email: u.email ?? null, exp: Date.now() + SESSION_DAYS * 86400000 });
    const admin = !!process.env.ADMIN_EMAIL && u.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
    const dest = hasAccess(m as MemberState | null) || admin ? next : `/?membership=${m?.status === 'trial_used' ? 'trial_used' : 'inactive'}`;
    const res = NextResponse.redirect(new URL(dest, req.url));
    res.cookies.set(SESSION_COOKIE, session, cookieOptions(SESSION_DAYS * 86400));
    res.cookies.set('sl_oauth', '', cookieOptions(0));
    return res;
  } catch {
    return fail('whop');
  }
}
