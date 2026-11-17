import { LegalPage } from '@/components/legal';

export const metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="November 17, 2026">
      <h2>What we store</h2>
      <ul>
        <li><b>Your Whop account basics:</b> Whop user id, email address and username, from Whop sign-in.</li>
        <li><b>Membership status:</b> active, cancelled or expired, and its end date, from Whop.</li>
        <li><b>Your 21+ confirmation:</b> the time you confirmed it.</li>
        <li><b>Alert settings:</b> your push subscription for each device you turn on (an endpoint URL and encryption keys from your browser), your quiet hours and your time zone.</li>
        <li><b>A sign-in cookie:</b> a signed cookie that keeps you logged in. We use no advertising or tracking cookies.</li>
      </ul>
      <p>We do not store payment card details (Whop handles payments). We do not record your bets, and we never connect to your sportsbook accounts.</p>
      <h2>Processors</h2>
      <ul>
        <li><b>Supabase:</b> database hosting.</li>
        <li><b>Vercel:</b> web hosting. Vercel keeps standard request logs.</li>
        <li><b>Whop:</b> payments, membership and sign-in.</li>
        <li><b>Push services:</b> Apple, Google or Mozilla, which deliver push notifications to your device.</li>
        <li><b>Discord:</b> if you join the members channel, under Discord&apos;s own policy.</li>
        <li><b>GitHub:</b> runs our scheduled jobs. It processes only the data needed to send alerts.</li>
      </ul>
      <h2>How we use it</h2>
      <p>We use your information only to provide the service: checking your membership, sending the alerts you asked for, and supporting you. We do not sell personal information.</p>
      <h2>Retention and your choices</h2>
      <p>You can turn push off at any time on the Alerts page. To have your member record deleted, contact us via Whop. Note that the public pick log contains no personal data, and it is permanent by design.</p>
    </LegalPage>
  );
}
