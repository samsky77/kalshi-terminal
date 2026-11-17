# Data licensing notes

Each provider sits behind an adapter in `worker/src/providers/`. Each adapter file starts with a header that matches its entry here. **This is a working summary, not legal advice.** Re-read each provider's current terms before launch and whenever you change plan. Record any written confirmation you get in this file, with the date.

Rules the code enforces:

- **Read-only.** The app never places, holds or brokers bets, and never connects to sportsbook accounts.
- **No scraping.** Nothing scrapes a sportsbook or Kalshi. Every price comes from a licensed API.
- **What members see.** Odds values are shown one at a time inside the product, with the book name. There are no bulk odds tables, no downloads of odds feeds and no API for members.
- **CSV export.** The only export is the CSV of *our own* pick log on the Results page: our picks, the price we logged and our results. It contains no provider feed.
- **Stats.** Raw stats tables are never shown. Stats are used only as model inputs.

## SharpAPI (sharpapi.io): primary game-line feed, OFF by default

- **Use:** game lines (moneyline, spreads, totals) across books.
- **Status:** `SHARPAPI_ENABLED=false` by default. Keep it off until SharpAPI confirms **in writing** that the free plan allows showing its odds to paying end users.
- **Attribution:** from **1 December 2026**, any screen that shows SharpAPI odds must display "Data provided by SharpAPI". The UI shows this footer whenever a displayed price came from SharpAPI (`provider = 'sharpapi'`).
- **Technical:** `https://api.sharpapi.io/api/v1`, `X-API-Key` header. The response field mapping in the adapter is a best guess (their docs host was unreachable from the build environment), so verify it against a live response before enabling.
- Written confirmation: _none yet_ (date / who / link).

## The Odds API (the-odds-api.com): fallback game lines, plus scores and results

- **Use:** fallback odds for game lines; scores and results for grading.
- **License:** commercial display is allowed **as long as their data isn't the main thing being sold**. Sigmaline sells model output: simulations, fair prices and grades. Odds are shown only as the context for a pick.
- **Quota:** 500 credits a month on the free plan. One odds call costs markets × regions credits (we use 3 markets × 1 region = 3). A scores call with `daysFrom` costs 2. History costs 10×. The budgeter tracks this through `x-requests-used` and `x-requests-remaining`.

## PropLine (prop-line.com): player props, plus game lines and scores

- **Use:** player props (NBA, NFL, behind feature flags). Also game lines and scores on its free 1,000 requests a day.
- **License:** **individual odds values may be shown inside the product. No bulk exports.**
- **Free plan:** licensed sportsbook prices are not included, so we show only what the free plan returns. The pick filters still need 3 books for game lines and 2 for props. Free-plan responses that don't meet that never become picks.
- **DFS boards:** PrizePicks, Underdog and Pick6 pay out differently from real odds (PrizePicks and Pick6 use a synthetic +100/+100), so they are excluded from consensus and from best price.
- **Technical:** `https://api.prop-line.com/v1`, `X-API-Key` header. Responses use The Odds API's shape. American prices are converted to decimal.

## Free stats sources (model inputs only)

| Source | Used for | Terms | Decision |
|---|---|---|---|
| **Scores from The Odds API and PropLine** (above) | Final scores, which feed every team-ratings model | Covered by those providers' licenses | **Used.** Ratings are rebuilt from our own stored results. |
| **nflverse-data `schedules/games.csv`** (github.com/nflverse/nflverse-data, release `schedules`) | NFL results since 1999, with closing spread, total and moneyline: ratings warm-up and the NFL price backtest | **CC BY 4.0**: commercial use allowed with attribution. Credit "NFL schedule data: nflverse (CC BY 4.0)" on the Results page backtest section and in the README. The older `nflverse/nfldata` repo has **no licence file**, so it is **not** used. | **Used** as a model input and for the backtest. Never redisplayed. |
| **openfootball `football.json`** (github.com/openfootball/football.json) | Soccer results history (EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS, UCL) | Public domain (CC0 1.0); verified in its LICENSE.md | **Used.** Model input and accuracy backtest. |
| **ESPN's unofficial API** | Scores, schedules | ESPN's terms of use limit content to personal, non-commercial use | **Not used.** Banned for a paid product. |
| **NBA.com / stats.nba.com, NHL API (api-web.nhle.com)** | Box scores, schedules | League terms restrict commercial use | **Not used.** |
| **Jeff Sackmann tennis_atp / tennis_wta** | Tennis match history | CC BY-NC-SA 4.0 (non-commercial) | **Not used.** NC licence. Tennis serve and return rates are solved from the market until we have stored enough results of our own (see model notes). |
| **Tennis Abstract, Basketball-Reference, Sports-Reference** | Stats | Terms forbid commercial reuse and scraping | **Not used.** |
| **collegefootballdata.com** | CFB stats | Free API with a key; terms allow use with attribution, but they ask commercial users to contact them | **Not used at launch.** Revisit with written permission. |

## Never used in the paid product

Their terms forbid it:

- **Kalshi**, including Kalshi prices through PropLine (`bookmakers=kalshi`). The adapters filter that book out.
- **TheRundown** (free tier).
- **SportsGameOdds** data.
