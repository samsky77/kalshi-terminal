# Sigmaline

Sigmaline is a phone-first "Bloomberg terminal for sports betting":

- It Monte Carlo-simulates every game on the slate, 10,000 seeded runs each.
- It compares each simulated fair price with the best price at a bettable sportsbook.
- It flags only the bets with positive expected value, and every flagged pick goes into a public, hash-chained track record.

Read-only, information only. Sigmaline never places, holds or brokers bets and never connects to sportsbook accounts.

```
sigmaline/
  app/            Next.js (App Router) + Tailwind PWA — deployed on Netlify
  worker/         scheduled jobs (odds, sims, picks, alerts, grading, nightly, backtests) — run by GitHub Actions
  packages/core/  odds math, models, grading, hash chain, budgeter, write-ups (shared, unit-tested)
  packages/db/    data layer (Supabase / Postgres / demo file)
  supabase/       SQL migration (schema, RLS, append-only triggers, append_pick)
  docs/           licensing.md, decisions.md, model.md
  fixtures/       recorded real odds responses (tests + local demo only)
```

> **Have a lawyer review the Terms before scaling.** The Terms, Privacy and Responsible Gambling pages are drafts.

---

## What you need to do (owner checklist)

Everything below can start on free plans. Check your Netlify plan's limits before the first paying user.

### 1. Supabase (database)

1. Create a project at supabase.com (free tier).
2. Open **SQL Editor**, paste all of `sigmaline/supabase/migrations/0001_init.sql`, and run it. Running it twice is safe.
3. Go to **Project Settings → API** and copy the `Project URL` → `SUPABASE_URL`, the `anon` key → `SUPABASE_ANON_KEY`, and the `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is a secret. It only ever goes in Netlify and GitHub secrets, never in the browser.

Row-level security is on for every table, with no policies. Browsers can read nothing directly; every read goes through the server after a membership check.

### 2. Whop (payments + sign-in)

1. Create the product: **"Sigmaline — Founding Member", $25/month recurring**. Copy its product id (`prod_…`) → `WHOP_PRODUCT_ID` and its checkout link → `NEXT_PUBLIC_WHOP_CHECKOUT_URL`.
2. In **Developer → Apps**, create an app:
   - Under OAuth, add the redirect URI `https://YOUR-DOMAIN/api/auth/callback` (and `http://localhost:3000/api/auth/callback` for local testing).
   - Copy the client id → `WHOP_CLIENT_ID` and the client secret → `WHOP_CLIENT_SECRET`.
3. Create an **API key** that can read memberships and user access → `WHOP_API_KEY`.
4. Add a **webhook**:
   - URL: `https://YOUR-DOMAIN/api/webhooks/whop`
   - Events: membership activated / went valid, membership deactivated / went invalid, payment succeeded
   - Copy the signing secret → `WHOP_WEBHOOK_SECRET`.
5. **Do not** add Whop's Discord app. Alerts go to Discord through a plain webhook (step 5).
6. Set `ADMIN_EMAIL` to the email on **your** Whop account. Signing in with it unlocks `/admin`.

### 3. Data providers

| Provider | Sign up | Env var | Notes |
|---|---|---|---|
| PropLine | prop-line.com (free, 1,000 requests a day) | `PROPLINE_API_KEY` | Primary feed for game lines, props, scores and injuries. |
| The Odds API | the-odds-api.com (free, 500 credits a month) | `ODDS_API_KEY` | Tops up thin markets; fallback for scores. |
| SharpAPI | sharpapi.io (free) | `SHARPAPI_KEY` | **Leave `SHARPAPI_ENABLED=false`** until SharpAPI confirms **in writing** that the free plan lets you show its odds to paying users. Record the confirmation in `docs/licensing.md`. From Dec 1, 2026 its screens must say "Data provided by SharpAPI"; the app does this automatically. |

### 4. Web Push keys

```bash
cd sigmaline && npm install && npm run worker -- vapid
```

Copy the three printed values into `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT=mailto:your-email`.

### 5. Discord

- **Members channel:** Channel settings → Integrations → Webhooks → New webhook → copy its URL → `DISCORD_WEBHOOK_URL`. Put the channel's invite link in `NEXT_PUBLIC_DISCORD_INVITE_URL`.
- **Your private error channel:** create a second webhook → `DISCORD_ERROR_WEBHOOK_URL`. Failed jobs post there, and GitHub also emails you when a scheduled run fails.

### 6. Netlify (web app)

The repo root has a `netlify.toml` that builds `sigmaline/app` with Netlify's Next.js runtime. You don't need to set any build settings by hand.

1. app.netlify.com → **Add new site → Import an existing project** → GitHub → pick this repo.
2. Pick the branch to deploy (`main` once this is merged). Leave the base directory, build command and publish directory blank; `netlify.toml` sets them (base `sigmaline`, `npm run build`, `app/.next`).
3. **Site configuration → Environment variables**: add the "Netlify" variables from the table below, then **Deploys → Trigger deploy**.
4. Set `APP_URL` to your site URL (for example `https://sigmaline.netlify.app`, or your custom domain) and redeploy. Use the same URL for the Whop OAuth redirect and webhook in step 2.
5. Before you take the first payment, check that your Netlify plan's limits (function invocations, bandwidth) fit your traffic.

Vercel still works too: set its Root Directory to `sigmaline/app`.

### 7. GitHub Actions (the worker)

The workflows are `.github/workflows/sigmaline-worker.yml` (every 15 min tick, nightly, weekly backtests) and `sigmaline-ci.yml` (tests, build and paywall check on every push).

1. **Merge this branch into the default branch (`main`).** GitHub only runs scheduled workflows from the default branch.
2. **Settings → Secrets and variables → Actions**:
   - **Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ODDS_API_KEY`, `PROPLINE_API_KEY`, `SHARPAPI_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `DISCORD_WEBHOOK_URL`, `DISCORD_ERROR_WEBHOOK_URL`.
   - **Variables:** `APP_URL`, `VAPID_SUBJECT`, and when you're ready, `PROPS_NBA_ENABLED=true`, `PROPS_NFL_ENABLED=true` and `SHARPAPI_ENABLED=true`.
3. **Actions → sigmaline-worker → Run workflow**:
   - Run `history` once, to import NFL (nflverse, CC BY 4.0) and soccer (openfootball, CC0) results.
   - Then run `backtest`.
   - Then run `tick` to see the first pulls.
4. **Public vs private repo.**
   - The repo is currently **public**, so anyone can read the model code. Secrets stay safe in GitHub Secrets.
   - Public repos get unlimited Actions minutes, but **GitHub pauses scheduled workflows after 60 days with no commits**. Push something, or re-enable the workflow, if that happens.
   - A private repo gets 2,000 free minutes a month. A 15-minute tick needs about 3,000 runs, so a private repo means a paid plan or changing the tick to `*/30`.

### Environment variables

Everything is listed in `sigmaline/.env.example`.

| Variable | Where it goes | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Netlify + GitHub | Database (server only) |
| `SUPABASE_ANON_KEY` | Netlify | Reserved (RLS denies anon reads) |
| `WHOP_API_KEY`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_WEBHOOK_SECRET`, `WHOP_PRODUCT_ID` | Netlify | Sign-in, membership check (10-min cache), webhooks |
| `NEXT_PUBLIC_WHOP_CHECKOUT_URL` | Netlify | "Join" button |
| `SESSION_SECRET` | Netlify | 32+ random characters (`openssl rand -hex 32`) |
| `APP_URL` | Netlify + GitHub var | OAuth redirect and alert deep links |
| `ADMIN_EMAIL` | Netlify | Your Whop email → `/admin` |
| `ODDS_API_KEY`, `PROPLINE_API_KEY`, `SHARPAPI_KEY`, `SHARPAPI_ENABLED` | GitHub | Data providers |
| `PROPS_NBA_ENABLED`, `PROPS_NFL_ENABLED` | GitHub var | Prop feature flags (default off) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | GitHub | Sending push |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Netlify | Subscribing to push |
| `DISCORD_WEBHOOK_URL`, `DISCORD_ERROR_WEBHOOK_URL` | GitHub | Member alerts / your error alerts |
| `NEXT_PUBLIC_DISCORD_INVITE_URL` | Netlify | "Join the members channel" link |
| `WRITEUP_PROVIDER` | GitHub | `template` (default). An LLM can only ever receive the structured facts. |

---

## Local development

Requires Node 20+. The demo needs no keys at all.

```bash
cd sigmaline && npm install
```

```bash
npm test
```

```bash
npm run worker -- demo
```

```bash
cd app && DEMO_OPEN=1 npm run dev
```

Open http://localhost:3000/slate in a phone-sized window.

- `npm run worker -- demo` replays real recorded odds through the whole pipeline: simulation, picks, hash chain, closing lines and grading. It writes `app/.data/demo-db.json`.
- **Demo results are sampled from the model, not real**, and every screen shows a "DEMO DATA" banner.
- `DEMO_OPEN=1` skips sign-in. It only works with the demo file database.

To run against real services, copy `.env.example` to `app/.env.local` (and export the same variables for the worker), then:

```bash
npm run worker -- tick
```

### Worker commands

`npm run worker -- <command>`:

| Command | What it does |
|---|---|
| `tick` | Every 15 min: budgeted odds pulls (pre-game 60–90 min, closing, slate refresh) → simulations → publish picks → alerts → closing lines → finals → grading |
| `nightly` | Calibration reports, w/half-life retune (±0.05 / ±5%, kept only if held-out log loss improves), new model versions |
| `history` | Import licensed historical results |
| `backtest [sport…]` | Walk-forward backtests → `backtest_runs` ("Backtest (simulated)") |
| `budget` | Quota usage and projections |
| `vapid` | Generate Web Push keys |
| `demo` | Local demo database |

---

## How the important guarantees are enforced

- **Picks are logged before the game starts and are never edited or deleted.**
  - Postgres enforces `created_at < commence_time`, blocks UPDATE, DELETE and TRUNCATE on `picks` and `pick_results`, and `append_pick()` checks the hash chain under a lock.
  - Each row's SHA-256 covers its contents plus the previous hash. The Results page recomputes the whole chain in the browser.
  - Picks for unstarted games are *sealed* for the public: their hash is published, and their contents unlock at kick-off.
- **No invented facts.** Write-ups are templates filled only from stored facts. If a fact is missing, that sentence is skipped. The model is only cited when an independent model actually ran.
- **Paid data is server-only.** Every paid page and API route checks the session plus an active Whop membership, cached 10 minutes. `app/scripts/paywall-check.mjs` calls the routes directly, and CI runs it.
- **The $0 data budget.** The budgeter runs per provider:
  - At 80% of quota, only pre-game and closing pulls run. At 100%, pulls stop and the slate shows "Prices as of…".
  - The Odds API is also paced to a daily share of the month.
  - Projection: PropLine about 160 of its 1,000 daily requests; The Odds API within 500 a month.
  - See Admin → Provider quotas, or `npm run worker -- budget`.
- **Backtest and live are separate.** They use separate tables and every backtest is labelled "Backtest (simulated)". Headline numbers on the landing page come from the live record only, always with the bet count and date range.

## Honest model status (read before marketing)

On ~2,600 NFL games with nflverse closing lines, the results-only rating model scored Brier 0.222 against **0.210 for the closing market**. Betting it at closing prices lost 8% (1,019 bets).

So:

- This is expected: free scores-only data doesn't beat the closing market by itself.
- The product's edge has to come from **line shopping before the close**: the best book's price 60–90 minutes out compared with the no-vig consensus. On a cold start, before enough results are stored for ratings, picks are line-shopping only by design.
- **Watch average CLV on the Results page.** Sustained positive CLV is the evidence that the picks have value. Until you have it, don't promise profit.

See `docs/model.md` and `docs/decisions.md`.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| 7 sports produce fair prices for ML, spread and total; NBA/NFL props behind flags | ✅ Simulated and priced for all 7 (tested on recorded real odds). Props are code-complete behind `PROPS_*_ENABLED`; they need a PropLine key to exercise live. |
| Picks logged before start, graded within 6 h, chain verifies | ✅ Enforced by DB constraints. Grading runs every 15 min once a final is ingested. "Verify the chain" passes in the browser. |
| ML, spread and total from one distribution (unit test) | ✅ `packages/core/test/models.test.ts` |
| No-vig and EV math tested against hand-worked examples | ✅ `packages/core/test/odds.test.ts` |
| Unpaid visitors can't reach paid data (routes tested directly) | ✅ `app/scripts/paywall-check.mjs` (anon, forged cookie, signed-in non-member). Runs in CI. |
| A month stays inside every free quota (projection shown) | ✅ Budgeter, plus pacing, plus Admin projection. |
| Push on an installed iPhone PWA and Android Chrome; Discord; no duplicates | ⚠️ Code complete: service worker, VAPID, iPhone install guide, quiet hours, dedupe via `alert_log` (tested). **Needs a real-device check** after deploy: install on iPhone (iOS 16.4+), turn on alerts, then trigger a `tick`. |
| Backtest and live labelled separately everywhere | ✅ |
| Contrast and 44px touch targets at 360px | ✅ `app/scripts/a11y-check.cjs` (axe-core WCAG 2.1 AA + 44px + no horizontal scroll) passes on every screen. |
| README covers setup, env vars, Netlify, Supabase, Whop, Actions | ✅ This file. |

Data credits: NFL schedule data, nflverse (CC BY 4.0). Soccer results, openfootball (CC0).
