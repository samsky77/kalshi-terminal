import { Footer, Header, Main } from '@/components/chrome';
import { checkoutUrl } from '@/lib/whop';

export const metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long. Please try again.',
  state: 'Sign-in could not be verified. Please try again.',
  denied: 'Sign-in was cancelled.',
  whop: 'Whop sign-in failed. Please try again in a minute.',
  not_configured: 'Sign-in is not configured yet (WHOP_CLIENT_ID missing).',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/slate';
  return (
    <>
      <Header nav="public" />
      <Main>
        <div className="mx-auto max-w-md px-4 pt-8">
          <h1 className="text-[20px] font-semibold">Sign in</h1>
          <p className="prose-sl mt-2 text-[14px] text-muted">Members sign in with their Whop account.</p>
          {sp.error && <p role="alert" className="mt-3 border border-amber px-3 py-2 text-[13px] text-amber">{ERRORS[sp.error] ?? 'Something went wrong.'}</p>}
          <form action="/api/auth/login" method="get" className="mt-4">
            <input type="hidden" name="next" value={next} />
            <label className="tap flex cursor-pointer items-center gap-3 text-[13px]">
              <input type="checkbox" name="age" value="1" required className="h-5 w-5 accent-[#FFB000]" />
              <span>I confirm I am 21 or older.</span>
            </label>
            <button type="submit" className="tap mt-3 w-full bg-amber px-4 text-[14px] font-bold uppercase tracking-[0.14em] text-black">Sign in with Whop</button>
          </form>
          <p className="mt-6 text-[12px] text-muted">Not a member yet? <a className="tap inline-flex items-center text-amber underline" href={checkoutUrl()}>Join on Whop</a></p>
        </div>
      </Main>
      <Footer />
    </>
  );
}
