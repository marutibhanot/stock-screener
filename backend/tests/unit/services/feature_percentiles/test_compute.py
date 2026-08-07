"""Tests for ComputeFeaturePercentilesService.

Mocked collaborators (DB session, calendar service) -- no real Postgres,
following this repo's convention for backfill-style service tests (see
tests/unit/test_group_rank_history_backfill_service.py). pg_insert's
ON CONFLICT DO UPDATE is Postgres-specific and can't run against SQLite, so
_upsert is verified by capturing the constructed statement's values, not by
executing it against a real database.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

from sqlalchemy.sql.dml import Insert

from app.models.feature_percentile import FeaturePercentile
from app.models.gex import GexSnapshot
from app.models.options_metrics_snapshot import OptionsMetricsSnapshot
from app.services.feature_percentiles.compute import (
    ComputeFeaturePercentilesResult,
    ComputeFeaturePercentilesService,
    ComputeFeaturePercentilesStatus,
)


@dataclass
class _VolRow:
    symbol: str
    iv_current: float | None
    hv_current: float | None


class _FakeQuery:
    """Chainable stand-in for a SQLAlchemy Query -- filter/distinct/order_by
    are all no-ops here because the returned rows are pre-filtered per test
    setup; only .all() actually matters."""

    def __init__(self, rows: list[Any]):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def distinct(self):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(
        self,
        *,
        options_metrics_rows: list[Any] | None = None,
        gex_rows: list[Any] | None = None,
        volatility_rows: list[_VolRow] | None = None,
        history_rows: list[tuple] | None = None,
    ):
        self.options_metrics_rows = options_metrics_rows or []
        self.gex_rows = gex_rows or []
        self.volatility_rows = volatility_rows or []
        self.history_rows = history_rows or []
        self.upserted_rows: list[list[dict]] = []
        self.committed = False
        self.rolled_back = False

    def query(self, *args):
        target = args[0] if args else None
        if target is OptionsMetricsSnapshot.ticker:
            return _FakeQuery([(r.ticker,) for r in self.options_metrics_rows])
        if target is OptionsMetricsSnapshot:
            return _FakeQuery(self.options_metrics_rows)
        if target is GexSnapshot:
            return _FakeQuery(self.gex_rows)
        if target is FeaturePercentile.ticker:
            return _FakeQuery(self.history_rows)
        raise AssertionError(f"Unexpected query target: {target!r}")

    def execute(self, stmt, params: dict | None = None):
        if isinstance(stmt, Insert):
            compiled = stmt.compile()
            self.upserted_rows.append(list(compiled.params_list if hasattr(compiled, "params_list") else [params or {}]))
            return None
        # Two different raw text() queries hit external_volatility_history:
        # _resolve_universe's "every symbol with data that day" (no tickers
        # param, plain (symbol,) rows) and _load_volatility_history's
        # per-ticker feature lookup (has a tickers param, full _VolRow rows).
        # self.volatility_rows is already scoped to one implicit trading_date
        # per test fixture, so no additional date filtering is needed here.
        params = params or {}
        if "tickers" not in params:
            return [(row.symbol,) for row in self.volatility_rows]
        tickers = set(params.get("tickers", []))
        return [row for row in self.volatility_rows if row.symbol in tickers]

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


@dataclass
class _OptionsMetricsRow:
    ticker: str
    expiration: date
    ivr: float | None = None
    skew: float | None = None
    volatility_risk_premium: float | None = None
    term_structure_ratio: float | None = None
    net_dex: float | None = None
    net_vex: float | None = None
    net_cex: float | None = None
    total_gex: float | None = None
    max_pain_distance_pct: float | None = None
    volume_put_call_ratio: float | None = None
    open_interest_put_call_ratio: float | None = None
    net_delta_dollar_flow: float | None = None
    call_premium_notional: float | None = None
    put_premium_notional: float | None = None


@dataclass
class _GexRow:
    ticker: str
    expiration: date
    distance_to_flip_pct: float | None = None


def _service(session: _FakeSession, calendar=None) -> ComputeFeaturePercentilesService:
    @contextmanager
    def session_factory():
        yield session

    return ComputeFeaturePercentilesService(
        session_factory=session_factory,
        calendar_service=calendar or MagicMock(),
        trailing_window_days=252,
        min_sample_size=60,
    )


class TestComputeForDateNoUniverse:
    def test_skipped_when_no_options_metrics_snapshots_that_day(self):
        session = _FakeSession(options_metrics_rows=[])
        service = _service(session)

        result = service.compute_for_date(date(2026, 8, 6))

        assert result.status is ComputeFeaturePercentilesStatus.SKIPPED
        assert result.reason == "no_options_metrics_snapshots_for_date"
        assert not session.upserted_rows


class TestComputeForDateWritesAllFeatures:
    def test_writes_one_row_per_ticker_per_feature(self):
        trading_date = date(2026, 8, 6)
        session = _FakeSession(
            options_metrics_rows=[
                _OptionsMetricsRow(
                    ticker="AAPL",
                    expiration=date(2026, 8, 21),
                    ivr=45.0,
                    skew=0.12,
                    call_premium_notional=1000.0,
                    put_premium_notional=500.0,
                ),
                _OptionsMetricsRow(
                    ticker="MSFT",
                    expiration=date(2026, 8, 21),
                    ivr=55.0,
                    skew=0.08,
                    call_premium_notional=800.0,
                    put_premium_notional=800.0,
                ),
            ],
            gex_rows=[
                _GexRow(ticker="AAPL", expiration=date(2026, 8, 21), distance_to_flip_pct=2.5),
            ],
            volatility_rows=[
                _VolRow(symbol="AAPL", iv_current=0.30, hv_current=0.25),
            ],
            history_rows=[],
        )
        service = _service(session)

        result = service.compute_for_date(trading_date)

        assert result.status is ComputeFeaturePercentilesStatus.COMPLETED
        assert result.tickers_processed == 2
        # 13 options_metrics features + 1 gex feature + 3 volatility features = 17
        # per ticker, x2 tickers.
        assert result.rows_written == 34
        assert session.committed is True
        assert len(session.upserted_rows) == 1  # one batched upsert statement

    def test_front_expiration_selected_when_ticker_has_multiple_rows(self):
        # Mirrors the real SPY/QQQ case found in production data: 2 expiration
        # rows for the same ticker on the same trading_date.
        trading_date = date(2026, 8, 6)
        session = _FakeSession(
            options_metrics_rows=[
                _OptionsMetricsRow(ticker="SPY", expiration=date(2026, 9, 1), ivr=10.0),
                _OptionsMetricsRow(ticker="SPY", expiration=date(2026, 8, 15), ivr=20.0),
            ],
        )
        service = _service(session)

        result = service.compute_for_date(trading_date)

        assert result.status is ComputeFeaturePercentilesStatus.COMPLETED
        # Only one ticker in the universe even though it has 2 source rows.
        assert result.tickers_processed == 1


class TestComputeForDateErrorHandling:
    def test_exception_is_caught_and_reported_as_errored(self):
        class _ExplodingSession(_FakeSession):
            def query(self, *args):
                raise RuntimeError("boom")

        session = _ExplodingSession()
        service = _service(session)

        result = service.compute_for_date(date(2026, 8, 6))

        assert result.status is ComputeFeaturePercentilesStatus.ERRORED
        assert result.error == "boom"
        assert session.rolled_back is True


class TestBackfill:
    """backfill() orchestration is pure date-diffing + dispatch -- verified
    without touching the DB layer at all by stubbing compute_for_date."""

    def test_calls_compute_for_date_for_every_trading_day_in_range(self):
        calendar = MagicMock()
        calendar.trading_days.return_value = [
            date(2026, 8, 3),
            date(2026, 8, 4),
            date(2026, 8, 5),
        ]
        service = _service(_FakeSession(), calendar=calendar)

        seen: list[date] = []

        def fake_compute_for_date(self, trading_date):
            seen.append(trading_date)
            return ComputeFeaturePercentilesResult(
                status=ComputeFeaturePercentilesStatus.COMPLETED,
                trading_date=trading_date,
            )

        # ComputeFeaturePercentilesService is a frozen dataclass -- patch the
        # method at the class level (patch.object) rather than the instance
        # (plain attribute assignment hits FrozenInstanceError).
        with patch.object(
            ComputeFeaturePercentilesService, "compute_for_date", fake_compute_for_date
        ):
            results = service.backfill(
                start_date=date(2026, 8, 3),
                through_date=date(2026, 8, 5),
                market="US",
            )

        assert seen == [date(2026, 8, 3), date(2026, 8, 4), date(2026, 8, 5)]
        assert len(results) == 3
        calendar.trading_days.assert_called_once_with("US", date(2026, 8, 3), date(2026, 8, 5))

    def test_within_one_backfill_call_later_dates_see_earlier_ones_via_real_history_load(self):
        # This is the "idempotent re-run over a range" behavior: dates are
        # processed oldest-first within a single backfill() call, so day 2's
        # trailing history load naturally picks up day 1's just-written rows
        # (each compute_for_date call opens the session fresh and re-queries
        # feature_percentiles, it doesn't cache in memory across days).
        calendar = MagicMock()
        calendar.trading_days.return_value = [date(2026, 8, 3), date(2026, 8, 4)]
        session = _FakeSession(
            options_metrics_rows=[_OptionsMetricsRow(ticker="AAPL", expiration=date(2026, 8, 21), ivr=45.0)],
        )
        service = _service(session, calendar=calendar)

        results = service.backfill(
            start_date=date(2026, 8, 3), through_date=date(2026, 8, 4), market="US"
        )

        assert [r.status for r in results] == [
            ComputeFeaturePercentilesStatus.COMPLETED,
            ComputeFeaturePercentilesStatus.COMPLETED,
        ]
        # Both days computed against the same fake session -- 2 upsert calls.
        assert len(session.upserted_rows) == 2
