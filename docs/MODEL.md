# Fair price and simulation model

The simulation is **anchored to sportsbook prices**. Its job is to turn a handful of consensus numbers (moneyline, main spread, main total) into a full joint distribution, so that every Kalshi strike can be priced consistently. It is **not** an independent forecast: where the books are wrong, the sim is wrong too. The UI says this on the Value tab and in every game detail.

All model code lives in `src/core/` (pure TypeScript, no UI or I/O imports).

## Step 1: consensus (`src/core/odds.ts`)

1. The Odds API, region `us`, markets `h2h,spreads,totals`, decimal odds.
2. Per book, per market: remove the vig by proportional normalization, `p_i = (1/d_i) / Σ(1/d_j)`. This works for two-way and three-way (soccer 1X2) markets. Quotes at 1.00 (suspended) are dropped.
3. Moneyline: the median of each outcome across books, renormalized to sum to 1.
4. Main spread and main total: the **modal** line across books (ties go to the line nearest the median, then to a .5 line). The consensus probability is the median no-vig probability among books quoting that exact line. Asian quarter lines (±0.25, ±0.75) are ignored.

## Step 2: calibration

Every model is calibrated on the **same random draws** used for the final run (common random numbers), so the sim reproduces its anchors to within Monte Carlo resolution. For speed this happens in two stages: a coarse bisection on the first 3,000 draws, then a narrow refinement on all 20,000.

### Basketball and football: correlated normal (`models/normal.ts`)

- Latent margin `M ~ N(μ, σ)` and total `T ~ N(τ, σ_T)` with correlation ρ. The margin is rounded to a whole number. Then `home = round((T+m)/2)` and `away = home − m`.
- **μ** is set so that P(home covers the consensus spread) equals the consensus. **σ** is solved so that P(home wins) equals the no-vig moneyline. **τ** is set so that P(over the main total) equals the consensus.
- When |spread| < 3, the moneyline barely identifies σ (it is 0/0 in the normal approximation). In that case, or if the solve hits the σ bounds, σ is held at the sport constant and μ splits the residual error 1:2 between moneyline and spread.
- Overtime when regulation ends tied:
  - **NBA / NCAAB**: 5-minute periods drawn from the same model scaled by time (5/48 or 5/40), repeated until untied.
  - **NFL**: the tie stands with probability 0.12. Otherwise the OT winner adds 3 points (60%) or 6 (40%). The winner is home with probability Φ(0.5·μ/σ).
  - **NCAAF**: OT always resolves. Winner margin is 3, 6, 7 or 8 points (30/15/40/15%), and the loser scores 0, 3, 7 or 14 OT points (40/15/35/10%).
- **Football key numbers** (an addition, see DECISIONS.md): a latent margin with |M| in [1.5, 4.5) lands exactly on ±3 with probability s3, and one in [5.5, 8.5) lands on ±7 with probability s7. NFL uses s3 = 0.80, s7 = 0.35; NCAAF uses s3 = 0.50, s7 = 0.15. Without this, solving σ from moneyline versus spread gives σ ≈ 9–10 for the NFL, because books price the mass sitting on 3. The resulting tails were too thin and produced large false "edges" on far alternate spreads.

| Constant | NBA | NCAAB | NFL | NCAAF | Source / status |
|---|---|---|---|---|---|
| σ fallback (margin SD) | 12.0 | 11.0 | 13.86 | 16.0 | NFL: Stern, H. (1991), "On the probability of winning a football game", *The American Statistician* 45(3):179–183 (SD of final margin around the spread ≈ 13.86). The others are common rule-of-thumb values. **REVIEW**: usually overridden by the solve. |
| σ bounds | 7.5–15 | 7–14.5 | 10–16.5 | 12–22 | Keep the solve in a plausible range. **REVIEW** with backtests. |
| σ_T (total SD) | 18.0 | 16.0 | 13.5 | 16.0 | **Estimates. REVIEW**: replace with the SD of (final total − closing total) from the saved backtest dataset. |
| ρ (margin, total) | 0 | 0 | 0 | 0 | Symmetry: high-scoring games widen \|margin\| in both directions but do not shift the signed home margin. **REVIEW** for big favorites. |
| Key-number snap s3/s7 | – | – | 0.80/0.35 | 0.50/0.15 | Set so that P(final margin = 3) ≈ 15% and P(= 7) ≈ 9% for the NFL, roughly matching published historical key-number frequencies. College uses about half that. **REVIEW**. |
| NFL OT tie rate | – | – | 0.12 | – | Approximate share of tied-after-regulation NFL games still tied after the 10-minute OT. **REVIEW**. |

### NHL: two Poisson rates (`models/poisson.ts`)

- Regulation goals are `Poisson(λ_home)` and `Poisson(λ_away)`. The total rate and home share are solved so that sim P(home wins, incl. OT/SO) equals the no-vig moneyline and P(over main total) equals the consensus.
- **Late goalie pull** (an addition): if one team leads by 1 at the end of regulation, the leader scores an empty-netter with p = 0.22 and the trailer equalizes with p = 0.08. A 2-goal lead adds an empty-netter with p = 0.12. Without this, P(win by 2+) on the ±1.5 puck line missed the market badly: 1 of 16 games fit before, 16 of 16 after. **REVIEW** these rates.
- **Overtime**: a game tied after regulation (including after an equalizer) is decided in 3-on-3 OT with probability 0.60. In OT the home team wins with probability λ_home/(λ_home+λ_away). Otherwise it goes to a shootout, which is a coin flip. The winner is credited one goal, as books and Kalshi grade totals and puck lines. **REVIEW** the 0.60 share.

### Soccer: bivariate Poisson (`models/poisson.ts`)

- `home = X1 + X3`, `away = X2 + X3` with `Xi ~ Poisson(λi)`. Karlis, D. & Ntzoufras, I. (2003), "Analysis of sports data by using bivariate Poisson models", *JRSS D (The Statistician)* 52(3):381–393.
- λ1 + λ2 sets the draw rate, and λ1/(λ1+λ2) sets home versus away. The shared λ3 adds draws and goals without moving the margin, so it is solved last from the main total. The draw stays a third outcome and prices Kalshi's `-TIE` market directly. Regulation time only, as both Kalshi and the books grade it.
- Odds API soccer "spreads" are Asian handicaps. They are diagnostics, not calibration targets.

### Tennis: point-level model (`models/tennis.ts`)

- Each player has a serve-point win probability; points are i.i.d. given the server (Newton, P. K. & Keller, J. B. (2005), "Probability of winning at tennis I", *Studies in Applied Mathematics* 114(3):241–269). Holds use the closed form, tiebreaks alternate service correctly, and the first server of each set follows the receiver of the previous set's last game. The format comes from the event: best of 3 or 5 from the milestone, with a 10-point final-set tiebreak at Grand Slams.
- The gap pA − pB is solved from the match moneyline using an **exact DP** (fast and noise-free). The level pA + pB is solved from the consensus total-games line, otherwise it is the tour average (ATP 0.64, WTA 0.56 per player).
- Total games is U-shaped in the level, with its minimum at pA + pB = 1, so the level is searched only on the realistic branch [1.0, 1.6].
- **Dominance spread** (an addition): many WTA totals sit below anything the i.i.d. model can produce (too many simulated three-setters). In that case the level is fixed at the tour average and a match-level shift in the serve gap, `D + σ_D·z`, is solved from the total. Calibration integrates over z with 5-point Gauss–Hermite quadrature.
- The game spread is an **output**, not a target, because it is not monotone in any free parameter. When it misses the consensus by more than 2 points, game-spread contracts are tier C.
- The reported numbers come from a 20,000-run point-by-point Monte Carlo.

## Step 3: simulate (`src/core/sim.ts`)

- 20,000 runs per game (`SIM_RUNS`). The seed is an FNV-1a hash of the game id and `seedSalt`, so the same input always gives the same output (`tests/calibration.test.ts`).
- Every Kalshi strike is read off the runs with Kalshi's exact condition (`strike_type`, `floor_strike` and `cap_strike`; "greater" is strict).

## Step 4: edge and tiers (`src/core/edge.ts`)

- For Yes: `edge = p_sim − yes_ask − fee(yes_ask)`. For No: `edge = (1 − p_sim) − no_ask − fee(no_ask)`. The fee is the 1-contract taker fee for the series (docs/KALSHI.md).
- A contract is flagged as **value** when edge ≥ 2¢, there is size at the ask, and the game has not started.
- **Tier A**: the strike equals the consensus main line, or it is the moneyline (or the soccer draw), which the sim is fitted to.
- **Tier B**: within one score unit of the main line (3 points for basketball and football, 1 goal, 1 game).
- **Tier C**: far alternates and anything with no anchor, such as the NFL tie, or spreads when books list no spread. These depend on the distribution's shape.
- **Fit downgrade**: if the sim misses the consensus anchor for a market kind (moneyline by more than 1 pt, spread or total by more than 2 pts), every contract of that kind in the game is tier C. The game detail shows the fit errors.
- Games with no sportsbook match are listed as **unpriced** and never flagged. Totals are not priced when books list no total (except tennis, which has a tour-average fallback).

## Known limitations (v1)

- The tails of every model are assumptions. Tier C exists for this reason, and C is filtered out of the Value tab by default.
- Normal margins understate basketball blowout tails slightly. Football key numbers beyond 3 and 7 (10, 14, 6) aren't modelled.
- The constants marked **REVIEW** should be refit from the on-device dataset once games settle. That is the first backtest task, and it is out of scope for v1.
