import Link from 'next/link';
import { Footer, Header, Main } from '@/components/chrome';

export default function NotFound() {
  return (
    <>
      <Header nav="public" />
      <Main><div className="mx-auto max-w-3xl px-4 pt-10"><h1 className="text-[18px]">Not found</h1><p className="mt-2 text-[13px] text-muted">That page or game doesn&apos;t exist (or the game has been removed from the board).</p><Link href="/" className="tap mt-4 inline-flex items-center text-amber underline">Home</Link></div></Main>
      <Footer />
    </>
  );
}
