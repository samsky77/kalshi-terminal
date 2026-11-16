# KX Terminal

A phone-only, read-only "Bloomberg-style" value finder for Kalshi sports markets: NBA, NFL, NHL, college football, men's college basketball, tennis and soccer.

For every upcoming game it removes the vig from sportsbook prices, calibrates a Monte Carlo score model (20,000 seeded runs) to that consensus, prices the moneyline and every spread and total strike Kalshi lists, and ranks contracts whose simulated probability beats the Kalshi ask after taker fees.

> The sim is anchored to sportsbook lines; it is not an independent forecast. Model output, not advice. No guarantee of profit. Gambling problem? Call 1-800-GAMBLER.

There is no order placement code anywhere (`tests/readonly.test.ts` enforces this).

- How the model works: [docs/MODEL.md](docs/MODEL.md)
- What was verified on Kalshi's API: [docs/KALSHI.md](docs/KALSHI.md)
- Choices made during the build: [DECISIONS.md](DECISIONS.md)

## 1. Set `ODDS_API_KEY`

1. Get a free key at https://the-odds-api.com (500 credits/month).
2. **Local**: create `.env.local` in the project root:
   ```
   ODDS_API_KEY=your_key_here
   ```
3. **Vercel**: Project → Settings → Environment Variables → add `ODDS_API_KEY` (Production and Preview), then redeploy.

Without a key the app still builds and runs. The server serves the recorded fixtures in `fixtures/odds/`, the Data tab shows "fixtures (no ODDS_API_KEY)", and refreshes cost nothing. The key stays on the server; the phone only talks to this app's `/api/*` routes.

## 2. Run locally

Requires Node 20+.

```bash
npm install
```

```bash
npm test
```

```bash
npm run build && npm start
```

Open http://localhost:3000 in a phone-sized window. To see ranked edges without spending credits, go to **Data → Demo (recorded)**.

## 3. Deploy to Vercel (free tier)

**Dashboard:** push this folder to a GitHub repo → vercel.com → Add New Project → import the repo. The framework is detected as Next.js, so keep the defaults, add `ODDS_API_KEY` as above, and deploy.

**CLI:**

```bash
npm i -g vercel
```

```bash
vercel login
```

```bash
vercel --prod
```

Then add the key with `vercel env add ODDS_API_KEY production` and run `vercel --prod` again.

Notes:
- API routes set `maxDuration = 60`, because loading all soccer leagues takes about 10 s at the 5 requests/s Kalshi throttle. That fits the Hobby plan.
- `fixtures/**` is bundled into the API functions (`outputFileTracingIncludes`) for demo and no-key mode.
- The PWA (service worker and install prompt) needs HTTPS, which Vercel provides.

## 4. Add to your home screen

**iPhone (Safari):** open your Vercel URL in **Safari** → tap the Share button → **Add to Home Screen** → Add. Launch it from the icon; it opens full-screen with no browser bar.

**Android (Chrome):** open the URL in Chrome → ⋮ menu → **Install app** (or **Add to Home screen**) → Install.

After the first load, the last data opens offline (airplane mode): the app shell is cached by the service worker, and Kalshi snapshots, odds, results and the backtest dataset live in IndexedDB on the phone.

## 5. Monthly credit budget (The Odds API free tier: 500/month)

Each call costs markets × regions = **3 credits per sport key** (h2h + spreads + totals, region `us`). Odds refresh **automatically about once a day per sport** (only for games starting within 24 hours, never while the app is in the background), or when you tap **Refresh** on the Data tab. US sports and most soccer come from the free ESPN feed first and cost nothing; the paid feed is the fallback when ESPN has no lines. The Data tab shows the cost and credits left. Only the app's own pages can trigger a refresh, and a repeat within 15 minutes reuses the lines already fetched. It refuses any refresh that would leave fewer than **30** credits, and it only fetches keys that have a matching open Kalshi event.

| Refresh | Keys | Credits |
|---|---|---|
| NBA, NFL, NHL, CBB | 1 each | 3 each |
| College football | 1 (+1 if Kalshi lists FCS games) | 3–6 |
| Tennis | 1 per active tournament with Kalshi matches | 3–12 |
| Soccer | 1 per league with Kalshi matches (about 10–14) | 30–42 |
| **Everything once** | | **about 55–70** |

A plan that fits in 470 usable credits/month:

| Sport | Cadence | Credits/month |
|---|---|---|
| NFL | twice a week (lines Tue, final Sun am) | ~24 |
| College football | twice a week | ~24–48 |
| NBA | daily | ~90 |
| NHL | daily | ~90 |
| College basketball | every other day | ~45 |
| Soccer | once a week (before the weekend) | ~130 |
| Tennis | big events only | ~24 |
| **Total** | | **~430–450** |

Odds are cached on the server for hours and on the phone indefinitely. They're marked **STALE** after 6 hours, so refresh close to game time for the sports you care about.

## Tabs

- **Value**: ranked +EV contracts, filtered by sport, market type, tier (A/B on by default, C off) and minimum edge. Each row shows sim %, ask, fee, edge (¢ per contract) and size at the ask. Tap a row for the game detail.
- **Games**: every Kalshi game per sport, with the moneyline, spread ladder and total ladder (sim %, Yes and No ask, edge per side; • marks a value flag). Games with no sportsbook match are listed as **UNPRICED** and never flagged. Started games are never flagged.
- **Track**: automatic backtest. Value picks (≥2¢ edge, last snapshot before the game started) are logged from the on-device dataset, graded against Kalshi settlements via `/api/settle` once the game should be over, 1 contract each at ask plus fee. Shows hit rate, average sim probability, P&L and ROI by sport, market and tier. It only logs while the app is open.
- **Data**: credits left, last Kalshi and odds refresh per sport, the odds keys and cost per refresh, Refresh buttons, unmatched events (Kalshi and odds, with reasons), Live/Demo switch, and export or clear of the on-device backtest dataset.
- **Game detail**: consensus inputs, the sim's fit to them, margin and total distributions (dashed line = consensus line), model parameters, books used, and odds timestamps.

## Tiers

- **A**: the strike is the consensus main line (or the moneyline).
- **B**: within one score unit (3 points, 1 goal, 1 game).
- **C**: far alternates, or any market where the sim missed its anchor. These depend on the model's tail shape.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests: vig, fees, calibration (synthetic + recorded real consensus for all 7 sports), strikes, tiers, discovery, matcher on all 7 sports, read-only scan |
| `npm run live:kalshi` | Acceptance check 2: live Kalshi run, markets per sport in the next 48 h, zero parlays |
| `npm run check:readonly` | Acceptance check 5: repo scan for order, trade and account endpoints |
| `npm run record:kalshi` | Re-record `fixtures/kalshi/*.json` (free) |
| `npx tsx scripts/record-odds.ts` | Dry run: odds keys and credit cost per sport. Add `--spend` to record fresh odds fixtures (**uses credits**) |
| `npx tsx scripts/run-fixtures.ts` | Run the full pipeline on the fixtures and print the top edges per sport |
| `npx tsx scripts/calib-report.ts` | Calibration fit report on the fixtures |
| `npx tsx scripts/make-icons.ts` | Regenerate PNG icons |

## Out of scope for v1 (designed for, not built)

Candle charts and orderbook depth (the unauthenticated orderbook endpoint works, see KALSHI.md), historical backtesting beyond what the phone has logged, push alerts, independent ratings models, accounts and subscriptions.
