import { requirePaid } from '@/lib/guard';

/** Membership check before the loading skeleton streams, so non-members get a real redirect. */
export default async function GameLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePaid(`/game/${id}`);
  return children;
}
