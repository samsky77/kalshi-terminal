# Decisions

Choices made without stopping to ask (spec §16). Each one picks the simpler option that keeps the track record honest and the data use within each licence. **★ = review first.**

## Repository and stack

1. ★ **Sigmaline lives in `sigmaline/`.** This repo already held the KX Terminal (a Kalshi app). The spec bans Kalshi data, and it also asked for an empty repo. Building in a subfolder keeps the old app intact. Vercel's Root Directory is `sigmaline/app`. GitHub Actions workflows must sit at the repo root (`.github/workflows/sigmaline-*.yml`).
2. **npm workspaces:** `packages/core` (pure math, also used in the browser), `packages/db` (data access), `worker`, `app`. `packages/db` was added so the worker and the app share one data layer.
3. **Database access goes through a tiny table API** with three backends: Supabase (production), Postgres (`DATABASE_URL`; used for CI integration tests and self-hosting) and a local JSON file (**demo only**). The worker refuses the file backend outside `npm run worker -- demo`, so demo data can never reach the live record.
4. **No chart library.** The charts are hand-written SVG, which keeps first-load JS at about 105 KB.
5. **IBM Plex is loaded from Google Fonts with a `<link>`**, not `next/font`. That way the build needs no network access.
6. **Brand colours are kept exactly as specified.** The dataviz palette checker flags amber and blue as brighter than its default band, and the "no edge" grey as low-chroma. The checks that matter here pass: colour-blind separation (ΔE ≥ 25) and 3:1 contrast. The grey is meant to read as neutral.

## Data and licensing

7. ★ **PropLine is the primary game-line feed. The Odds API only tops up thin markets.** Pre-game plus closing pulls for every game window would cost about 3,100 Odds API credits a month against a quota of 500. PropLine's free 1,000 requests a day covers it at about 160 a day. When most games in a PropLine pull have fewer than 3 books, the pull merges in The Odds API, whose 10 books (including Pinnacle) count as one region, so 3 credits per call.
8. ★ **The Odds API is paced:** each day may spend 1.5× its fair share of the credits left this month, so the 500 can't all go in week one. This sits on top of the spec's 80% and 100% rules.
9. ★ **ESPN, NBA.com, the NHL API, Sports-Reference, Tennis Abstract and Sackmann's tennis data are not used.** Their terms are non-commercial or unclear. History comes only from nflverse-data (CC BY 4.0) and openfootball (CC0). The older `nflverse/nfldata` repo has no licence file, so it isn't used.
10. **SharpAPI is off by default.** Its docs host was unreachable from the build environment, so the field mapping is defensive. Check it against a live response before setting `SHARPAPI_ENABLED=true`.
11. **DFS boards (PrizePicks, Underdog, Pick6) and Kalshi are filtered out** of consensus and best price. Their prices aren't real two-way odds, or their terms forbid use.
12. **Bettable books for best price** (US-regulated): DraftKings, FanDuel, BetMGM, Caesars, BetRivers, ESPN BET, Fanatics, Hard Rock, Bally, betPARX, Fliff. Pinnacle and offshore books count toward consensus but are never shown as "best price". Admins can change this in `settings.bettable_books`.

## Model and pricing

13. ★ **Cold start uses market-only pricing.** Until a team has enough stored results for ratings, its "model" would just be the market's own lines run through our sim. In that case the fair price **is** the no-vig consensus, so the only possible edge is line shopping (a book beating the market). Without this, small shape differences between our sim and the books produced fake 10–30% edges in testing.
14. ★ **NFL starts at the w = 0.15 floor; other sports at 0.35.** In the walk-forward backtest (2017–2025, about 2,600 games with nflverse closing lines), the results-only rating model scored Brier 0.222 against 0.210 for the closing market. Blending at 0.15 gives 0.2107. The nightly job moves w by at most ±0.05, and only when held-out log loss improves.
15. ★ **The price backtest is negative.** Betting the NFL model against closing lines returned −8% ROI on 1,019 bets. A scores-only model doesn't beat the closing market. The expected edge is **line shopping before the close**, and live CLV is the metric that will confirm or refute it. This is reported, not hidden: see the README and the Results page's backtest section.
16. **Grade A means EV ≥ 5% and both the pure model and the pure no-vig consensus say the best price is +EV.** That's our reading of "the model and consensus point the same way". Any graded edge also needs ≥ 3 books (props ≥ 2) and EV ≤ 25%. Higher EV is treated as a stale or wrong price, never published, and shown grey on the slate.
17. **Blending happens on the no-push scale.** Book prices (and so the no-vig consensus) are conditional on no push, so p_fair blends P(win | no push) and keeps the model's push probability. EV = p_win·decimal + p_push − 1.
18. **CLV = p_close × decimal_taken − 1** (push-adjusted), where p_close is the no-vig closing consensus at the pick's line. If the pick's line isn't quoted at close, CLV is left empty rather than estimated.
19. **One pick per market type per game** (best EV). Props: one per player and stat. This stops a side and all its alternate lines from being published together.
20. **Each event is published once, from its pre-game snapshot** (60–90 min out; 25–95 min if cron is late). Snapshots are labelled by each game's own time to start, so a league-wide pull for one game can't count as another game's pre-game snapshot.
21. **Basketball:** correlated bivariate normal (NBA team SD 11.4, ρ 0.30; CBB 9.9, 0.39), rounded, with simulated overtimes. Ratings are points-based (no possession data in licensed sources). Pace is implicit in the offence/defence points.
22. **Football margin:** normal pmf × key-number weights from long-run NFL frequencies (3 ≈ 15%, 7 ≈ 9%…), solved so the mean and SD are exact. CFB uses the square-root weights and has no ties. NFL 2-way moneylines push on a tie.
23. **NHL:** Poisson, plus the late empty-net step (0.22 / 0.08 / 0.12, from the earlier KX Terminal fit), 3-on-3 OT (72% decided) and a shootout (home 52%). λ is deflated 1.2% to offset the empty-net step.
24. **Soccer:** Dixon–Coles with ρ = −0.08. Club names are normalised across sources (FC/AFC/1. FC… stripped, plus a small alias table).
25. ★ **Tennis:** serve rates are solved from the market moneyline (and the total) until enough results are stored for Elo. Game handicaps and totals are priced and shown, but **not published** (`TENNIS_GAME_MARKETS_PUBLISH=false`): no licensed results source gives game counts to grade them.
26. **Key player status unknown** = a player listed questionable / day-to-day / GTD in PropLine's injury feed who also has props in that game (books post props for the players who matter). With no injury data for a sport, the filter doesn't apply, as the spec says.
27. **Rest:** calendar days since each team's previous stored game. Back-to-back = −1.4 points (NBA), −0.6 (CBB), −0.12 goals (NHL); NFL long rest +0.6.

## Track record

28. ★ **Sealed rows.** The public chain endpoint shows only seq and hashes for picks whose game hasn't started. The browser still verifies the full chain, so a pick's hash is public before kick-off and can't be swapped afterwards.
29. **The database enforces** append-only picks and results (triggers block UPDATE, DELETE and TRUNCATE), `created_at < commence_time`, a seq/prev_hash check inside `append_pick` under an advisory lock, and one pick per selection.
30. **Values are rounded before hashing** (price and fair to 4 dp, EV to 6 dp), so what is hashed is exactly what Postgres stores.
31. **Props are graded from PropLine box scores.** A player with no stat line within 24 hours of the final is voided (did not play).

## Product

32. **Admin = the signed-in Whop account whose email equals `ADMIN_EMAIL`.**
33. **Alerts fire at publish time.** Discord ignores quiet hours (shared channel); push respects them. Each (pick, destination) is claimed in `alert_log` before sending, so a retry can't double-send.
34. **Slate times are shown in US Eastern.**
35. **Demo mode** (`npm run worker -- demo`) replays recorded odds and **samples results from the model** so every screen can be previewed. It shows a full-width "DEMO DATA" banner and only exists in a local file.
