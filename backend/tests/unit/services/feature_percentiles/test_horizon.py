"""Tests for the Horizon historical-analog engine.

_aggregate() (the pure median/worst/win-rate/bucket math) is tested with
plain float lists. compute_horizon() itself is tested against a real
in-memory SQLite database (same pattern as tests/helpers/mcp_fixture.py) --
deliberately not hand-rolled query fakes, since this module's correctness
hinges on real filter/intersection/join semantics that a fake risks getting
subtly wrong in a way that still looks green.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.feature_percentile import FeaturePercentile
from app.models.stock import StockPrice
from app.services.feature_percentiles.horizon import (
    OUTCOME_BUCKETS,
    _aggregate,
    compute_horizon,
)


class TestAggregate:
    def test_empty_returns_null_stats(self):
        stats = _aggregate(5, [])
        assert stats.sample_size == 0
        assert stats.median_return_pct is None
        assert stats.worst_return_pct is None
        assert stats.win_rate_pct is None
        assert all(b.count == 0 and b.fraction is None for b in stats.buckets)

    def test_median_worst_win_rate(self):
        returns = [10.0, -6.4, 1.2, 3.8, -1.0]
        stats = _aggregate(5, returns)
        assert stats.sample_size == 5
        assert stats.median_return_pct == 1.2
        assert stats.worst_return_pct == -6.4
        # 3 of 5 are > 0
        assert stats.win_rate_pct == pytest.approx(60.0)

    def test_buckets_partition_without_overlap_or_gap(self):
        # One value squarely in each bucket.
        returns = [-10.0, -3.0, 0.0, 3.0, 10.0]
        stats = _aggregate(21, returns)
        counts = {b.label: b.count for b in stats.buckets}
        assert counts == {
            "strong_down": 1,  # -10.0 < -5.0
            "down": 1,  # -3.0 in [-5, -1)
            "flat": 1,  # 0.0 in [-1, 1)
            "up": 1,  # 3.0 in [1, 5)
            "strong_up": 1,  # 10.0 >= 5.0
        }
        assert sum(counts.values()) == 5
        # fractions sum to 1.0
        assert sum(b.fraction for b in stats.buckets) == pytest.approx(1.0)

    def test_bucket_boundary_is_left_inclusive(self):
        # Exactly on a boundary belongs to the bucket it's the lower bound
        # of, matching the [lower, upper) convention in OUTCOME_BUCKETS.
        stats = _aggregate(5, [-5.0, -1.0, 1.0, 5.0])
        counts = {b.label: b.count for b in stats.buckets}
        assert counts["down"] == 1  # -5.0 (not strong_down)
        assert counts["flat"] == 1  # -1.0 (not down)
        assert counts["up"] == 1  # 1.0 (not flat)
        assert counts["strong_up"] == 1  # 5.0 (not up)

    def test_outcome_buckets_partition_is_exhaustive(self):
        # Sanity check on the constant itself: every real number falls into
        # exactly one bucket.
        assert OUTCOME_BUCKETS[0][1] is None  # -inf lower bound
        assert OUTCOME_BUCKETS[-1][2] is None  # +inf upper bound
        for i in range(len(OUTCOME_BUCKETS) - 1):
            assert OUTCOME_BUCKETS[i][2] == OUTCOME_BUCKETS[i + 1][1]


class _AllWeekdaysCalendar:
    """Fake calendar: every Mon-Fri is a trading day, no holidays. Fully
    deterministic and independent of the real NYSE calendar library, so
    test fixtures can compute expected N-trading-days-later dates the same
    way the code under test does."""

    def trading_days(self, market: str, start: date, end: date) -> list[date]:
        days = []
        d = start
        while d <= end:
            if d.weekday() < 5:
                days.append(d)
            d += timedelta(days=1)
        return days

    def nth_trading_day_after(self, start: date, n: int) -> date:
        sessions = self.trading_days("US", start, start + timedelta(days=60))
        return sessions[n]


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for model in (FeaturePercentile, StockPrice):
        model.__table__.create(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    yield factory
    engine.dispose()


def _fp_row(ticker, trading_date, feature_name, pct_xsec, raw_value=0.0):
    return FeaturePercentile(
        ticker=ticker,
        trading_date=trading_date,
        feature_name=feature_name,
        raw_value=raw_value,
        pct_self_252d=None,
        z_self_252d=None,
        pct_xsec=pct_xsec,
        sample_size_self=0,
        history_tier="shallow",
        computed_at=trading_date,
    )


def _price_row(symbol, price_date, close):
    return StockPrice(symbol=symbol, date=price_date, close=close, open=close, high=close, low=close)


class TestComputeHorizonNoData:
    def test_no_feature_percentiles_at_all(self, session_factory):
        db = session_factory()
        result = compute_horizon(db, "AAPL", calendar_service=_AllWeekdaysCalendar())
        assert result.status == "no_data"
        assert result.ticker == "AAPL"

    def test_ticker_has_rows_but_none_are_fingerprint_features(self, session_factory):
        db = session_factory()
        as_of = date(2026, 8, 7)
        db.add(_fp_row("AAPL", as_of, "distance_to_flip_pct", 50.0))
        db.commit()

        result = compute_horizon(db, "AAPL", as_of_date=as_of, calendar_service=_AllWeekdaysCalendar())
        assert result.status == "insufficient_fingerprint"


class TestComputeHorizonWithMatches:
    def test_finds_matching_analog_and_computes_real_forward_return(self, session_factory):
        db = session_factory()
        cal = _AllWeekdaysCalendar()
        as_of = date(2026, 8, 7)  # Friday
        match_date = date(2026, 6, 1)  # Monday, well over 21 weekdays before as_of

        # Today's fingerprint: AAPL, ivr pct_xsec=90.
        db.add(_fp_row("AAPL", as_of, "ivr", 90.0))
        # A real historical analog within tolerance (default 10pts): MSFT at 85.
        db.add(_fp_row("MSFT", match_date, "ivr", 85.0))
        # A non-match: GOOG far outside tolerance.
        db.add(_fp_row("GOOG", match_date, "ivr", 10.0))
        db.commit()

        five_day_end = cal.nth_trading_day_after(match_date, 5)
        twenty_one_day_end = cal.nth_trading_day_after(match_date, 21)

        db.add(_price_row("MSFT", match_date, 100.0))
        db.add(_price_row("MSFT", five_day_end, 105.0))  # +5%
        db.add(_price_row("MSFT", twenty_one_day_end, 90.0))  # -10%
        # GOOG prices exist too, but GOOG must never be counted (outside tolerance).
        db.add(_price_row("GOOG", match_date, 100.0))
        db.add(_price_row("GOOG", five_day_end, 200.0))  # would be +100% if wrongly included
        db.commit()

        result = compute_horizon(db, "AAPL", as_of_date=as_of, calendar_service=cal)

        assert result.status == "ok"
        assert result.fingerprint == {"ivr": 90.0}

        five_day = result.horizons[5]
        assert five_day.sample_size == 1
        assert five_day.median_return_pct == pytest.approx(5.0)
        assert five_day.worst_return_pct == pytest.approx(5.0)
        assert five_day.win_rate_pct == pytest.approx(100.0)

        twenty_one_day = result.horizons[21]
        assert twenty_one_day.sample_size == 1
        assert twenty_one_day.median_return_pct == pytest.approx(-10.0)
        assert twenty_one_day.worst_return_pct == pytest.approx(-10.0)
        assert twenty_one_day.win_rate_pct == pytest.approx(0.0)

    def test_candidate_too_recent_for_horizon_is_excluded(self, session_factory):
        db = session_factory()
        cal = _AllWeekdaysCalendar()
        as_of = date(2026, 8, 7)
        # Only 2 trading days before as_of -- not enough for either 5d or 21d horizon.
        too_recent = date(2026, 8, 5)

        db.add(_fp_row("AAPL", as_of, "ivr", 90.0))
        db.add(_fp_row("MSFT", too_recent, "ivr", 90.0))
        db.commit()
        db.add(_price_row("MSFT", too_recent, 100.0))
        db.commit()

        result = compute_horizon(db, "AAPL", as_of_date=as_of, calendar_service=cal)
        assert result.horizons[5].sample_size == 0
        assert result.horizons[21].sample_size == 0

    def test_multi_feature_fingerprint_requires_match_on_every_available_feature(self, session_factory):
        db = session_factory()
        cal = _AllWeekdaysCalendar()
        as_of = date(2026, 8, 7)
        match_date = date(2026, 6, 1)

        db.add(_fp_row("AAPL", as_of, "ivr", 90.0))
        db.add(_fp_row("AAPL", as_of, "volatility_risk_premium", 80.0))

        # MSFT matches on ivr but NOT on vrp -- must be excluded from the
        # intersection even though one dimension matched.
        db.add(_fp_row("MSFT", match_date, "ivr", 88.0))
        db.add(_fp_row("MSFT", match_date, "volatility_risk_premium", 5.0))

        # NFLX matches on both -- must be included.
        db.add(_fp_row("NFLX", match_date, "ivr", 92.0))
        db.add(_fp_row("NFLX", match_date, "volatility_risk_premium", 82.0))
        db.commit()

        five_day_end = cal.nth_trading_day_after(match_date, 5)
        for sym in ("MSFT", "NFLX"):
            db.add(_price_row(sym, match_date, 100.0))
            db.add(_price_row(sym, five_day_end, 110.0))
        db.commit()

        result = compute_horizon(db, "AAPL", as_of_date=as_of, calendar_service=cal)
        assert result.fingerprint == {"ivr": 90.0, "volatility_risk_premium": 80.0}
        assert result.horizons[5].sample_size == 1  # only NFLX, not MSFT
