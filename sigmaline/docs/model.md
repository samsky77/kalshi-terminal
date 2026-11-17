# Model notes

## Pipeline for one game (every scheduler tick)

1. **Snapshot.** Latest odds per book, market and line from PropLine (plus The Odds API when the market is thin). Each row is labelled `pregame` (60–90 min out), `closing` (about 25 min before to 10 min after the start) or `refresh`.
2. **Consensus.** Strip the vig from each book: multiplicative for 2-way markets, the power method for 3-way. Then take the weighted median across books, with Pinnacle at ×2, and renormalise.
3. **Expectation.**
   - **Ratings:** opponent-adjusted, recency-weighted team ratings from stored finals (`packages/core/src/ratings.ts`). Used when both teams have enough games.
   - **Fallback:** the market-implied expectation. The game is then priced *market-only* (see decisions #13).
   - **Adjustments:** rest and back-to-back effects are added.
4. **Simulation.** At least 10,000 seeded Monte Carlo runs of the final score:
   - basketball: bivariate normal
   - football: key-number pmf
   - NHL: Poisson with empty-net, OT and shootout steps
   - soccer: Dixon–Coles
   - tennis: point-level Markov
   - props: negative binomial, scaled per run by the team's simulated score
5. **Pricing.** Every selection (moneyline, spread at each quoted line, total at each line, props) is read off the same samples. That is why moneyline, spread and total are always consistent (`test/models.test.ts`). Quarter lines settle as half bets.
6. **Fair price.** `p_fair = w·p_model + (1−w)·p_consensus` on the no-push scale; `w` is clamped to [0.15, 0.6].
7. **EV and grade.** EV is measured against the best price at a bettable book. A: EV ≥ 5% and both pure model and pure consensus are +EV. B: 2–5%. A graded edge also needs ≥ 3 books (props ≥ 2) and EV ≤ 25%.
8. **Publish.** Once per game, from the pre-game snapshot, after the filters: snapshot ≤ 90 min old, enough books, key players' status known.

## Self-improvement (nightly)

- **Live calibration** by sport and market over 30, 90 and 365 days: Brier, log loss, 10 buckets, CLV and ROI. Stored in `calibration_reports`.
- **Retuning.** `w` per sport and market moves ±0.05 when held-out log loss improves on the latest 30% of games. The recency half-life moves ±5%, keeping a change only if replayed held-out log loss improves.
- **Versioning.** Every change is a new `model_versions` row. Each pick stores the version that made it. Past picks are never re-graded.

## Backtests (labelled "Backtest (simulated)", never mixed with the live record)

- **Accuracy:** walk-forward, refitting ratings weekly from games strictly before each week. Run with `npm run worker -- backtest`.
- **Price:** NFL only (nflverse closing lines). Bets are priced at the close, so CLV isn't meaningful there.
- **Results at build time** (local run, 2026-11-17):

| Sport | Games | Model Brier | Market Brier | Price backtest |
|---|---|---|---|---|
| NFL | 2,985 (2015–2025) | 0.222 | 0.210 (close) | 1,019 bets, −8.2% ROI at w=0.15 |
| Soccer (5 leagues + UCL) | 5,090 | 0.214 (home-win) | n/a | no free historical odds |

The scores-only model does not beat the closing market on its own. The blend keeps it honest, and any live edge has to show up as positive CLV.
