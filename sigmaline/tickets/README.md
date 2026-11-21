# Sigmaline QA swarm — brief for tester agents

You are testing **Sigmaline**, a paid sports-market-intelligence PWA (black/amber terminal look, phone-first). It shows fair prices, edges and grades for NBA, NHL, NFL, college basketball (CBB), college football (CFB), soccer and tennis, game lines and player props. It never places bets. Code: `sigmaline/` (Next.js app in `sigmaline/app`, shared math in `sigmaline/packages/core`, data layer in `sigmaline/packages/db`, worker in `sigmaline/worker`, SQL in `sigmaline/supabase/migrations`).

## Where to test (all on this machine)

| Target | URL | What it is |
|---|---|---|
| **QA-OPEN** | http://localhost:3100 | Production build, **demo data** (recorded real odds, model-sampled results). Paid screens open without login (`DEMO_OPEN`). Use for UX, data, props, Edge Finder, write-ups. |
| **QA-PAYWALL** | http://localhost:3200 | Same build and data, **paywall ON**. Session cookie `sl_session` is HMAC-signed with `SESSION_SECRET=qa-session-secret-qa-session-secret-000000`; Whop webhooks at `POST /api/webhooks/whop` are verified with `WHOP_WEBHOOK_SECRET=qa_webhook_secret_for_local_tests` (Standard Webhooks: header `webhook-signature: v1,<base64 HMAC-SHA256(secret bytes, "${id}.${timestamp}.${body}")>`, plus `webhook-id`, `webhook-timestamp` in seconds; rejected if older than 5 min). `WHOP_PRODUCT_ID=prod_qa`. Admin email `admin@qa.local`. Use for trial/cancel/expiry, paywall and security. |
| **PROD (read-only)** | https://sigmaline.netlify.app | The live site, still on the **old** code. Public pages only. Never send webhooks, never try to log in, never write anything there. |

How to make a signed-in user on QA-PAYWALL: build the cookie like `app/src/lib/session.ts` does: `base64url(JSON.stringify({uid, email, exp}))` + `.` + `base64url(HMAC-SHA256(SESSION_SECRET, thatBody))`. Membership comes from the `members` table, set by signed webhooks (see `app/src/app/api/webhooks/whop/route.ts` and `app/src/lib/membership.ts`); with no Whop API key configured, a stale (10-minute) membership cache is treated as "Whop says no access". Use a unique `uid` per test (e.g. `qa_<persona>_<n>`), so agents don't collide.

Demo database: `sigmaline/app/.data/demo-db.json` (read it for data checks; don't edit it by hand). The demo's book timestamps are hours old, so both servers run with a stretched stale threshold (`DEMO_STALE_MINUTES`). In production it is `GRADE_CONFIG.staleMinutes` (10). Don't file "everything says updated N hours ago" as a bug. Do file it if a STALE row shows a grade or edge.

Tools: Playwright + Chromium are installed (`require('playwright')`, `chromium.launch()`). Use device profiles (`devices['iPhone 13']`, `devices['Pixel 7']`), network throttling via CDP (`Network.emulateNetworkConditions`), `curl`, and `node`. Lighthouse is at `/tmp/claude-0/-home-user-kalshi-terminal/a1d1566b-ee4f-5efa-8970-c60d93c1a971/scratchpad/lh/node_modules/.bin/lighthouse` (`CHROME_PATH=/opt/pw-browsers/chromium`, flags `--chrome-flags="--headless=new --no-sandbox"`).

## Rules

- **Do not edit any source file, config, database or git state.** You only write tickets and evidence.
- Don't stop or restart the servers. Don't run `npm run build` or `npm run worker` (they would change what others are testing).
- No real money, no real Whop, no order endpoints, no external services except reading PROD's public pages.
- Report only what you observed and can reproduce. Mark guesses as guesses in `suspected_area`.

## Ticket format

One JSON file per finding: `sigmaline/tickets/<YOUR-PREFIX>-NNN.json` (your prefix is given in your task; number from 001). Evidence files (screenshots at deviceScaleFactor 1, logs) go in `sigmaline/tickets/evidence/<YOUR-PREFIX>-NNN.*`.

```json
{ "id": "<PREFIX>-001", "title": "", "severity": "P0|P1|P2|P3", "persona": "", "url": "", "device": "",
  "steps": [], "expected": "", "actual": "", "evidence": "screenshot path / console / network excerpt", "suspected_area": "" }
```

Severity: **P0** payments / auth / data loss / wrong edge math · **P1** broken feature or wrong grade · **P2** UX / performance · **P3** polish.

The product rules you are checking against (Phase 1 acceptance):
- Edge % = fair probability × decimal odds − 1 (push-adjusted: + p_push), one shared function (`packages/core/src/edge.ts`).
- Grades come only from `packages/core/src/grades.ts`; the landing-page FAQ is rendered from it. A: edge ≥ 5% AND model + consensus both +EV. B: 2% ≤ edge < 5%. Otherwise "No edge". Needs ≥ 3 books (props ≥ 2). Game-line edges > 10% and prop edges > 25% are never graded.
- Every price shows "updated X min ago" from the book's own timestamp, ticking live; past the stale threshold the row is dimmed, tagged STALE, and has no grade or edge.
- Junk rows (no price, no fair price, started events, duplicates, suspended, |edge| > 25%) never appear in the feed.
- Edge log (`edges_log`): one row per edge on first appearance, never edited or deleted; the public Results page shows only edges whose game has started.
- Props: a Props tab per sport; each row shows book, price, fair price, edge %, grade, updated time; "consensus-only" when no player model ran; a clear empty state when a sport has no props (demo data has no recorded props, so empty states are expected there).
- Trial: "Start 7-day free trial", price after trial shown; trialing / active / past_due have access, canceled keeps access until period end, expired doesn't; Results page always public; one trial per Whop account.
- Write-ups: no "undefined"/placeholder text, sport-appropriate wording, never invented stats.
- Design: black/amber terminal, phone-first; tap targets ≥ 44px; no horizontal page scroll at 360px.

When done, reply with a short summary: number of tickets by severity and the 3 most important findings.
