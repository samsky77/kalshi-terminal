import { requirePaid } from '@/lib/guard';

/** Membership check runs here, before the loading skeleton streams, so non-members get a real redirect. */
export default async function EdgesLayout({ children }: { children: React.ReactNode }) {
  await requirePaid('/edges');
  return children;
}
