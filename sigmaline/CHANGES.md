# Sigmaline: what changed in this pass

Branch `claude/nice-davinci-pk0fzn`. Phase 0 is in `BASELINE.md`, QA tickets are in `tickets/` (index: `tickets/INDEX.md`), and the owner steps are at the top of `README.md`.

**Status in one line:** all nine Phase 1 items are implemented and tested, 121 QA tickets were filed (all 5 P0s and 18 of 19 P1s are fixed, P0/P1 fixes re-verified by the agents that filed them), and the code is pushed. **It is not deployed to production yet**, for the reasons in "Needs your decision".

---

## Before / after

| Metric | Before (Phase 0) | After |
|---|---|---|
| Lighthouse mobile, slate (NBA) | Perf 95 · LCP 2.4 s · SI 2.6 s · FCP 2.3 s · A11y 100 | **Perf 99 · LCP 2.0 s** · SI 1.1 s · FCP 1.1 s · A11y 100 |
| Slate (CBB, 76 games) | not measured | Perf 97 · LCP 2.1 s |
| Game page | Perf 98 · LCP 2.2 s | Perf 97 · LCP 2.4 s (now also renders props + two write-ups) |
| Edge Finder | did not exist | Perf 99 · LCP 2.0 s |
| Landing | Perf 98 · LCP 2.1 s | Perf 97 · LCP 2.4 s · A11y 100 |
| Slow 3G (400 kbps, 400 ms, 4× CPU), slate | not measured | LCP 1.6 s, 19 requests, 182 KB |
| Render-blocking third-party CSS | Google Fonts (~1.6 s est.) | none (self-hosted IBM Plex) |
| First-load JS per route | 105–107 KB | 106 KB |
| Odds-API calls per page load | 0 | **0** (the app reads one `feed_cache` row; only the worker calls providers) |
| Slate DB work per request | all `market_prices` rows for the sport (3,862 CBB rows ≈ 570 ms; 23k CFB rows) + 2,000 snapshot rows | one cached row (rebuilt each tick), live fallback only if the cache is older than 20 min |
| Worker tick | 3–12 min (loaded every snapshot an event ever had) | reads only the newest pull |
| Production DB | **710 MB (free tier 500 MB)**, 3.1M snapshot rows | ~1.2M rows deleted during recon; retention now runs every tick (needs migration 0002 + one `vacuum full`) |
| Tick cadence | GitHub ran the `*/15` cron every 4–6 h; 41/44 graded picks had no CLV | Netlify scheduled function dispatches the worker every 15 min (needs `GH_DISPATCH_TOKEN`) |

Acceptance (item 2): mobile Performance ≥ 85 ✓ (97–99), slate LCP < 2.5 s ✓ (2.0 s), odds-API calls per page load = 0 ✓. Measured on the production build served locally; see "Assumptions".

---

## Per item

### 1. 7-day free trial (Whop)
- **Membership states** trialing / active / past_due / canceled / expired / trial_used, applied through one pure reducer (`app/src/lib/membership.ts#applyEvent`):
  - it ignores out-of-order events and impossible transitions;
  - it allows one free trial per Whop account;
  - a cancel can't revive an account or extend its period.
- **Access rule (`hasAccess`):**
  - trialing / active: until the period end, plus 12 h for a late renewal webhook;
  - past_due: grace of at most 3 days after the period end;
  - canceled: until the paid-through date;
  - deactivation / went-invalid: access ends immediately.
- **Server-side only:**
  - Standard-Webhooks signature checked, idempotent on the webhook id, the event recorded as processed only after it is applied, and an event must name the configured product;
  - Whop's access API is the backstop through a 10-minute cache, and an unreachable or unconfigured API keeps the webhook state.
- **UI:**
  - landing reads "Start 7-day free trial", then $25/month after the trial, with card-required fine print and a trial FAQ;
  - the 21+ gate is a real disabled button until ticked;
  - Account shows trial end / first charge / renewal / access-until;
  - reason banners for trial used, ended and payment failed;
  - Results stays public.
- **Tests:**
  - `app/test/trial.test.ts` drives the real webhook handler with signed events (trial → access, cancel → access until period end → removed, forged signature rejected, repeat trial blocked);
  - `app/test/trial-regressions.test.ts` covers every TRI/CAN ticket;
  - `app/scripts/secrets-check.mjs` (in CI) builds with dummy secrets and fails if any server secret value or name reaches the client bundle (it passes).
- **Gaps:** Whop plan configuration (7-day trial, collect card up front) is a dashboard step I can't do from here (README step 4). Per-card repeat-trial blocking is up to Whop; the app blocks per Whop account.

### 2. Bugs and slow loading
- All 20 BASELINE bugs are addressed. Each is fixed, except B19 (demo has no soccer), which is a demo-data artifact.
- **Feed cache:** `feed_cache`, built by the worker each tick (`packages/db/src/feed.ts`), so the app reads one row.
- **Faster tick:** `latestPull` reads only the newest pull.
- **Storage guard:** only lines that can ever be graded are stored.
- **Retention:** `prune_snapshots()` runs every tick, plus a nightly VACUUM.
- **Netlify `kick-worker`** scheduled function.
- **Front end:**
  - self-hosted fonts;
  - no link-prefetch storms, plus a pending bar on taps for slow connections;
  - loading skeletons, and layout-level paywalls so non-members get a real redirect;
  - long slates show 40 rows plus "Show all";
  - service worker caches the shell, fonts and public pages, never paid data or `/api/`;
  - Content-Security-Policy header;
  - `/api/health` no longer exposes job detail.

### 3. Player props for every sport
- **Which markets:** each sport's markets come from the providers' published lists (`PROP_MARKETS` in `packages/core/src/sports.ts`).
  - NBA 8, CBB 4, NFL 10, CFB 5, NHL 6, soccer 8 (both naming styles).
  - Tennis: none. PropLine mentions aces / games-won props but publishes no keys, so tennis shows "provider doesn't send tennis player props yet".
  - Ingest keeps only requested markets.
- **Cost:** props ride the PropLine bulk call, 1 request per sport per pull. The Odds API is never used for props (it charges per market per event, with a 500-credit month).
- **Pricing:**
  - same pipeline as game lines: no-vig consensus → simulation where a player model ran → edge → grade;
  - without a player model the row is labelled **consensus-only** and can be B at most (never A);
  - Yes/No markets (anytime scorer / TD / card) are Over/Under 0.5;
  - PropLine's `player_team` places players for the NBA/NFL player model.
- **UI:**
  - a Props tab per sport, plus props on each game page and in the Edge Finder;
  - every row shows book, price, fair, edge %, grade, updated time and consensus-only;
  - clear empty states.
- **Settlement:**
  - every requested market has a box-score mapping (a test enforces it);
  - open prop edges get post-game box scores, at most 40 requests per tick.

### 4. Edge Finder
- `edgePct = fair probability × decimal odds − 1` (+ p_push) in `packages/core/src/edge.ts`. EV, CLV and the write-ups all use it, with hand-worked tests.
- `/edges` filters by sport, market type (game / prop), book, minimum edge and grade, and sorts by edge, start or last update.
  - The filter function is tested across every combination.
  - Junk query params fall back to defaults.
  - The form always shows the active filters.

### 5. Edge log
- **Schema:** migration `supabase/migrations/0002_edges_trial_feed.sql`:
  - `edges_log`, one row per `event|market|selection|line|book` on first appearance;
  - `first_shown_at` is stamped by the DB clock, and only before the start;
  - original fields are immutable and DELETE / TRUNCATE are blocked, by triggers and column-level grants;
  - closing / CLV and result / units are fillable exactly once.
- **Price changes** go to the append-only `edge_price_updates`.
- **Worker:**
  - logs in `saveSim` (server-side);
  - closes after the start, from the closing snapshot or the latest pull within 30 min, never estimated;
  - settles from finals, at a flat 1u.
- **Results page:** a public "Every edge we've shown" section; non-members see started games only.
- **Tests:** on real Postgres (PGlite, `packages/db/test/migrations.test.ts`) plus the worker tests:
  - an edge appearing gives exactly one row with the server time;
  - backdating is ignored;
  - UPDATE of any original field fails, and DELETE / TRUNCATE fail;
  - settlement fields can't be overwritten.

### 6. Grades match the FAQ
- **One config:** `packages/core/src/grades.ts` (`GRADE_CONFIG`) is the only place boundaries live. `gradeFaqAnswer()` renders the FAQ from it, and the admin screen can no longer edit grade thresholds.
- **Drift test:** `test/grades.test.ts` checks every percentage the FAQ states against the config, every boundary against `gradePick`, and that the landing page uses the rendered answer.
- **FAQ wins:**
  - B is 2–5% only, so ≥ 5% without model/consensus agreement is "No edge" (was B);
  - consensus-only rows can't be A (nothing independent to agree);
  - the hidden "5 books" rule now applies only to alternate lines and is stated in the FAQ.
- **Graded items whose grade changed:**
  - no published pick changes: every B pick in production has EV < 5% (max 4.83%);
  - consensus-only A picks would now be at most B;
  - the demo shows two: St Mary's ML +7.3% A → no grade.
  - The production list can't be pulled without a DB query (see decisions). `market_prices` grades recompute every tick, so the live board follows the FAQ automatically.

### 7. "Updated X min ago" on every price
- Every price stores its best book's own `last_update` (`price_ts`), not fetch time. Provider times later than our fetch are clamped.
- A ticking client label `<Ago>` shows the age. Past 10 min the row is dimmed (contrast kept ≥ 4.5:1), tagged STALE, and its grade and edge are hidden live.
- Stale rows never reach the edge feed, grades or the log. A stale book is left out of best price and consensus when fresh books exist.

### 8. Junk rows
- `packages/core/src/feed.ts#filterFeed`, with each case counted:
  - no price, no fair price, started event, duplicate;
  - suspended / zero-limit, dropped at ingest;
  - stale;
  - edge above +25%, written to `data_anomalies` once per selection, book and price.
- Very negative edges are ordinary bad prices and stay visible.
- Both sides of one market graded (an arbitrage between books, i.e. one stale price) → neither is graded.
- Per-run counts go to `feed_filter_log`, which reconciles (`rows_in = kept + drops`).

### 9. Per-sport write-ups
- One game-line template and one prop template per sport, built only from stored facts; a missing fact skips the sentence.
  - NBA rest and injuries; CBB late news; NFL/CFB key numbers and game script; NHL empty-net / OT; soccer draw risk; tennis best-of format and retirements.
  - Each sport uses its own start word.
- The test renders a game line, moneyline, total and prop for every sport with no undefined / NaN / placeholder text, and no football wording outside football.
- "Key factors" only shows what the data supports.

---

## QA swarm (Phase 2–3)

18 tester agents, one persona each, with one agent per sport for props. They tested the production build served locally, as two QA servers plus read-only production pages. The coordinator dedupe and index are in `tickets/build_index.py` and `tickets/INDEX.md`.

| Severity | Filed | Fixed | Won't fix | Open |
|---|---|---|---|---|
| P0 | 5 | 5 | 0 | 0 |
| P1 | 19 | 18 | 0 | **1** |
| P2 | 49 | 41 | 8 | 0 |
| P3 | 48 | 26 | 7 | 15 |
| **Total** | **121** | **90** | **15** | **16** |

(Exact per-ticket status, duplicates and reasons are in `tickets/INDEX.md`.)

- **P0s (all fixed and re-verified by the agents that filed them):**
  - repeat free trial via follow-up events (TRI-001/002);
  - out-of-order Whop events restoring access (TRI-003);
  - trial chaining through a cancel event (CAN-001);
  - the session secret falling back to a public dev value when only `DATABASE_URL` is set (SEC-001). Production has `SESSION_SECRET`, so this was not exploitable live.
- **Edge math:** no wrong edge math was found. The edge-math agent recomputed all 1,748 priced rows independently.
- **Won't fix:** these are demo-data artifacts, deliberate rules, or by-design behavior:
  - one-sided Yes-only props get no invented fair price;
  - PropLine has no UCL key;
  - two separate records on Results (picks vs edge log).
- **Re-verification:** after the fixes, the trial and canceled-user agents re-ran every scenario on the rebuilt server: TRI 15/15 and CAN 4/4 fixed, no paid-data leak. The other agents' findings are covered by unit or regression tests, not re-run end to end (usage limits; see risks).

### The one open P1: AND-001
On the paywall QA server only, switching from another sport to the NHL tab idles ~14.5 s client-side. The server answers in ~30 ms, there's no CPU work and no network activity. The same build with demo-open (port 3100), and every other sport, take ~100 ms. I didn't find the cause in a time-boxed investigation; it may be specific to the local demo file database. **Check it on a real Netlify deploy (a deploy preview) before production.**

---

## Assumptions (fill-ins left blank)
- **FAQ source of truth:** the FAQ as published on 2026-11-21 ("A ≥ 5% with model and consensus agreeing; B 2–5%"). Its silent cases were resolved strictly (see item 6).
- **Known edge-finder bugs:** none were given. They were found in Phase 0 and QA (B16, EFP-*, SHP-*).
- **Odds/props source:** the repo's providers.
  - PropLine (1,000 requests/day, bulk props included) for lines and props;
  - The Odds API (500 credits/month) for game-line top-ups only.
  - Verified against both providers' docs (BASELINE §3). Estimated use after props is ~220–300 PropLine requests/day, inside the free tier.
- **Trial:** 7 days, card up front, handled by Whop.
- **Stale threshold:** 10 minutes, the default.
  - With a 15-minute tick, prices go stale between ticks, so the Edge Finder is empty for part of each cycle. This is honest, but it's a product trade-off (see decisions).
  - The local demo stretches the threshold via `DEMO_STALE_MINUTES` (demo file DB only).
- **Deploy preview:** the Netlify CLI couldn't resolve the site through this environment's network proxy (API calls work, deploy doesn't). All QA ran on the identical production build served locally, plus read-only production pages.
- **Box-score field names** for new prop markets (`blocks`, `saves`, `shots_on_target`, …) are best guesses; PropLine doesn't document them. Check them against one live response.

## Remaining risks
1. **Not deployed.** Production still runs the old code: the old FAQ grades, the public health detail, and GitHub's unreliable cron.
2. **Migration 0002 isn't applied** to production. The new code tolerates that and falls back to live builds, but there's no edge log, no retention and no trial columns until it's applied.
3. **The DB is still over the free tier** until `vacuum full odds_snapshots;` runs once.
4. **AND-001** (above) is unexplained.
5. **Live provider shapes are unverified:** prop keys and box-score fields per sport, PropLine `player_team`, and Whop webhook payload fields (`updated_at`, `renewal_period_end`, `cancel_at_period_end`). The code is defensive: unknown keys are dropped, missing fields skipped, nothing guessed.
6. **Model honesty:** most games and all non-NBA/NFL props are consensus-only, i.e. line shopping. The landing still says "Every game simulated 10,000 times". Game pages now explain consensus-only, but the marketing claim deserves a look.
7. **Partial re-verification:** only the trial and canceled-user personas were re-run end to end after fixes. The rest is covered by regression tests.

## Needs your decision
1. **Ship it.** Apply migration 0002 and run `vacuum full odds_snapshots;` in the Supabase SQL editor. Production SQL needed a human OK, so I stopped running it once you were away.
2. **Deploy.** The steps:
   - add `GH_DISPATCH_TOKEN` in Netlify;
   - set up the Whop trial plan and webhooks (README "New in this release");
   - merge this branch and deploy;
   - check AND-001 on a deploy preview first.
3. **Stale threshold vs tick cadence.** Either keep 10 minutes (edges vanish between 15-minute ticks), or raise it to about 20 minutes. Ticking every 5 minutes would exceed PropLine's 1,000/day with 7 sports.
4. **Refunds and chargebacks (CAN-002): decided.** A deactivation / went-invalid event ends access immediately. A normal cancel keeps access to the paid-through date.
5. **Consensus-only props for sports with no player model** (CBB, CFB, NHL, soccer). They're shown and capped at B today. Keep them, or hide them until a model exists (PCBB-002)?
6. **Design-token contrast (A11-007).** The control borders are #2A2A2A on black, 1.38:1 against WCAG's 3:1 for non-text. Changing them is a small design change you asked me not to make unilaterally.
7. **Marketing wording (CAS-021):** "Top pick" and "the bets worth making", plus the "every game simulated" claim above.
8. **PWA icon (AND-002):** the icons are plain amber squares and need a real logo asset.
9. **Grade changes in production.** The list of graded items whose grade changed needs one read-only query on production. I can run it when you're back:

```sql
select event_id, selection_key, ev, grade from market_prices where grade <> 'none' and (fair_source = 'consensus' or ev >= 0.05);
```
