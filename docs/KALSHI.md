# Kalshi public API: verified findings

Verified against the live API on 2026-11-13/14 (UTC) from this machine, without an API key.
Base URL: `https://api.elections.kalshi.com/trade-api/v2`

References:
- API reference: https://docs.kalshi.com/api-reference
- Rate limits: https://docs.kalshi.com/getting_started/rate_limits
- Fee rounding: https://docs.kalshi.com/getting_started/fee_rounding
- Fees overview: https://help.kalshi.com/trading/fees
- Fee schedule (PDF): https://kalshi.com/docs/kalshi-fee-schedule.pdf. **Not readable at build time**: it returned HTTP 429 and then a Vercel bot checkpoint. See "Fees" below.

## Endpoints that work without auth

| Endpoint | Result | Used by the app |
|---|---|---|
| `GET /series?category=Sports` | 200, 4,299 series, about 6.8 MB | Series discovery (cached 6 h) |
| `GET /series/{ticker}` | 200 | no |
| `GET /events?series_ticker=…&status=open&with_nested_markets=true&with_milestones=true&limit=200[&cursor=]` | 200, events, nested markets and a `milestones` array | Main data load |
| `GET /events/{event_ticker}?with_nested_markets=true` | 200 | Probing only |
| `GET /markets/{ticker}/orderbook?depth=N` | **200 unauthenticated.** Returns `orderbook_fp.yes_dollars` and `no_dollars` as bid ladders `[price, size]`. A Yes ask is `1 − best No bid`. | Not used in v1 (depth is out of scope) |
| `GET /milestones?category=Sports&minimum_start_date=…` / `?related_event_ticker=…` | 200, sorted by `start_date` | Via `with_milestones` |
| `GET /series/fee_changes` | 200, `{"series_fee_change_arr": []}` at check time | Documented for later |
| `GET /exchange/status` | 200 | no |

Account endpoints return 401 without a signed key. This app contains no authenticated, account or trading code (`tests/readonly.test.ts` enforces this).

The `/markets` keyword search is never used, because it returns multi-leg "combo" markets. Exchange index 1 is named "Combos" in `/exchange/status`, and the app rejects any event or market on it.

## Rate limits

- The docs give the **Basic tier** 200 read tokens per second at 10 tokens per request, which is 20 requests/s with bursts of 60. Unauthenticated requests are "subject to separate limits", with no numbers published.
- No rate-limit headers were observed. Responses are served through CloudFront with `Cache-Control: public, max-age=15`.
- The app throttles to **5 requests/s** per server instance, backs off on 429 (it honors `Retry-After`, otherwise waits 1/2/4/8 s), and caches every response for **30 s**. A full load of all seven sports is about 60 requests, roughly 24 s at 5/s.

## Series used (discovered, not hardcoded)

Discovery reads `/series?category=Sports` and keeps a series only if its ticker is exactly `<league prefix><type>`. The league prefixes come from the seed map in `src/core/sports.ts`, and the type is one of `GAME|MATCH` (winner), `SPREAD|GSPREAD`, `TOTAL|GTOTAL`, or `TIE` (NFL only). The longest prefix wins, so `KXLALIGA2GAME` is La Liga 2. Observed at build time:

| Sport | Winner | Spread | Total | Other |
|---|---|---|---|---|
| NBA | KXNBAGAME | KXNBASPREAD | KXNBATOTAL | |
| NFL | KXNFLGAME | KXNFLSPREAD | KXNFLTOTAL | KXNFLTIE (one market, `-Y`) |
| NHL | KXNHLGAME | KXNHLSPREAD (puck line) | KXNHLTOTAL | |
| College football | KXNCAAFGAME, KXNCAAFCSGAME | KXNCAAFSPREAD | KXNCAAFTOTAL | |
| College basketball (men) | KXNCAAMBGAME | KXNCAAMBSPREAD | KXNCAAMBTOTAL | (KXNCAABGAME exists but had 0 open events) |
| Tennis | KXATPMATCH, KXWTAMATCH (KXATPGAME/KXWTAGAME exist, 0 open) | KXATPGSPREAD (games) | KXATPGTOTAL, KXWTAGTOTAL (games) | KXATPSSPREAD (sets) is excluded in v1 |
| Soccer | KX{EPL,LALIGA,LALIGA2,BUNDESLIGA,BUNDESLIGA2,SERIEA,SERIEB,LIGUE1,MLS,UCL,UEL,EREDIVISIE,LIGAPORTUGAL,LIGAMX}GAME | …SPREAD | …TOTAL | the tie is the `-TIE` market inside the GAME event |

These are all excluded by construction: first half, quarters, periods, team totals, series winners, props, futures, weekly multi-game markets (`KXNFLWEEKTIE`) and `KXMVE…` combos.

## Market conventions

| Kind | `strike_type` | Strike | Yes means | Ticker suffix |
|---|---|---|---|---|
| Winner | `structured` | none | that team or player wins (soccer: in regulation) | team code, e.g. `-NYK`; soccer draw is `-TIE` |
| NFL tie | `structured` | none | the game ends tied | `-Y` |
| Spread | `greater` | `floor_strike` = X.5 | "Indiana wins by over 18.5 points" (margin > X.5) | team code + ceil(strike), e.g. `-IND19` |
| Tennis game spread | `greater` | `floor_strike` = 6.5 | "Taylor Fritz -6.5 games" (game margin > 6.5) | `-FRI7` |
| Total | `greater` | `floor_strike` = X.5 | "Over 211.5 points/goals/games" | ceil(strike), e.g. `-212` |

- Every spread and total strike seen was a half-integer with `greater` (strictly greater). The code also supports `greater_or_equal`, `less`, `less_or_equal` and `between` in case they appear.
- Prices are dollar strings: `yes_ask_dollars`, `no_ask_dollars`, `yes_bid_dollars`, `no_bid_dollars`. Sizes are `yes_ask_size_fp` and `yes_bid_size_fp`. **There is no `no_ask_size` field.** A No ask is a resting Yes bid, so No ask size = `yes_bid_size_fp`. An ask of `1.0000` with size 0 means nobody is offering, and is treated as no ask.
- `occurrence_datetime` is about the **expected end** of the game, not the start: NFL 1 pm ET kickoff showed 17:30Z, NBA 7:30 pm showed 03:00Z. The real start comes from the event's milestone (`start_date`, e.g. "NE Patriots at DET Lions", 2026-11-15T14:30Z). Without a milestone, the app uses occurrence minus a typical game length.
- Grouping: a milestone's `primary_event_tickers` lists the GAME, SPREAD, TOTAL and TEAMTOTAL events of one game. The NFL TIE event and the tennis GTOTAL/GSPREAD events are **not** primaries, so the app attaches them to the game with the same league and ticker stem (`26NOV15NEDET`). A stem's date can differ from the real start: `KXNCAAMBGAME-26NOV14MORGLMD` has a milestone start of 2026-11-13 22:00Z.
- Tennis milestones carry `best_of` (3 or 5) and the tournament name. Competition names seen include "ATP World Tour Finals Men Singles", "WTA Finals Women Singles" and "ATP Stockholm".

## Fees

- Every sports series carries `fee_type` and `fee_multiplier`. Across the 4,299 sports series: `quadratic` 4,192, `quadratic_with_maker_fees` 107; multiplier 1 for 4,280 and 0.5 for 19.
- Taker fee per order is `roundup(0.07 × fee_multiplier × C × P × (1 − P))` to the next cent, where C is contracts and P is price in dollars. This is the general-market formula from the fee schedule. Since 2025 the API applies the trade fee at 6-decimal precision and rounds the balance through a separate "rounding fee". For a non-direct member the result is the same whole-cent total per fill (fee_rounding page).
- `quadratic_with_maker_fees` adds a maker fee on resting orders. The app prices *taking* the ask, so only the taker formula applies.
- Edge uses the fee of a **1-contract** order, which is the most conservative per-contract cost because rounding up hurts small orders most. At 50¢ that is 2¢ per contract, versus 1.75¢ per contract on 100 contracts.
- The test table in `tests/fees.test.ts` was computed from the formula because the PDF table couldn't be opened. **Spot-check it against the PDF.**
