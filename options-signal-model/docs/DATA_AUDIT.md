# Data Audit — post-no-preference/options (DoltHub)

Status: **3 of 5 required checks resolved. 2 open — greeks provenance and
gap analysis. Do not write feature code until both are closed**, per
`CLAUDE.md`'s non-negotiable rule.

Source: `post-no-preference/options` on DoltHub, public, free, updated daily
since April 2021. Cloned in full (2019-02-09 → present) to both deployment
hosts and bulk-loaded into `external_option_chain_history` /
`external_volatility_history` in the app's own Postgres.

## 1. Snapshot timestamps — RESOLVED: EOD only, not intraday

`DESCRIBE option_chain` shows `date` as a plain `DATE` column (not
`DATETIME`/`TIMESTAMP`). Confirmed by querying distinct `date` values for a
single ticker: one value per trading day, no intraday granularity.

**Implication:** there is no sub-daily observation-to-availability lag to
model. Point-in-time discipline is rewritten in `CLAUDE.md` around
close-of-day-t features → open-of-day-(t+1) entry, instead of an intraday
execution-lag offset.

## 2. Greeks / IV methodology — OPEN, UNRESOLVED

No vendor documentation found for:
- Which pricing model (Black-Scholes? Binomial? Something else?)
- Mid-price or last-trade basis for the underlying IV solve
- Risk-free rate source/assumption
- Dividend yield assumption
- Whether any of the above changed at any point across 2019–2026

Not verifiable from the data alone. Given greeks and IV are now essentially
the entire feature set (see #5 below), and the primary label itself
(forward vol vs. implied vol) is derived from this same surface, this is a
higher-stakes unknown than it would be for a supplementary feature family.

**Resolution paths, in order of preference:**
1. Contact the maintainer (DoltHub repo `post-no-preference/options`,
   published via a blog series at dolthub.com/blog — a "Dolt +
   post-no-preference" post exists) and ask directly.
2. Recompute IV and greeks independently from bid/ask mid, our own
   Black-Scholes, our own rate/dividend assumptions. Slower, but makes the
   full pipeline reproducible and closes this permanently rather than
   carrying an unverified assumption into a trained model.

**Self-check regardless of path taken:** reprice a handful of liquid names
(e.g. SPY, AAPL) at a few dates spanning the full history and compare our
IV to the vendor's. A consistent offset tells us their rate/dividend
assumptions; an offset that changes character partway through the history
tells us their methodology changed mid-dataset — a regime-shift artifact
that would otherwise silently contaminate any model trained across it.

**Status: not yet started. Blocking.**

## 3. Survivorship — RESOLVED: clean

Spot-check: TWTR (Twitter), delisted 2022-10-27 following the Musk
acquisition.

```sql
SELECT MAX(date) FROM option_chain WHERE act_symbol='TWTR';
-- 2022-10-26
```

Last row is one trading day before the actual delisting date. The dataset
stops tracking a name when it stops trading, rather than either (a)
retroactively omitting it as if it never existed (survivorship bias toward
currently-optionable names), or (b) continuing to emit stale data after
delisting. This is the behavior we want.

**Not yet checked:** whether this holds consistently across *all*
delistings/de-listings in the history, or whether TWTR is a lucky spot
check. Worth a broader pass (join against a delisted-symbols reference) if
survivorship becomes load-bearing for a result that looks surprisingly
good.

## 4. Corporate actions — RESOLVED: clean

Spot-check: AAPL's 2020-08-31 4-for-1 split.

```sql
SELECT date, MIN(strike), MAX(strike), COUNT(DISTINCT strike)
FROM option_chain
WHERE act_symbol='AAPL' AND date IN ('2020-08-28','2020-08-31')
GROUP BY date ORDER BY date;

-- 2020-08-28 | 115.00 | 650.00 | 32
-- 2020-08-31 |  28.75 | 167.50 | 32
```

Clean 4x contraction in strike range on the split date, same count of
distinct strikes. Correctly split-adjusted, no discontinuity.

**Not yet checked:** special/large one-time dividends (which move strikes
differently than a standard split), or reverse splits. Worth a follow-up
spot check before leaning heavily on any single name that had one during
the sample period.

## 5. Open interest / trading volume — RESOLVED: absent, structural, permanent

`DESCRIBE option_chain` confirms the full column list: `date, act_symbol,
expiration, strike, call_put, bid, ask, vol, delta, gamma, theta, vega,
rho`. `vol` is implied volatility (values like 0.27, 0.31 — consistent with
IV, not share/contract counts). There is no open interest column and no
separate trading-volume column, in this table or in `volatility_history`.

This is **not a weaker version** of GEX/DEX/max pain/put-wall/call-wall —
those are all defined as `greek × open_interest` summed across the chain.
Without OI, an unweighted greek aggregate is a different number that mostly
reflects how many strikes the exchange happens to list, not dealer
positioning. Dealer-positioning features are removed from Phase 1 scope
entirely, not downgraded.

**Checked whether production has a donor source:** `options_metrics.py`
computes live GEX/max-pain/walls from a `yfinance` option-chain fetch at
scan time (`gamma * openInterest * ...`, `options_metrics.py:864-865`).
This is real OI, but only for the *current* day — yfinance has never
exposed historical OI, and the app's own `options_metrics_snapshots` table
only started accumulating (going forward) 2026-08-06. There is no hidden
historical-OI source anywhere in this stack. Confirmed no live-product bug
in the process (production's real-time numbers are fine); confirmed the
historical gap is real and not fixable by looking harder.

**Partial mitigation:** bid/ask is present, so a liquidity feature family
(quoted spread, spread-to-mid, count of two-sided quoted strikes) is real
and computable — narrower than "flow" (no trade activity, no OI), but not
nothing.

## 6. Gaps — OPEN, NOT YET AUDITED

Missing trading days, missing tickers mid-history, and schema changes
across the 2019–2026 span have not been checked yet.

**Status: not started. Blocking.** Suggested checks before feature code:
- Compare distinct `date` count in `option_chain` against a known trading-
  calendar day count for the same span; investigate any gaps.
- Check for tickers with suspiciously short coverage windows that aren't
  explained by an IPO or delisting (possible mid-history dropout/re-add).
- Confirm the column set / types haven't changed across the full date
  range (a `DESCRIBE` diff isn't meaningful against a single live branch,
  but spot-check early-2019 rows against recent rows for `NULL` patterns
  that might indicate a field was added partway through).

---

## Summary

| # | Check | Status |
|---|---|---|
| 1 | Snapshot timestamps | ✅ Resolved — EOD only |
| 2 | Greeks/IV methodology | ⛔ Open — blocking |
| 3 | Survivorship | ✅ Resolved — clean (single spot check) |
| 4 | Corporate actions | ✅ Resolved — clean (single spot check) |
| 5 | Open interest / volume | ✅ Resolved — confirmed absent, permanent, no donor source |
| 6 | Gaps | ⛔ Open — blocking |

Do not proceed to feature code (`src/features/`) until #2 and #6 are closed.
