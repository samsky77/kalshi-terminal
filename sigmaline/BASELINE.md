# Sigmaline — Phase 0 baseline (2026-11-21)

Read-only recon of `sigmaline/` (branch `claude/nice-davinci-pk0fzn`, from `main` @ 95bb794) plus the live site and its production database.

## 1. Map

| Piece | Where | Notes |
|---|---|---|
| Framework | Next.js 15 App Router + Tailwind, `sigmaline/app` | Deployed on Netlify via the root `netlify.toml` (`@netlify/plugin-nextjs`). |
| Shared math | `packages/core` | Odds math (`odds.ts`), EV and grades (`ev.ts`), pricing (`pricing.ts`), sport models, write-ups (`writeup.ts`), hash chain. |
| Data layer | `packages/db` | One table API over Supabase REST, Postgres (`DATABASE_URL`) or a demo JSON file. |
| Worker | `sigmaline/worker` | `tick` (odds pulls, sims, publish, alerts, closing, grading), `nightly`, `history`, `backtest`. Run by GitHub Actions (`.github/workflows/sigmaline-worker.yml`). |
| DB | Supabase project `fmfbwaeyiiinghsripph`, `supabase/migrations/0001_init.sql` | RLS on, no policies; app connects as `sigmaline_app` through the pooler. |
| Whop | `app/src/lib/whop.ts`, `lib/auth.ts`, `api/auth/*`, `api/webhooks/whop` | OAuth (PKCE), membership check via `GET /api/v1/users/{id}/access/{product}` with a 10-min cache in `members.checked_at`, Standard-Webhooks signature check. |
| Where edges are computed | `core/pricing.ts#priceMarkets` → `core/ev.ts` (`expectedValue`, `gradePick`) | Worker writes `market_prices`; publish picks to `picks` (append-only, hash-chained). |
| Env vars | `sigmaline/.env.example` | Netlify has `DATABASE_URL, APP_URL, SESSION_SECRET, ADMIN_EMAIL, NEXT_PUBLIC_VAPID_PUBLIC_KEY`; no Whop vars yet. |

**Sports in code today (verified):** NBA, NHL, NFL, CBB (NCAAB), CFB (NCAAF), soccer (EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS, UCL), tennis (ATP/WTA). All seven have upcoming events and priced markets in production.

**Props today:** NBA/NFL only, behind `PROPS_*_ENABLED` (both off in prod; 0 prop rows in `market_prices`). Props are priced only when a player model ran; otherwise they are silently dropped.

## 2. Metrics (before)

### Lighthouse, mobile profile (Lighthouse 12.6.1, simulated slow 4G, Moto G-class CPU)

| Page | Perf | A11y | Best practices | LCP | TBT | CLS | Speed Index | FCP |
|---|---|---|---|---|---|---|---|---|
| Slate (local prod build, demo DB) | 95 | 100 | 96 | 2.4 s | 0 ms | 0 | 2.6 s | 2.3 s |
| Landing (local) | 98 | 100 | 100 | 2.1 s | 120 ms | 0.014 | 1.5 s | 1.5 s |
| Results (local) | 96 | 100 | 100 | 2.3 s | 170 ms | 0 | 1.9 s | 1.6 s |
| Game (local) | 98 | 100 | 100 | 2.2 s | 70 ms | 0 | 1.7 s | 1.7 s |
| Landing (production) | 91 | 100 | 96 | 3.2 s | 100 ms | 0 | 2.6 s | 1.9 s |
| Results (production) | 92 | 100 | 96 | 3.0 s | 70 ms | 0 | 2.5 s | 2.1 s |

The production slate is behind the paywall, so its server time was measured on the database instead (below). Largest render-blocking item: the Google Fonts stylesheet (Lighthouse estimates 1.6 s of savings).

### JS per route (next build)

Shared first-load JS 102 kB. Every page route is 105–107 kB first-load. Charts are hand-written SVG (no chart library). No route is heavy.

### Slate API waterfall (server side, per request)

1. `requirePaid` in `slate/layout.tsx` → session + membership (may call Whop).
2. `requirePaid` again in `slate/page.tsx` (duplicate check).
3. `events` for the sport (window −4 h … +2 days).
4. `market_prices` for all those events: **3,862 rows for CBB, 23,322 rows for CFB**. On the prod DB the CBB query alone takes **~570 ms**; CFB is ~6× larger.
5. `picks` for those events.
6. `odds_snapshots` (up to 2,000 rows, `prices` jsonb included) **only to list provider names** (~120 ms).
7. Quota state: one usage query per provider.

Production TTFB for public pages: landing 0.58 s warm / 3.98 s cold start, results 0.47–0.53 s (results HTML is 173 KB).

### Odds-API calls per page load: **0**

All provider calls are made by the worker. The app never calls an odds API. The issue is the opposite one: the cache is refreshed far too rarely (B2) and is far too big (B1).

## 3. Quota and budget (verified against provider docs, 2026-11-21)

| Provider | Free tier | Props on free? | Prop cost |
|---|---|---|---|
| The Odds API | 500 credits/month | Yes, per event via `/events/{id}/odds` | `markets × regions` per event. 10 NBA games × 5 markets = 50 credits per pull. Props here would exhaust the month in ~1–2 days. **Not used for props.** |
| PropLine | 1,000 requests/day | Yes ("60+ player prop markets") | Bulk `/v1/sports/{sport}/odds?markets=…` returns **every game in the sport in one request, props included**. Free tier gives live prices (some analytical endpoints such as `/odds/history`, `/ev` and `/results` are redacted, Hobby+ only). `/players/{name}/games` box scores are free. |

Prop keys PropLine documents (and the Odds API lists the same keys): NBA/NCAAB `player_points, player_rebounds, player_assists, player_threes, player_points_rebounds_assists, player_blocks, player_steals, player_turnovers`; NFL/NCAAF `player_pass_yds, player_pass_tds, player_pass_completions, player_pass_attempts, player_pass_interceptions, player_rush_yds, player_rush_attempts, player_receptions, player_reception_yds, player_anytime_td`; NHL `player_points, player_goals, player_assists, player_shots_on_goal, player_blocked_shots, goalie_saves`; soccer `player_goals` (anytime), `player_shots_on_goal`, `player_assists`, `player_cards`; tennis: PropLine says "per-player aces and games-won props" but does not publish the key names. Missing keys come back named in the `X-PropLine-Missing-Markets` response header, so the worker requests a candidate list and stores only what is returned.

**Measured daily usage (prod):** PropLine 77–83 requests/day, Odds API 20–26 credits/day (≈ 600–780/month projected, already over 500; the pacer is what keeps it inside).

**After props, estimated:** bulk props add one PropLine request per sport per pre-game/refresh pull. At the current pull plan that's ≈ +60–120 requests/day, so ≈ 140–200/day of 1,000. Once the tick really runs every 15 min (B2), game-line pulls rise to about the README's 160/day, so the total is ≈ 220–300/day. **This stays inside the free tier, so props go ahead with no change of plan.**

## 4. Bugs found

Severity follows the ticket scale (P0 payments/auth/data loss/wrong edge math; P1 broken feature or wrong grade; P2 UX/perf; P3 polish).

| ID | Sev | Bug | Repro / evidence |
|---|---|---|---|
| B1 | **P0** | **Production DB is 710 MB, over Supabase's 500 MB free cap.** `odds_snapshots` held 3.1M rows (636 MB): every pull stores every book × every alternate line for the *whole league*, there is no retention, and PropLine pre-game/closing pulls ignore the event filter (a 27-event pre-game pull stored 172 events). One tick wrote ~280k rows. | `pg_database_size` = 710 MB; health payload shows `snapshots: 76168` for one NCAAF refresh. (About 1.2M rows were pruned during recon; disk space returns after VACUUM.) |
| B2 | **P0** | **The worker runs every 4–6 h, not every 15 min.** GitHub drops most `*/15` scheduled runs (21 scheduled runs in 3 days). Pre-game (60–90 min) and closing windows are mostly missed, so **41 of 44 graded picks have no CLV**. | `actions/runs` timestamps; `select avg(clv)` is null for most groups. |
| B3 | P1 | Tick takes 3–12 min. `latestPull()` loads *every* snapshot ever stored for an event (no limit) and filters in JS; called for every touched event. | `packages/db/src/repo.ts:167`; job_runs durations. |
| B4 | P1 | Slate shows games that have already started as LIVE with their pre-game edge, EV and grade, which are no longer valid prices. | `/slate?sport=nba` (demo): "LIVE · Atlanta Hawks +3.5 · +3.8% · B". |
| B5 | P1 | Write-up risk lines use football wording in every sport: "a late field goal" on NBA spreads, "before kick-off" on NBA/CBB moneylines. No sport-specific factors (NHL goalie, tennis surface, soccer draw risk…). | `/game/nba-…` and `/game/cbb-…` write-ups. `core/writeup.ts#riskSentence`. |
| B6 | P1 | Props: only NBA/NFL, both flags off; a prop with no player model returns `NaN` in `priceSelection` and is dropped, so a consensus-only prop can never appear. There is no Props tab or empty state. | `core/pricing.ts` `if (!Number.isFinite(model.win)) return;` |
| B7 | P1 | Price timestamps are fetch time, not the book's `last_update`: `saveSim` writes `snapshot_ts = pulledAt`. No row shows how old its price is; the only staleness rule is a slate banner at 6 h. Stale prices still produce edges and grades. | `worker/src/simulate.ts#saveSim`; `lib/data.ts#isPriceStale`. |
| B8 | P1 | Grades vs FAQ can drift. The FAQ is a hard-coded string on the landing page; thresholds live in `DEFAULT_THRESHOLDS` *and* an admin-editable `settings.thresholds` row. The FAQ says "B: 2–5% EV", but the code also grades **EV ≥ 5% without model/consensus agreement as B**, and the FAQ doesn't mention the book-count and credibility caps. | `app/page.tsx` FAQ; `core/ev.ts#gradePick`; `/admin` threshold form. |
| B9 | P1 | No free trial: Whop `trialing` / `past_due` aren't modelled (`members.status` is active/canceled/expired/none), the CTA reads "Join as a Founding Member", and no trial or after-trial price is shown. | `lib/whop.ts#statusFor`, `app/page.tsx`. |
| B10 | P2 | Membership is checked twice per slate load (layout and page), and each check can call Whop when the cache is cold. | `app/slate/layout.tsx`, `app/slate/page.tsx`. |
| B11 | P2 | On a 390 px phone the slate's "best line" truncates the price and the book (`Atlanta Hawks +3.5…`), which are the two things a bettor needs. | Screenshot `shots/_slate_sport_nba.png`. |
| B12 | P2 | Slate reads all `market_prices` rows for the sport (3.9k CBB, 23k CFB) plus 2,000 `odds_snapshots` rows just for provider names: ~0.7 s+ of DB time per page, worse for CFB. | EXPLAIN ANALYZE on prod. |
| B13 | P2 | Google Fonts CSS is render-blocking (~1.6 s estimated). | Lighthouse `render-blocking-resources`. |
| B14 | P2 | Slate `<Link>`s prefetch every game page in view (dozens of RSC requests on mobile data). | Lighthouse network log: `/game/…?_rsc=` × N. |
| B15 | P2 | `/api/health` is public and returns the last job's full detail (pull plan, providers, counts). | `curl https://sigmaline.netlify.app/api/health`. |
| B16 | P1 | No Edge Finder. The slate shows only one edge per game with an "Edges only" toggle; you can't filter by market type, book, minimum edge or grade, and props aren't listed anywhere. | `/slate`. |
| B17 | P1 | No "junk row" accounting. Rows with no price, rows on started events, and implausible EVs are silently graded `none` with no count or anomaly log, so data loss is invisible. | `core/pricing.ts`. |
| B18 | P2 | Prop grading uses the UTC date of `commence_time` to find the box score; evening US games (00:00–05:00 UTC) can look up the wrong day. | `worker/src/grade.ts#gradePicks`. |
| B19 | P3 | Demo database has 0 soccer games (recorded fixtures land in the past after the time shift), so the soccer slate can't be previewed locally. | `/slate?sport=soccer` (demo). |
| B20 | P2 | `market_prices` stores every alternate line (CFB: 23k rows / 120 games), which bloats the slate and game page. | prod counts. |

No console errors on any screen (iPhone 13 profile). Accessibility: 100 on every audited page; no horizontal scroll at 390 px.
