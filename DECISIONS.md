# Decisions

Open choices made during the build, each with a one-line reason. **★ = review these first.**

## Model and pricing

1. ★ **Football key-number snap** (NFL s3=0.80/s7=0.35, NCAAF 0.50/0.15). Without it, solving σ from moneyline versus spread gave NFL σ≈9–10, and far alternate spreads showed 5–7¢ false edges.
2. ★ **σ is held at the sport constant when |spread| < 3 or the solve hits its bounds**, with μ splitting the error 1:2 between moneyline and spread. A small spread makes σ unidentifiable (0/0), and one CFB game had solved to σ=28.
3. ★ **NHL late goalie-pull step** (empty-netter 0.22 on a 1-goal lead, equalizer 0.08, 0.12 on a 2-goal lead). Pure Poisson missed the ±1.5 puck line on 15 of 16 games; with it all 16 fit.
4. ★ **Tennis dominance spread σ_D**, solved from the total when the i.i.d. model can't reach it. WTA totals like 21.5 at 50% sat below the i.i.d. model's minimum.
5. ★ **Tennis game spread is an output, not a target.** Fitting it with σ_D diverged (not monotone); misses are tiered C instead.
6. ★ **The fit downgrade marks a market kind tier C when the sim misses its anchor** (ML >1 pt, spread or total >2 pts). Otherwise a model that can't fit a line would still show tier A edges.
7. ★ **Total SD and NHL/NFL OT constants are documented estimates (MODEL.md, REVIEW).** No dataset was available at build time; the on-device dataset is meant for refitting them.
8. Correlated-normal ρ = 0 for all four sports, by symmetry of the signed margin.
9. Calibration uses common random numbers and is two-stage (3,000 draws, then all 20,000), about 100 ms per game instead of about 550 ms.
10. Soccer is a bivariate Poisson (λ1, λ2, λ3) rather than two independent rates. The spec's "two Poisson rates" can't hit home, draw and away plus the total at once; λ3 adds draws without moving the margin.
11. Vig removal is proportional (multiplicative), with the median taken across books per outcome. It is simple, standard, and works for 3-way markets.
12. The main line is the modal line across books; consensus probability is the median among books at that line. Books at other lines would bias the probability.
13. Edge uses the **1-contract** taker fee. Round-up makes this the most conservative per-contract cost.
14. Stale odds (>6 h) are **marked, not suppressed**; only started games are suppressed. The spec asks only for a mark, and the user can judge.
15. Totals aren't priced when books list no total (except tennis, which uses a tour-average serve rate). With no anchor the number would be a guess.
16. The NFL `KXNFLTIE` market is priced as tier C. It is cheap to include and the model has an explicit tie rate.
17. Tennis set spreads (`KXATPSSPREAD`) are excluded from v1. The spec lists moneyline, game spreads and game totals.

## Data and matching

18. ★ **Series discovery = seed map of league prefixes plus an exact type-suffix allowlist** (GAME/MATCH/SPREAD/GSPREAD/TOTAL/GTOTAL/TIE). This excludes halves, props, futures and parlays by construction, with no keyword search.
19. Games are grouped by milestone `primary_event_tickers` first, then by league and ticker stem. TIE and tennis spread/total events aren't milestone primaries.
20. Start time comes from the milestone `start_date`. `occurrence_datetime` is the expected *end*.
21. ★ **Name matching is token-prefix and order-free, with guards**: a strong token (4+ letters) is required, single-letter suffixes must match, and differentiators (St, State, Tech, City, United…) can't be missing. Kalshi uses short and odd names ("Strasbourg Alsace", "New York R", "M´gladbach"); tested on 350 real pairs with no false matches.
22. Alias tables are additive. A wrong alias can't block the generic matcher (that bug broke "UMass").
23. Soccer leagues in the seed map are those The Odds API covers (14 leagues). Other Kalshi leagues have no sportsbook anchor.
24. Tennis odds keys are chosen by tournament-name token overlap against the free `/v4/sports` list. "ATP Stockholm" had no active key and is logged as unmapped.

## API usage and infrastructure

25. ★ **The odds credit check uses the free `/v4/sports` call** (cost 0, returns `x-requests-remaining`) before any paid refresh, so the 30-credit reserve is enforced on fresh numbers.
26. ★ **Build-time credit spend: 54 credits** for one refresh per sport (recorded as fixtures and used for check 3), plus 3 for the in-app NFL check. 443 credits remained at handoff.
27. The Kalshi series catalogue is cached 6 h, not 30 s. It is 6.8 MB and changes rarely; every other Kalshi response is cached 30 s.
28. The Kalshi throttle is 5 requests/s per server instance. On Vercel each instance has its own throttle and cache (no shared store on the free tier).
29. Simulation runs in a **Web Worker on the phone**, not on the server. That keeps Vercel free-tier function time small, and it works offline. Sims are cached by game + consensus, so Kalshi price updates only re-price.
30. Kalshi prices reload every 90 s while the app is open and visible. **Odds now refresh automatically at most once per sport per ~10 h**, only for sports with games starting within 24 h, and still behind the 30-credit reserve. The refresh runs when the app is opened (or open at the next poll), so the phone must be opened at least once a day; there is no server cron or shared store on the free tier.
31. The on-device dataset gets one record per odds refresh, plus Kalshi-price snapshots at most every 15 min per sport. That keeps IndexedDB small while giving a price history.
32. The service worker is hand-written (no next-pwa). It's small and compatible with Next 15; Lighthouse 11 reports the app installable.
33. Lighthouse **11.7.1** was used for the PWA audit. Lighthouse 12 removed the PWA category.
34. The fixture odds are **real recorded responses** (2026-11-14 ~03:08Z), not synthetic. The matcher and calibration tests then exercise real naming and real line shapes.
35. Demo mode replays the fixtures with "now" set to the recording time, so the Value tab can be checked without spending credits.
36. Node.js 24 LTS was installed with winget (user scope); the machine had no Node.

38. **Free odds source: ESPN's public scoreboard** (no key, no credits) for NBA, NFL, NHL, CFB, CBB and soccer (3-way, with ESPN's draw price), plus tennis singles when ESPN lists lines for them. One book (DraftKings), pregame lines only, mapped into the Odds API shape. FCS, any ESPN failure, and tennis tournaments where ESPN lists no lines still use The Odds API, so credits are spent only there. The sim then anchors to one book instead of a multi-book median, and ESPN's endpoint is unofficial and can change without notice.

## Things I could not verify

37. ★ **Kalshi's fee schedule PDF** was behind a bot checkpoint. The fee test table was computed from the published formula; spot-check a few rows against the PDF.
