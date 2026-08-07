"""Historical-analog forward-outcome search ("The Horizon").

Given a ticker's current cross-sectional percentile fingerprint (how
unusual today's readings are relative to every other ticker that same day
-- feature_percentiles.pct_xsec, which populates from day one, unlike
pct_self_252d which needs 60 trailing observations), this searches
feature_percentiles across ALL tickers and dates for past rows with a
similar fingerprint, then computes the REAL forward return of the
underlying (via stock_prices, never anything options-derived) for whichever
matches are old enough to have a full forward window.

No model, no trained classifier, no invented scenario taxonomy -- every
number here is arithmetic over real historical rows. The sample size is
always reported honestly.

Two independent fingerprint groups, matched and unioned SEPARATELY rather
than intersected together -- this is deliberate, not an oversight:
  - SHALLOW_FINGERPRINT_FEATURES (ivr, volatility_risk_premium, total_gex)
    come from options_metrics_snapshots/gex_snapshots, which only started
    accumulating 2026-08-06/07-30. Sample size here will be small-to-zero
    for months.
  - DEEP_FINGERPRINT_FEATURES (iv_hv_spread) comes from
    external_volatility_history, with real coverage back to 2019-02-09.
  If these were intersected into one combined fingerprint (require a
  candidate to match on ALL of them simultaneously), every pre-2026-08
  candidate would be excluded outright -- it structurally cannot have a
  shallow-feature row that far back, so requiring one at all caps the
  match set at the shallow tier's own tiny window regardless of how deep
  the other tier's history goes. Searching each group independently and
  unioning the results is what actually lets a 2019-era row qualify via
  iv_hv_spread alone, while shallow-only matches remain available too
  (and will matter more as that tier's own history grows).

"Scenarios" in the API response are a bucketed cut of the exact same match
set (what fraction ended up big / down big / roughly flat), not named
causal narratives with invented probabilities -- see the accompanying
design discussion for why the latter would require a trained model this
codebase does not have.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Protocol

from sqlalchemy import tuple_
from sqlalchemy.orm import Session

from app.models.feature_percentile import FeaturePercentile
from app.models.stock import StockPrice

SHALLOW_FINGERPRINT_FEATURES: tuple[str, ...] = ("ivr", "volatility_risk_premium", "total_gex")
DEEP_FINGERPRINT_FEATURES: tuple[str, ...] = ("iv_hv_spread",)
FINGERPRINT_FEATURES: tuple[str, ...] = SHALLOW_FINGERPRINT_FEATURES + DEEP_FINGERPRINT_FEATURES
DEFAULT_TOLERANCE_PCT = 10.0
HORIZON_TRADING_DAYS: tuple[int, ...] = (5, 21)
# Forward-window search buffer: trading_days() needs an end date, not just a
# count. 45 calendar days comfortably covers 21 trading days (~30 calendar
# days) plus holidays, without being wasteful for the 5-day horizon.
_FORWARD_WINDOW_CALENDAR_BUFFER_DAYS = 45

# Outcome buckets for the "Scenarios" cut of the match set -- a fixed,
# documented, non-overlapping partition of forward-return percentage,
# applied to real match outcomes. Not a model; just a histogram.
OUTCOME_BUCKETS: tuple[tuple[str, float | None, float | None], ...] = (
    ("strong_down", None, -5.0),
    ("down", -5.0, -1.0),
    ("flat", -1.0, 1.0),
    ("up", 1.0, 5.0),
    ("strong_up", 5.0, None),
)


class TradingDayRange(Protocol):
    def trading_days(self, market: str, start: date, end: date) -> list[date]: ...


@dataclass(frozen=True)
class HorizonBucket:
    label: str
    lower_pct: float | None
    upper_pct: float | None
    count: int
    fraction: float | None  # None when sample_size == 0


@dataclass(frozen=True)
class HorizonStats:
    trading_days: int
    sample_size: int
    median_return_pct: float | None
    worst_return_pct: float | None
    win_rate_pct: float | None
    buckets: tuple[HorizonBucket, ...]


@dataclass(frozen=True)
class HorizonResult:
    status: str  # "ok" | "insufficient_fingerprint" | "no_data"
    ticker: str
    as_of_date: date | None
    fingerprint: dict[str, float]
    tolerance_pct: float
    horizons: dict[int, HorizonStats]
    reason: str | None = None
    # Same-day fingerprint for benchmark_ticker (default SPY), so a caller
    # can tell "this stock's IV is at the 90th pct" apart from "the whole
    # market is at the 90th pct today" -- idiosyncratic vs. macro. Empty
    # dict (not None) when the benchmark has no reading for as_of_date,
    # same convention as `fingerprint` itself.
    benchmark_ticker: str = "SPY"
    benchmark_fingerprint: dict[str, float] = field(default_factory=dict)


def compute_horizon(
    db: Session,
    ticker: str,
    *,
    market: str = "US",
    as_of_date: date | None = None,
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
    horizons: tuple[int, ...] = HORIZON_TRADING_DAYS,
    calendar_service: TradingDayRange | None = None,
    benchmark_ticker: str = "SPY",
) -> HorizonResult:
    """Compute Horizon stats for one ticker.

    `as_of_date` defaults to the ticker's most recent feature_percentiles
    trading_date. `calendar_service` defaults to a real MarketCalendarService
    -- overridable for tests. `benchmark_ticker`'s same-day fingerprint is
    always attached (when available) so a caller can distinguish "this
    stock is unusual" from "the whole market is unusual today" -- pass
    ticker == benchmark_ticker (e.g. asking for SPY itself) to get an empty
    benchmark_fingerprint back, not a self-comparison.
    """
    ticker = ticker.upper()
    benchmark_ticker = benchmark_ticker.upper()
    if calendar_service is None:
        from app.services.market_calendar_service import MarketCalendarService

        calendar_service = MarketCalendarService()

    if as_of_date is None:
        as_of_date = _latest_trading_date(db, ticker)
        if as_of_date is None:
            return HorizonResult(
                status="no_data",
                ticker=ticker,
                as_of_date=None,
                fingerprint={},
                tolerance_pct=tolerance_pct,
                horizons={},
                reason="no_feature_percentiles_for_ticker",
                benchmark_ticker=benchmark_ticker,
            )

    benchmark_fingerprint = (
        _load_fingerprint(db, benchmark_ticker, as_of_date) if benchmark_ticker != ticker else {}
    )

    fingerprint = _load_fingerprint(db, ticker, as_of_date)
    if not fingerprint:
        return HorizonResult(
            status="insufficient_fingerprint",
            ticker=ticker,
            as_of_date=as_of_date,
            fingerprint={},
            tolerance_pct=tolerance_pct,
            horizons={},
            reason="no_pct_xsec_values_for_fingerprint_features",
            benchmark_ticker=benchmark_ticker,
            benchmark_fingerprint=benchmark_fingerprint,
        )

    # Two independent searches, unioned -- NOT one intersection across every
    # fingerprint feature. See the module docstring for why: intersecting
    # shallow (2026+) and deep (2019+) features would cap every match at
    # the shallow tier's tiny window, since pre-2026 rows structurally
    # cannot have a shallow-feature value to intersect against.
    shallow_fingerprint = {k: v for k, v in fingerprint.items() if k in SHALLOW_FINGERPRINT_FEATURES}
    deep_fingerprint = {k: v for k, v in fingerprint.items() if k in DEEP_FINGERPRINT_FEATURES}
    candidate_set: set[tuple[str, date]] = set()
    if shallow_fingerprint:
        candidate_set.update(_find_candidates(db, shallow_fingerprint, tolerance_pct, before=as_of_date))
    if deep_fingerprint:
        candidate_set.update(_find_candidates(db, deep_fingerprint, tolerance_pct, before=as_of_date))
    candidates = sorted(candidate_set)

    horizon_stats: dict[int, HorizonStats] = {}
    for horizon_days in horizons:
        eligible = [
            (sym, match_date)
            for sym, match_date in candidates
            if len(calendar_service.trading_days(market, match_date, as_of_date)) > horizon_days
        ]
        returns = _compute_forward_returns(
            db, eligible, horizon_days, market=market, calendar_service=calendar_service
        )
        horizon_stats[horizon_days] = _aggregate(horizon_days, returns)

    return HorizonResult(
        status="ok",
        ticker=ticker,
        as_of_date=as_of_date,
        fingerprint=fingerprint,
        tolerance_pct=tolerance_pct,
        horizons=horizon_stats,
        benchmark_ticker=benchmark_ticker,
        benchmark_fingerprint=benchmark_fingerprint,
    )


def _latest_trading_date(db: Session, ticker: str) -> date | None:
    row = (
        db.query(FeaturePercentile.trading_date)
        .filter(FeaturePercentile.ticker == ticker)
        .order_by(FeaturePercentile.trading_date.desc())
        .first()
    )
    return row[0] if row else None


def _load_fingerprint(db: Session, ticker: str, as_of_date: date) -> dict[str, float]:
    rows = (
        db.query(FeaturePercentile.feature_name, FeaturePercentile.pct_xsec)
        .filter(
            FeaturePercentile.ticker == ticker,
            FeaturePercentile.trading_date == as_of_date,
            FeaturePercentile.feature_name.in_(FINGERPRINT_FEATURES),
        )
        .all()
    )
    return {
        feature_name: float(pct_xsec)
        for feature_name, pct_xsec in rows
        if pct_xsec is not None
    }


def _find_candidates(
    db: Session,
    fingerprint: dict[str, float],
    tolerance_pct: float,
    *,
    before: date,
) -> list[tuple[str, date]]:
    """(ticker, trading_date) pairs whose pct_xsec is within tolerance of
    the fingerprint on EVERY feature the fingerprint actually has a value
    for (features missing from today's fingerprint simply aren't matched
    on). One query per feature, intersected in Python -- feature_percentiles
    has no per-value index yet (see ix_feature_percentiles_feature_date),
    so this is a filtered scan per feature; fine at current data volume,
    worth revisiting with a (feature_name, pct_xsec) index if this table
    grows into the millions of rows.
    """
    matched_sets: list[set[tuple[str, date]]] = []
    for feature_name, target_pct in fingerprint.items():
        rows = (
            db.query(FeaturePercentile.ticker, FeaturePercentile.trading_date)
            .filter(
                FeaturePercentile.feature_name == feature_name,
                FeaturePercentile.trading_date < before,
                FeaturePercentile.pct_xsec.isnot(None),
                FeaturePercentile.pct_xsec >= target_pct - tolerance_pct,
                FeaturePercentile.pct_xsec <= target_pct + tolerance_pct,
            )
            .all()
        )
        matched_sets.append({(ticker, trading_date) for ticker, trading_date in rows})

    if not matched_sets:
        return []
    intersection = matched_sets[0]
    for s in matched_sets[1:]:
        intersection &= s
    return sorted(intersection)


def _compute_forward_returns(
    db: Session,
    candidates: list[tuple[str, date]],
    horizon_days: int,
    *,
    market: str,
    calendar_service: TradingDayRange,
) -> list[float]:
    if not candidates:
        return []

    end_date_by_start: dict[tuple[str, date], date] = {}
    lookup_pairs: set[tuple[str, date]] = set()
    for sym, start_date in candidates:
        sessions = calendar_service.trading_days(
            market, start_date, start_date + timedelta(days=_FORWARD_WINDOW_CALENDAR_BUFFER_DAYS)
        )
        if len(sessions) <= horizon_days:
            continue
        end_date = sessions[horizon_days]
        end_date_by_start[(sym, start_date)] = end_date
        lookup_pairs.add((sym, start_date))
        lookup_pairs.add((sym, end_date))

    if not lookup_pairs:
        return []

    price_rows = (
        db.query(StockPrice.symbol, StockPrice.date, StockPrice.close)
        .filter(tuple_(StockPrice.symbol, StockPrice.date).in_(list(lookup_pairs)))
        .all()
    )
    close_by_pair: dict[tuple[str, date], float] = {
        (symbol, price_date): close
        for symbol, price_date, close in price_rows
        if close is not None
    }

    returns: list[float] = []
    for (sym, start_date), end_date in end_date_by_start.items():
        start_close = close_by_pair.get((sym, start_date))
        end_close = close_by_pair.get((sym, end_date))
        if start_close is None or end_close is None or start_close == 0:
            continue
        returns.append((end_close - start_close) / start_close * 100.0)

    return returns


def _aggregate(horizon_days: int, returns: list[float]) -> HorizonStats:
    sample_size = len(returns)
    if sample_size == 0:
        buckets = tuple(
            HorizonBucket(label=label, lower_pct=lower, upper_pct=upper, count=0, fraction=None)
            for label, lower, upper in OUTCOME_BUCKETS
        )
        return HorizonStats(
            trading_days=horizon_days,
            sample_size=0,
            median_return_pct=None,
            worst_return_pct=None,
            win_rate_pct=None,
            buckets=buckets,
        )

    median_return = statistics.median(returns)
    worst_return = min(returns)
    win_rate = sum(1 for r in returns if r > 0) / sample_size * 100.0

    bucket_list = []
    for label, lower, upper in OUTCOME_BUCKETS:
        count = sum(
            1
            for r in returns
            if (lower is None or r >= lower) and (upper is None or r < upper)
        )
        bucket_list.append(
            HorizonBucket(
                label=label,
                lower_pct=lower,
                upper_pct=upper,
                count=count,
                fraction=count / sample_size,
            )
        )

    return HorizonStats(
        trading_days=horizon_days,
        sample_size=sample_size,
        median_return_pct=median_return,
        worst_return_pct=worst_return,
        win_rate_pct=win_rate,
        buckets=tuple(bucket_list),
    )


__all__ = [
    "DEEP_FINGERPRINT_FEATURES",
    "DEFAULT_TOLERANCE_PCT",
    "FINGERPRINT_FEATURES",
    "HORIZON_TRADING_DAYS",
    "HorizonBucket",
    "HorizonResult",
    "HorizonStats",
    "OUTCOME_BUCKETS",
    "SHALLOW_FINGERPRINT_FEATURES",
    "compute_horizon",
]
