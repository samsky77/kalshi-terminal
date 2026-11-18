import { LegalPage } from '@/components/legal';

export const metadata = { title: 'Responsible Gambling' };

export default function RG() {
  return (
    <LegalPage title="Responsible Gambling" updated="November 17, 2026">
      <p>Sigmaline is for adults 21+ and is information only. Betting should be entertainment, never a way to make money you need.</p>
      <h2>Get help now</h2>
      <ul>
        <li><b>1-800-GAMBLER</b> (1-800-426-2537): National Problem Gambling Helpline, 24/7, call or text. <a className="text-amber underline" href="https://www.1800gambler.net">1800gambler.net</a></li>
        <li><b>National Council on Problem Gambling:</b> <a className="text-amber underline" href="https://www.ncpgambling.org/help-treatment/">ncpgambling.org</a>, with chat and local resources.</li>
        <li><b>Gamblers Anonymous:</b> <a className="text-amber underline" href="https://www.gamblersanonymous.org">gamblersanonymous.org</a></li>
        <li><b>Gam-Anon (for family and friends):</b> <a className="text-amber underline" href="https://www.gam-anon.org">gam-anon.org</a></li>
        <li><b>Outside the US:</b> <a className="text-amber underline" href="https://www.begambleaware.org">BeGambleAware (UK)</a>, <a className="text-amber underline" href="https://www.gamblingtherapy.org">Gambling Therapy (worldwide)</a></li>
      </ul>
      <h2>Warning signs</h2>
      <ul>
        <li>Betting more than you planned, or chasing losses.</li>
        <li>Borrowing money, or hiding betting from people close to you.</li>
        <li>Feeling anxious or irritable when you&apos;re not betting.</li>
      </ul>
      <h2>Tools that help</h2>
      <ul>
        <li>Set deposit, loss and time limits at your sportsbook. Licensed US books are required to offer them.</li>
        <li>Self-exclude through your state&apos;s program or at the sportsbook.</li>
        <li>Turn off Sigmaline alerts on the Alerts page, or cancel your membership at any time on Whop.</li>
      </ul>
      <p>Sigmaline&apos;s grades describe estimated value, not certainty. Every bet can lose.</p>
    </LegalPage>
  );
}
