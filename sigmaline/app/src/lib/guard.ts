import 'server-only';
import { redirect } from 'next/navigation';
import { getViewer, type Viewer } from './auth';

/** Server-component guard for paid pages: non-members are sent to the sales page. */
export async function requirePaid(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v.session) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!v.active) redirect('/?membership=inactive');
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (!v.admin) redirect('/');
  return v;
}
