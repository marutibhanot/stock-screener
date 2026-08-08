# Options Signal Model — Project Spec

Scoped to this directory. This is a separate research project living inside
the stock-screener monorepo — it does not replace or modify the root
`CLAUDE.md`, which still governs the production app in `backend/` and
`frontend/`. Claude Code reads this automatically when working inside
`options-signal-model/`.

**Revision 2** — rewritten after the Phase 0 data audit found the sourced
dataset materially different from what Revision 1 assumed. See
`docs/DATA_AUDIT.md` for the full findings; the summary is folded in below.

---

## What we're building

A calibrated, cross-sectional model that predicts **forward realized
volatility** from options-derived features (IV surface shape, term
structure, IV-RV spread, vol-of-vol, quoted liquidity).

It replaces a hand-tuned weighted-score system currently in production. The
existing rules engine stays live and untouched until the model beats it on a
held-out period.

**This is a research project first and a product feature second.** The
deliverable of Phase 1 is an honest answer to "is there signal here," not a
dashboard.

---

## Why the target changed from Revision 1

Revision 1 targeted vol-adjusted market-excess *return* (direction). Two
things moved us off that, in order of discovery:

1. **Direction is close to efficient; volatility isn't.** Forward realized
   vol is persistent, mean-reverting, and strongly autocorrelated — honest
   out-of-sample R² of 0.4–0.6 is routine. Direction on liquid names is
   brutally hard; an information coefficient of 0.03 is a good day.
2. **The data audit removed exactly the features direction was leaning on
   and left exactly the features vol needs.** See below — we lost dealer
   positioning (GEX/DEX/max pain/walls) entirely, and kept the full IV
   surface. That's not a coincidence worth ignoring.

Forward realized vol (or the IV-RV spread directly) is also the more natural
target for an options product: bull put spreads, condors, straddles,
calendars are volatility and premium structures. "IV is rich versus what we
expect to realize, sell premium" is a more actionable, more defensible
recommendation than a directional call — and it's what the existing rules
engine's strategy suggestions were implicitly betting on already.

**Primary target: forward realized volatility, 5d and 20d horizons.**
**Secondary, exploratory target: vol-adjusted market-excess return (1d/5d/20d).**
Evaluate the secondary target honestly. The likely, useful outcome is "no
edge" — that's a real result, not a failure, and it protects us from quietly
reintroducing a directional call later without evidence.

---

## Data

Source: `post-no-preference/options` on DoltHub (public, free, updated
daily since April 2021, cloned 2019-02-09 → present). Loaded into
`external_option_chain_history` and `external_volatility_history` in the
app's own Postgres (both environments) as of this revision.

- 114.4M option_chain rows, 1.89M volatility_history rows, 2019-02-09 → present
- End-of-day snapshots only — **not intraday** (see below)
- Columns: date, symbol, expiration, strike, call/put, bid, ask, implied
  vol, delta, gamma, theta, vega, rho. **No open interest. No trading
  volume.**

### Data audit findings (full detail in `docs/DATA_AUDIT.md`)

1. **Snapshot timestamps — EOD only.** `date` is a plain `DATE` column, one
   row per (date, symbol, expiration, strike, side). No intraday
   granularity exists in this source. Revision 1's "entry at t + 5min"
   design doesn't apply — see Point-in-time discipline below for the
   rewrite.

2. **Greeks/IV methodology — UNRESOLVED.** No vendor documentation found for
   pricing model, mid-vs-last basis, or rate/dividend assumptions, and no
   way to verify from the data alone. This is now a bigger deal than it
   would have been in Revision 1: greeks and IV are essentially the entire
   feature set, and the target itself (forward vol vs. IV) is derived from
   the same surface. **Must resolve before feature code, per the
   non-negotiable rule below.** Two paths, in order of preference:
   - Get the methodology doc from the maintainer.
   - Recompute IV and greeks ourselves from bid/ask mid, our own
     Black-Scholes, our own rate/dividend inputs. More work, but makes the
     pipeline fully reproducible and closes this flag permanently.
   Partial self-check either way: reprice a handful of liquid names and
   compare to the vendor's IV. Consistent divergence tells you their
   assumptions; divergence that changes over the history tells you their
   methodology changed mid-dataset (a regime-shift artifact waiting to
   contaminate a live model).

3. **Survivorship — clean.** Spot-checked TWTR (delisted 2022-10-27 after
   the Musk acquisition): last row in the dataset is 2022-10-26, one day
   prior. The dataset stops tracking a name when it stops trading rather
   than backfilling only currently-optionable names or leaving stale data
   after delisting. No evidence of survivorship bias.

4. **Corporate actions — clean.** Spot-checked AAPL's 2020-08-31 4:1 split:
   strike range goes from $115–650 (2020-08-28) to $28.75–167.50
   (2020-08-31) — a clean 4x contraction, correctly adjusted, no
   discontinuity.

5. **Open interest / volume — absent, confirmed structural, not an
   oversight.** GEX, DEX, max pain, put wall, and call wall are all defined
   as `greek × open_interest` summed across the chain. Without OI these
   aren't a weaker version of those metrics — they're a different number
   that mostly reflects how many strikes happen to be listed. **Dealer
   positioning is removed from Phase 1 feature scope entirely**, not
   downgraded.
   - Checked whether production's live dashboard has a different OI
     source it could donate: it does — `options_metrics.py` computes
     GEX/max pain/walls from a **live yfinance chain fetch at scan time**,
     which includes real OI for the *current* day only. This confirms
     there's no live-product bug and no hidden OI source we're missing —
     yfinance itself has never exposed historical OI, so it isn't
     reconstructable from anywhere we have access to. This is a permanent
     data gap for the historical model, not a sourcing gap to keep
     chasing.
   - Partial rescue: bid/ask is in the schema, so the **liquidity** family
     isn't dead, just narrower than "flow." Quoted spread, spread-to-mid,
     and count of two-sided quoted strikes are real, computable liquidity
     features. Not flow — nobody's trading activity, just how tight the
     market is — but not nothing.

6. **Gaps — resolved: confirmed permanent, source-level.** 2019 is
   effectively empty; 2020 through 2024-09-11 is **Mon/Wed/Fri only** (Tue/Thu
   ~100% missing every year); daily from 2024-09-12 onward (98-99.6%
   complete). Verified against the live DoltHub source directly, not just
   our local clone: `option_chain` for AAPL on 2022-01-03 (Mon) returns 150
   rows, 2022-01-04 (Tue) returns 0 -- the vendor never published that
   session, there's nothing to backfill. Full detail in `docs/DATA_AUDIT.md`
   section 6. **Implication:** any rolling-window feature/CV logic must be
   session-count-based, not calendar-day-based, or restrict training to
   2024-09-12 onward where daily spacing actually holds.

**Do not proceed past the audit if any of these are unresolved.** Item 2
(greeks provenance) is still open. Flag and stop rather than build around it.

---

## Non-negotiable methodology rules

These exist because violating them produces backtests that look excellent
and lose money. Do not relax them for convenience, and flag it explicitly if
any piece of code you write comes close to breaking one.

### Labels
- Primary: forward realized volatility, 5d and 20d horizons, computed from
  the underlying's own daily closes (not from this options dataset).
  Consider expressing as the IV-RV spread directly (`realized_vol(t+1..t+N)
  - implied_vol(t)`) as an equivalent, more directly tradeable framing.
- Secondary/exploratory only: vol-adjusted, market-excess forward return
  (residualize against SPY or equal-weight universe return, normalize by
  trailing realized vol), 1d/5d/20d. Report honestly; a null result here is
  expected and useful, not a bug to explain away.
- Treat every horizon as a separate model.

### Cross-validation
- **Purged, embargoed, walk-forward. Never random split.**
- **Group folds by date.** A given date appears in train or test, never
  both. Every ticker on 2023-03-14 goes to the same fold.
- Embargo ≥ label horizon on both sides of every test fold.
- Use `sklearn.model_selection.BaseCrossValidator` subclass; write it
  ourselves, don't trust a library default.
- Effective sample size is bound by dates, not rows: roughly 1,700+ trading
  days across the dataset's span, cross-sectioned against 100+ names. The
  *binding* constraint for significance testing is ~1,700 independent
  dates, not the row count. This is workable for 5d/20d horizons; keep it
  in mind when a result looks too strong for the sample it's really drawn
  from.

### Holdout
- 2025-01-01 → present is **sealed**. No training, no tuning, no peeking.
- It gets evaluated exactly once, at the end of Phase 1.
- Enforce this in code: the data loader raises if holdout dates are
  requested outside an explicit `--final-evaluation` flag.

### Point-in-time discipline (rewritten for EOD data)
- This dataset is end-of-day only — there is no intraday timestamp to be
  point-in-time *within* a day. Discipline instead centers on which day's
  bar is legitimately known when:
- Features are computed from data stamped at the **close of day t**.
- Entry is priced at the **open of day t+1** — never the close of day t
  (that's the same bar the features were computed from, and forward-filling
  or using a same-bar entry is a leak even though it "feels" like using
  known data).
- Labels (forward realized vol / forward return) are computed from
  **t+1 onward**, consistent with the entry point.
- No forward-fill across the feature cutoff. No use of settlement-derived
  values stamped at a close that overlaps the label window.
- This makes leakage tests *more* important, not less: with only one bar a
  day, it's easy to accidentally let the close that generates day-t's
  features also leak into the day-t label via a shared field or an
  off-by-one join. Every feature function must be unit-tested for leakage
  with a synthetic series where future values are set to NaN.

### Evaluation
- Always report against the **base rate**, never accuracy alone.
- Primary metrics: for the vol targets, R² and RMSE against realized vol,
  plus the reliability of the IV-RV spread sign. For the secondary return
  target (if pursued at all), AUC, Brier score, reliability diagram,
  information coefficient (Spearman rank correlation of prediction vs.
  realized excess return).
- Report the effective sample size (number of independent dates, ~1,700
  binding), not row count.
- Log every model variant tried to `experiments/registry.jsonl`. We need
  the count for multiple-testing adjustment.

---

## Model

**Phase 1 uses LightGBM. Not neural networks, not embeddings.**

Reasons: better calibrated on tabular data, SHAP attribution comes free and
feeds both the UI's score breakdown and the explanation layer, trains in
minutes so we can iterate on validation design rather than infrastructure.

Baselines to beat, in order:
1. Base rate / naive persistence (`forward realized vol ≈ trailing realized
   vol` — the classic volatility-forecasting null model)
2. **`implied_vol(t)` used directly as the forecast.** This is the bar that
   actually matters: IV *is* the market's own forecast of realized vol. If
   the model can't beat using IV directly, there's no edge, full stop —
   don't skip straight to comparing against the existing rules engine
   without clearing this first.
3. The existing weighted-score rules engine
4. A logistic/linear regression on 5 hand-picked features

If LightGBM doesn't clear all four on the walk-forward CV, the answer is "no
signal at this horizon." That is a valid and useful outcome.

---

## Phase 1 scope — build only this

1. Finish the data audit (`docs/DATA_AUDIT.md`) — greeks provenance is
   still open, resolve first. Gaps are resolved (see above).
2. Point-in-time feature pipeline → parquet, partitioned by date. Feature
   families, scoped to what this data actually supports:
   - IV surface: level, skew (25∆ put − call), term structure, curvature
   - IV-RV spread (the VRP signal itself, also a candidate label)
   - Vol-of-vol, surface dynamics (day-over-day surface shape change)
   - Liquidity: quoted spread, spread-to-mid, count of two-sided quoted
     strikes
   - Explicitly out: anything OI-weighted (GEX, DEX, max pain, walls,
     dealer positioning) — not computable from this dataset, don't
     approximate it with unweighted greeks and call it the same thing
3. Label construction: forward realized vol (primary, 5d/20d) and
   vol-adjusted market-excess return (secondary/exploratory, 1d/5d/20d)
4. Purged/embargoed/date-grouped CV splitter, with tests
5. LightGBM baseline + the four benchmark comparisons (naive persistence,
   IV-as-forecast, rules engine, simple regression)
6. Calibration (isotonic) + reliability diagram
7. SHAP attribution export

**Out of scope for Phase 1:** the LLM explanation layer, embedding/
similarity search, strategy recommendations, backtested P&L, any UI work,
and anything relying on open interest. Do not start these.

---

## Repo conventions

```
options-signal-model/
  data/          # raw + processed parquet (gitignored)
  src/
    audit/       # data quality checks
    features/    # one module per feature family, all leakage-tested
                 # (iv_surface.py, term_structure.py, iv_rv_spread.py,
                 #  liquidity.py — no dealer_positioning.py / gex.py)
    labels/      # label construction (vol targets primary, return secondary)
    cv/          # custom splitters
    models/      # training + calibration
    eval/        # metrics, plots, reports
  tests/         # pytest; leakage tests are mandatory for every feature
  experiments/   # registry.jsonl + per-run artifacts
  docs/          # DATA_AUDIT.md lives here
```

- Python 3.11+, polars for the heavy data work (parquet + lazy eval),
  pandas only where a library demands it.
- Every feature module exposes `compute(df, as_of: datetime) -> pl.DataFrame`
  and has a corresponding leakage test.
- Config in YAML, no magic numbers in code.
- Deterministic seeds, logged per run.
- Data lives in the app's own Postgres (`external_option_chain_history`,
  `external_volatility_history`) on both deployment hosts, not just as raw
  Dolt/parquet files — query from there rather than re-deriving a separate
  copy.

---

## How to work with me on this

- Propose the plan before writing code for any multi-file change.
- Prefer small, testable commits over large drops.
- If a result looks unusually good, treat it as a bug until proven
  otherwise. Sharpe > 2 (or R² that looks too clean) on a first pass means
  leakage, not alpha. Go find it.
- Tell me when a methodology rule above is making something hard rather
  than quietly working around it.
- The audit's job is to stop and flag, not to route around problems
  quietly. It did that correctly once already (EOD-vs-intraday, the OI
  gap) — keep that instinct on everything that follows.
