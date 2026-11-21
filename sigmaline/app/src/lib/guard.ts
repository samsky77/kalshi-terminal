import 'server-only';
import { redirect } from 'next/navigation';
import { getViewer, type Viewer } from './auth';
import { noAccessReason, type MemberState } from './membership';

/** Server-component guard for paid pages: non-members go to the sales page with the reason why. */
export async function requirePaid(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v.session) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!v.active) redirect(`/?membership=${noAccessReason(v.member as MemberState | null)}`);
  return v;
}

/** Signed in, member or not (the Account page: an expired member must still see their status). */
export async function requireSession(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v.session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (!v.admin) redirect('/');
  return v;
}
