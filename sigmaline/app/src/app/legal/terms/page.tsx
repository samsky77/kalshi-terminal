import { LegalPage } from '@/components/legal';

export const metadata = { title: 'Terms of Service' };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="November 17, 2026">
      <h2>1. What Sigmaline is</h2>
      <p>Sigmaline provides sports information and analysis only: simulated fair prices, expected-value estimates, grades and commentary. Sigmaline is not a sportsbook. It does not accept, place, hold or broker wagers, does not handle your money for betting, and never connects to your sportsbook accounts. Nothing on Sigmaline is financial, investment or betting advice, and nothing is a recommendation that you place any bet.</p>
      <h2>2. No guarantee of profit</h2>
      <p>Sports outcomes are uncertain. Our numbers are estimates from models and market data and can be wrong. A bet shown with positive expected value can and often will lose. Past results, including our public track record, do not guarantee future results. You may lose money. Only bet what you can afford to lose.</p>
      <h2>3. Eligibility and your local laws</h2>
      <p>You must be at least 21 years old to use Sigmaline. You are solely responsible for knowing and following the laws that apply where you are, including whether sports betting is legal there and with which operators. Do not use Sigmaline where doing so is unlawful.</p>
      <h2>4. Your licence and data restrictions</h2>
      <ul>
        <li>Your membership gives you a personal, non-transferable, non-exclusive licence to view Sigmaline for your own use.</li>
        <li>You may not copy, scrape, resell, redistribute, republish, share your login, or bulk-export odds, prices, picks or other data from Sigmaline, or use them to build a competing product. Odds and statistics come from third-party providers whose licences forbid redistribution.</li>
        <li>The CSV export on the Results page is for your personal record-keeping only.</li>
      </ul>
      <h2>5. Subscription, billing and refunds</h2>
      <ul>
        <li>Membership is a recurring subscription (currently $25 per month, &ldquo;Founding Member&rdquo; rate) billed through Whop, with a 7-day free trial for new accounts. A card is required to start the trial; you are not charged if you cancel before the trial ends. One free trial per account. Whop&apos;s terms also apply to your payment.</li>
        <li>Your subscription renews automatically each period until you cancel. You can cancel at any time in your Whop account. Access continues until the end of the period you have paid for.</li>
        <li>Except where the law requires otherwise, payments are non-refundable and we do not give refunds or credits for partial periods. If you believe you were charged in error, contact us within 14 days and we will review it in good faith.</li>
        <li>We may change the price with at least 30 days&apos; notice. The change applies from your next renewal.</li>
      </ul>
      <h2>6. Track record</h2>
      <p>Picks are logged automatically before each game and never edited or deleted. Backtest figures are simulations, are labelled &ldquo;Backtest (simulated)&rdquo;, and are not part of the live record.</p>
      <h2>7. Availability</h2>
      <p>The service is provided &ldquo;as is&rdquo;. Data can be delayed, incomplete or unavailable, for example when a provider&apos;s quota is used up. We may change or discontinue features.</p>
      <h2>8. Limitation of liability</h2>
      <p>To the fullest extent permitted by law, Sigmaline and its operators are not liable for any betting losses or for any indirect, incidental or consequential damages. Our total liability for any claim is limited to the amount you paid us in the three months before the claim.</p>
      <h2>9. Termination</h2>
      <p>We may suspend or end access for breach of these terms, including sharing or redistributing data.</p>
      <h2>10. Contact</h2>
      <p>Questions: contact us through the Whop product page.</p>
    </LegalPage>
  );
}
